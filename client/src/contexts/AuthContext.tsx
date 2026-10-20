import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { User } from '@shared/schema';
import { io, Socket } from 'socket.io-client';
import { toast } from '@/hooks/use-toast';
import api from '@/lib/api';
import { db, AuthService } from '@/lib/db';
import { databaseSyncService } from '@/lib/sync';

interface AuthContextType {
  user: User | null;
  token: string | null;
  socket: Socket | null;
  isOnline: boolean;
  offlineMode: boolean;
  login: (user: User, token?: string, opts?: { staleData?: boolean }) => Promise<void>;
  loginStaff: (staffId: string, passkey: string) => Promise<void>;
  logout: () => void;
  unbindDevice: (creds?: { adminUsername: string; adminPassword: string }) => Promise<{
    success: boolean;
    error?: string;
    resetCommitted?: boolean;
    tenantId?: string;
    accountId?: string;
  }>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isGuest: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineMode, setOfflineMode] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setOfflineMode(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  useEffect(() => {
    // Check for guest mode expiry
    const guestMode = localStorage.getItem('smartpos_guest_mode') === 'true';
    const guestExpiry = localStorage.getItem('smartpos_guest_expiry');
    
    if (guestMode && guestExpiry) {
      const expiryDate = new Date(guestExpiry);
      const now = new Date();
      
      if (now > expiryDate) {
        // Guest mode expired - clean up everything
        localStorage.removeItem('smartpos_guest_mode');
        localStorage.removeItem('smartpos_guest_user_id');
        localStorage.removeItem('smartpos_guest_expiry');
        localStorage.removeItem('smartpos_user');
        localStorage.removeItem('smartpos_token');
        // Also clear any other local storage items related to the app
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('smartpos_')) {
            localStorage.removeItem(key);
          }
        });
        setIsGuest(false);
        setUser(null);
        setToken(null);
      } else {
        setIsGuest(true);
      }
    }
  }, []);

  useEffect(() => {
    // Initialize socket by asking the server for the correct origin (works across LAN)
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/api/server-info');
        if (cancelled) return;

        // Simplified socket initialization for dev/prod stability
        let socketUrl = window.location.origin;
        if (socketUrl.includes('localhost')) {
          socketUrl = socketUrl.replace('localhost', '127.0.0.1');
        }
        
        if (window.location.hostname.includes('netlify.app')) {
          socketUrl = 'https://smartposv4.onrender.com';
        }

        const newSocket = io(socketUrl, {
          transports: ['polling', 'websocket'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
          timeout: 20000,
          autoConnect: true
        });
        setSocket(newSocket);

        return () => {
          cancelled = true;
          newSocket.close();
        };
      } catch (error) {
        console.warn('Socket init failed:', error);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Check for stored auth on startup
    const storedUser = localStorage.getItem('smartpos_user');
    const storedToken = localStorage.getItem('smartpos_token');
    const guestMode = localStorage.getItem('smartpos_guest_mode') === 'true';

    if (guestMode && storedUser) {
      // Guest mode - use stored user without server verification
      try {
        setUser(JSON.parse(storedUser));
        if (storedToken) {
          setToken(storedToken);
        }
        setIsGuest(true);
      } catch (error) {
        localStorage.removeItem('smartpos_user');
        localStorage.removeItem('smartpos_token');
      }
    } else if (storedToken) {
      setToken(storedToken);
      console.log('AuthContext: Found stored token:', storedToken);
      // Verify token with server
      api.get('/api/auth/session')
      .then(async data => {
        setUser(data.user);
        const tenantId = (data.user as any)?.tenantId || (data.user as any)?.tenant_id;
        if (tenantId && tenantId !== 'default-tenant-id') {
          try {
            console.log('[SESSION HYDRATION] Hydrating Client Dexie for tenant:', tenantId);
            await databaseSyncService.pullAllFromServerIntoDexie(tenantId);
          } catch (err: any) {
            console.warn('[SESSION HYDRATION WARNING] Hydration failed:', err?.message || String(err));
          }
        }
      })
      .catch((error) => {
        const is401 = error && (
          (error.message && String(error.message).includes('401')) ||
          (error.status === 401) ||
          (error.response && error.response.status === 401)
        );
        const isNetworkError = !is401;
        if (!is401 && error && error.message) {
          console.warn('[SESSION RESTORE] Network error on /api/auth/session (non-fatal):', error);
        }
        if (is401) {
          console.warn('[SESSION RESTORE] Server refused token (401). Clearing token.');
          localStorage.removeItem('smartpos_token');
          setToken(null);
        }
        if (storedUser) {
           try {
             const u = JSON.parse(storedUser);
             if (u.role === 'staff') {
               localStorage.removeItem('smartpos_user');
               setUser(null);
             } else if (u.role === 'admin' && isNetworkError) {
               console.log('[SESSION RESTORE] Graceful offline: network unreachable + local admin stored. Entering offlineMode=true.');
               setUser(u);
               setOfflineMode(true);
             } else {
               setUser(u);
             }
           } catch (e) {
             localStorage.removeItem('smartpos_user');
             setUser(null);
           }
        }
        if (is401 && !storedUser) {
          setToken(null);
          setUser(null);
        }
      });
    } else if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (error) {
        localStorage.removeItem('smartpos_user');
      }
    }
  }, []);

  useEffect(() => {
    if (socket && user) {
      socket.emit('join-user', user.id);
      
      const handleForceLogout = () => {
        toast({
            title: "Session Ended",
            description: "You have been logged out remotely.",
            variant: "destructive"
        });
        logout();
      };

      socket.on('force-logout', handleForceLogout);

      return () => {
        socket.off('force-logout', handleForceLogout);
        socket.emit('leave-user', user.id);
      };
    }
  }, [socket, user]);

  const login = async (userData: User, authToken?: string, opts?: { staleData?: boolean }) => {
    setUser(userData);
    localStorage.setItem('smartpos_user', JSON.stringify(userData));
    if (authToken) {
      setToken(authToken);
      localStorage.setItem('smartpos_token', authToken);
      console.log('AuthContext: Token set in localStorage:', authToken);
    }
    if (opts?.staleData) {
      toast({
        title: 'Data May Be Stale',
        description: 'Some data could not be synced from cloud. Transactions will be saved locally and re-sent when connectivity is restored.',
        variant: 'default'
      });
    }

    // Trigger Client Dexie Hydration from Server SQLite
    const tenantId = (userData as any)?.tenantId || (userData as any)?.tenant_id || localStorage.getItem('smartpos_tenant') || localStorage.getItem('smartpos_tenant_id');
    if (tenantId && tenantId !== 'default-tenant-id') {
      localStorage.setItem('smartpos_tenant_id', tenantId);
      localStorage.setItem('smartpos_tenant', tenantId);
      try {
        console.log('[AUTH HYDRATION] Hydrating Client Dexie for tenant:', tenantId);
        await databaseSyncService.pullAllFromServerIntoDexie(tenantId);
        window.dispatchEvent(new CustomEvent('tenant-data-synced', { detail: { tenantId } }));
      } catch (err: any) {
        console.warn('[AUTH HYDRATION WARNING] Hydration failed, using existing local Dexie cache:', err?.message || String(err));
      }
    }
  };

  const loginStaff = async (staffId: string, passkey: string) => {
    try {
      const data = await api.post('/api/auth/login', { 
        staffId, 
        passkey, 
        deviceInfo: navigator.userAgent 
      });
      
      await login(data.user, data.token);
    } catch (error) {
      console.warn('Server login failed, trying local:', error);
      const user = await AuthService.loginStaff(staffId, passkey);
      if (user) {
        await login(user);
      } else {
        throw new Error('Invalid credentials');
      }
    }
  };

  const logout = async () => {
    if (socket && user) {
      socket.emit('leave-user', user.id);
    }

    if (token) {
      api.post('/api/auth/logout', {}).catch(console.error);
    }
    
    // Purge local Dexie IndexedDB to enforce strict data isolation between accounts
    try {
      await Promise.all([
        db.products.clear(),
        db.variants.clear(),
        db.staff.clear(),
        db.sales.clear(),
        db.saleItems.clear(),
        db.expenses.clear(),
        db.purchases.clear(),
        db.creditors.clear(),
        db.nonInventoryProducts.clear(),
        db.remittances.clear(),
        db.notifications.clear()
      ]);
      console.log('[AUTH LOGOUT] Local Dexie cache successfully cleared.');
    } catch (e) {
      console.warn('[AUTH LOGOUT] Failed to clear local Dexie tables:', e);
    }

    setUser(null);
    setToken(null);
    setIsGuest(false);
    localStorage.removeItem('smartpos_user');
    localStorage.removeItem('smartpos_token');
    localStorage.removeItem('smartpos_tenant_id');
    localStorage.removeItem('smartpos_guest_mode');
    localStorage.removeItem('smartpos_guest_user_id');
    localStorage.removeItem('smartpos_guest_expiry');
  };

  const unbindDevice = useCallback(async (creds?: { adminUsername: string; adminPassword: string }): Promise<{
    success: boolean;
    error?: string;
    resetCommitted?: boolean;
    tenantId?: string;
    accountId?: string;
  }> => {
    let resetCommitted = false;
    let tenantId: string | undefined;
    let accountId: string | undefined;
    try {
      const body = creds?.adminUsername?.trim() && creds.adminPassword
        ? { adminUsername: creds.adminUsername.trim(), adminPassword: creds.adminPassword }
        : {};
      const resp = await api.post('/api/tenants/unbind-device', body);
      if (resp?.success !== true) {
        return { success: false, error: 'The server did not confirm the device reset.' };
      }
      resetCommitted = true;
      tenantId = resp?.clientPurge?.tenantId;
      accountId = resp?.clientPurge?.accountId;
      if (!tenantId || !accountId) {
        throw new Error('The server reset the binding but did not provide the verified local cleanup scope.');
      }

      if (socket) {
        try { socket.disconnect(); } catch (_e) { /* ignore */ }
      }

      setUser(null);
      setToken(null);
      setIsGuest(false);
      setOfflineMode(false);

      await AuthService.purgeDeviceTenantState(tenantId, accountId);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('device-unbound', { detail: { timestamp: Date.now(), tenantId } }));
      }

      return { success: true, resetCommitted: true, tenantId, accountId };
    } catch (e: any) {
      if (resetCommitted) {
        if (socket) {
          try { socket.disconnect(); } catch (_socketErr) { /* ignore */ }
        }
        setUser(null);
        setToken(null);
        setIsGuest(false);
        setOfflineMode(false);
        return {
          success: false,
          resetCommitted: true,
          tenantId,
          accountId,
          error: e?.message || 'The server reset the binding, but local cleanup failed. Retry cleanup before creating an account.'
        };
      }
      return {
        success: false,
        error: e?.message || 'Device reset failed. No local data was cleared.'
      };
    }
  }, [socket]);

  const value = {
    user,
    token,
    socket,
    isOnline,
    offlineMode,
    login,
    loginStaff,
    logout,
    unbindDevice,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'staff',
    isGuest,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
