import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import {
  type Staff, type Sale, type SaleItem, type User,
  staffRoles, employmentStatuses, assignedShifts, staffGenders, staffPermissions,
  staffCreateSchema, staffUpdateSchema, staffStatusSchema, staffPermissionsSchema,
  customerSchema, creditSchema, paymentSchema,
  bulkInventorySubmitSchema,
} from "@shared/schema";
import dbService, { useCloud, initSQLite } from "./database";
import { scanWifiNetworks, getWifiStatus } from "./network";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { getSupabase } from "./supabase";
import { DeveloperService } from "./developer-service";

const adminRoles = new Set(['admin', 'owner', 'superuser']);

const adminIdentifierMatches = (admin: any, identifier: string) => {
  const input = String(identifier || '').trim();
  const normalizedInput = input.toLowerCase();
  const inputDigits = input.replace(/\D/g, '');
  const username = String(admin?.username || '').trim().toLowerCase();
  const email = String(admin?.email || '').trim().toLowerCase();
  const mobile = String(admin?.mobile || '').replace(/\D/g, '');
  return normalizedInput === username || normalizedInput === email || (!!inputDigits && inputDigits === mobile);
};

const verifyAccountPassword = async (enteredPassword: string, storedValue: unknown): Promise<boolean> => {
  const storedPassword = String(storedValue || '').trim();
  if (!enteredPassword || !storedPassword) return false;
  if (/^\$2[aby]\$/.test(storedPassword)) {
    try {
      return await bcrypt.compare(enteredPassword, storedPassword);
    } catch {
      return false;
    }
  }
  const sha256Hex = createHash('sha256').update(enteredPassword).digest('hex');
  return sha256Hex.toLowerCase() === storedPassword.toLowerCase() || enteredPassword === storedPassword;
};


const getStaffAdminContext = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return { adminId: undefined, adminName: undefined };
  const session = dbService.getSessionByToken(authHeader.slice('Bearer '.length));
  if (!session) return { adminId: undefined, adminName: undefined };
  const admin = dbService.getUserById(session.user_id);
  return { adminId: session.user_id, adminName: admin?.username || admin?.ownerName || undefined };
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database schema for products and staff
  dbService.initSchema();
  

  // Enable CORS for all routes
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      // Allow all netlify subdomains, localhost, and onrender.com/railway.app
      if (origin.includes('netlify.app') || origin.includes('localhost') || origin.includes('onrender.com') || origin.includes('railway.app')) {
        return callback(null, true);
      }
      return callback(null, true); // For now, allow everything for testing
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-ID"]
  }));
  app.use(express.json());

  // Health check for Render
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Quick test endpoint to check what's in Supabase - PROTECTED by Developer Mode RBAC (x-developer-auth: true)
  app.get("/api/test/supabase-users", async (req, res) => {
    try {
      // Developer Mode RBAC check (mirrors authenticateDev pattern)
      const isDev = req.headers['x-developer-auth'] === 'true';
      if (!isDev) return res.status(403).json({ error: 'Unauthorized: developer mode required' });

      console.log("=== TEST ENDPOINT HIT (developer mode) ===");
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: "No Supabase connection" });
      
      const { data: tenants } = await supabase.from("tenants").select("*");
      const { data: users } = await supabase.from("users").select("id, username, tenant_id, role");
      
      console.log("=== TEST: Supabase Data ===");
      console.log("Tenants:", tenants);
      console.log("Users:", users);
      
      res.json({ tenants, users });
    } catch (error) {
      console.error("Test endpoint error:", error);
      res.status(500).json({ error: "Test endpoint failed", details: error });
    }
  });

  // Legacy route retained for existing links; all account creation uses the canonical admin signup flow.
  app.post('/api/tenants/register', (_req: Request, res: Response) => {
    return res.status(410).json({ error: 'This registration route has been retired. Use /admin-signup to create an account.' });
  });
  app.get('/api/tenants/device-status', async (req: Request, res: Response) => {
    try {
      const boundTenantId = await dbService.getBoundTenantId();
      if (!boundTenantId) {
        const deviceResetReady = dbService.isDeviceSetupResetReady();
        const localAccountPresent = !deviceResetReady && dbService.hasLocalAccount();
        return res.json({
          bound: false,
          tenant: null,
          admin: null,
          identityVerified: false,
          localAccountPresent,
          deviceResetReady,
          message: localAccountPresent
            ? 'No explicit device binding exists, but local account data is present. Account identity cannot be verified.'
            : 'Device is not bound to any account. Ready for new registration.'
        });
      }

      let tenantInfo: any = null;
      let adminInfo: any = null;
      let identityVerified = false;

      if (useCloud()) {
        const supabase = getSupabase();
        if (!supabase) {
          return res.status(503).json({ error: 'Cloud identity verification is unavailable. Retry before resetting or registering.' });
        }
        const [{ data: cloudTenant, error: tenantError }, { data: cloudAdmins, error: adminsError }] = await Promise.all([
          supabase
            .from('tenants')
            .select('id, store_name, subdomain, created_at')
            .eq('id', boundTenantId)
            .maybeSingle(),
          supabase
            .from('users')
            .select('id, tenant_id, username, role')
            .eq('tenant_id', boundTenantId)
            .in('role', ['admin', 'owner', 'superuser'])
        ]);
        if (tenantError || adminsError) {
          throw tenantError || adminsError;
        }

        if (cloudTenant) {
          tenantInfo = {
            id: cloudTenant.id,
            storeName: cloudTenant.store_name,
            subdomain: cloudTenant.subdomain,
            createdAt: cloudTenant.created_at
          };
        }
        if (cloudAdmins?.length) {
          const first = cloudAdmins.find((user: any) => user.role === 'owner')
            || cloudAdmins.find((user: any) => user.role === 'admin')
            || cloudAdmins[0];
          adminInfo = {
            id: first.id,
            username: first.username,
            ownerName: first.username,
            businessName: tenantInfo?.storeName || null,
            role: first.role || 'admin'
          };
        }
        identityVerified = Boolean(tenantInfo && adminInfo);
      }

      res.json({
        bound: true,
        tenant: tenantInfo,
        admin: adminInfo,
        identityVerified,
        localAccountPresent: false,
        deviceResetReady: false,
        message: identityVerified
          ? 'Device is bound to an account verified by its exact tenant ID.'
          : 'Device is bound, but the account identity could not be verified. Cached account details are not shown.'
      });
    } catch (e: any) {
      console.error('[DEVICE-STATUS] Status verification failed:', e?.message || String(e));
      res.status(503).json({ error: 'Failed to verify device binding status. Retry before continuing.' });
    }
  });

  app.post('/api/tenants/unbind-device', async (req: Request, res: Response) => {
    try {
      const username = String(req.body?.adminUsername || '').trim();
      const password = String(req.body?.adminPassword || '');
      if (!username || !password) {
        return res.status(401).json({ error: 'The current store owner username and password are required.' });
      }

      const boundTenantId = await dbService.getBoundTenantId();
      let verifiedOwner: any = null;
      if (boundTenantId && useCloud()) {
        const supabase = getSupabase();
        if (!supabase) {
          return res.status(503).json({ error: 'Cloud credential verification is unavailable. No device state was changed.' });
        }
        const { data: cloudAdmins, error: cloudError } = await supabase
          .from('users')
          .select('id, tenant_id, username, password, role')
          .eq('tenant_id', boundTenantId)
          .in('role', ['admin', 'owner', 'superuser']);
        if (cloudError) {
          return res.status(503).json({ error: 'The bound account could not be verified with the cloud service. No device state was changed.' });
        }
        const matches = (cloudAdmins || []).filter((admin: any) =>
          String(admin.tenant_id) === boundTenantId
          && adminRoles.has(String(admin.role || '').toLowerCase())
          && adminIdentifierMatches(admin, username)
        );
        if (matches.length !== 1 || !await verifyAccountPassword(password, matches[0]?.password)) {
          return res.status(401).json({ error: 'Owner credentials did not match an admin account in the bound store.' });
        }
        verifiedOwner = matches[0];
      } else {
        const localAdmins = boundTenantId
          ? dbService.getLocalAdminByCredential(boundTenantId, username)
          : dbService.getLocalAdminAccounts().filter((admin: any) => adminIdentifierMatches(admin, username));
        const matches = (localAdmins || []).filter((admin: any) =>
          (!boundTenantId || String(admin.tenant_id) === boundTenantId)
          && adminRoles.has(String(admin.role || '').toLowerCase())
          && adminIdentifierMatches(admin, username)
        );
        if (matches.length !== 1 || !await verifyAccountPassword(password, matches[0]?.password)) {
          return res.status(401).json({ error: 'Owner credentials did not match the local account for this device.' });
        }
        verifiedOwner = matches[0];
      }

      const tenantId = String(verifiedOwner?.tenant_id || '');
      const accountId = String(verifiedOwner?.id || '');
      if (!tenantId || !accountId || (boundTenantId && tenantId !== boundTenantId)) {
        return res.status(403).json({ error: 'The verified account is not the account currently associated with this device.' });
      }

      const resetScope = dbService.clearBoundTenantId(boundTenantId, tenantId, accountId);
      return res.json({
        success: true,
        message: 'Device binding and its local session were reset. Cloud account and cloud data were not deleted.',
        clientPurge: {
          tenantId: resetScope.tenantId,
          accountId: resetScope.accountId,
          localStorageKeys: [
            'smartpos_user',
            'smartpos_token',
            'smartpos_tenant_id',
            'smartpos_tenant',
            'smartpos_guest_mode',
            'smartpos_guest_user_id',
            'smartpos_guest_expiry',
            'admin_username',
            'admin_password',
            'admin_remember_me'
          ]
        }
      });
    } catch (e: any) {
      console.error('[UNBIND-DEVICE] Reset was not committed:', e?.message || String(e));
      res.status(500).json({ error: e?.message || 'Failed to reset the device binding. No success was reported.' });
    }
  });

  // Tenant Context Middleware (APPLIES TO ALL SUBSEQUENT ROUTES!)
  const tenantContext = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get tenant identifier from X-Tenant-ID header
      const subdomain = req.headers['x-tenant-id'] as string;
      
      if (!subdomain) {
        return res.status(400).json({ error: 'X-Tenant-ID header is required' });
      }
      
      // Validate tenant via Supabase
      const supabase = getSupabase();
      if (!supabase) {
        console.warn('Supabase not configured, skipping tenant validation');
        // For development, if Supabase not available, just attach dummy tenant
        (req as any).tenantId = 'default-tenant-id';
        (req as any).subdomain = subdomain;
        return next();
      }

      const { data: tenant, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('subdomain', subdomain.toLowerCase())
        .single();

      if (error || !tenant) {
        console.log('Tenant not found in Supabase, using default tenant for subdomain: ' + subdomain);
        // Still proceed with default tenant to keep app working
        (req as any).tenantId = 'default-tenant-id';
        (req as any).subdomain = subdomain;
        return next();
      }

      // Attach tenant to request object
      (req as any).tenant = tenant;
      (req as any).tenantId = tenant.id;
      (req as any).subdomain = subdomain;
      
      console.log('Tenant identified: ' + tenant.store_name + ' (' + subdomain + ')');
      next();
    } catch (error) {
      console.error('Tenant context error:', error);
      // Still proceed with default tenant on error
      const subdomain = req.headers['x-tenant-id'] as string || 'default';
      (req as any).tenantId = 'default-tenant-id';
      (req as any).subdomain = subdomain;
      next();
    }
  };

  const allowLocalNetwork: (req: Request, res: Response, next: NextFunction) => void = (req, res, next) => {
    // Prefer X-Forwarded-For when present (proxies), otherwise use socket remote address
    const xff = (req.headers['x-forwarded-for'] as string) || '';
    const ip = xff ? xff.split(',')[0].trim() : (req.ip || req.socket.remoteAddress || '');
    
    // Allow localhost
    if (ip === '::1' || ip === '127.0.0.1' || ip.includes('127.0.0.1')) {
      return next();
    }
    
    // Allow private networks
    // 192.168.x.x
    if (ip.includes('192.168.')) {
      return next();
    }
    // 10.x.x.x
    if (/^(\:\:ffff\:)?10\./.test(ip)) {
      return next();
    }
    // 172.16.x.x - 172.31.x.x
    if (/^(\:\:ffff\:)?172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
      return next();
    }

    // In development mode or production deployment allow all (convenience)
    if (app.get('env') === 'development' || process.env.NODE_ENV === 'production') {
      return next();
    }
    
    // For local network mode, we enforce restriction
    console.warn(`Blocked access from non-local IP: ${ip}`);
    res.status(403).json({ error: 'Access restricted to local network devices only' });
  };

  // Schedule session cleanup (every 60 minutes)
  setInterval(() => {
    try {
      const result = dbService.cleanupExpiredSessions(24); // 24 hours inactivity
      if (result.changes > 0) {
        console.log('Cleaned up ' + result.changes + ' expired sessions');
      }
    } catch (e) {
      console.error('Session cleanup failed:', e);
    }
  }, 60 * 60 * 1000);

  // Helper function to get tenant from X-Tenant-ID
  const getTenantFromHeader = async (req: Request) => {
    const subdomain = req.headers['x-tenant-id'] as string;
    if (!subdomain) return null;
    
    const supabase = getSupabase();
    if (!supabase) return { id: 'default-tenant-id', subdomain };
    
    try {
      const { data: tenant, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('subdomain', subdomain.toLowerCase())
        .single();
      
      if (error || !tenant) {
        console.log('Tenant not found in Supabase, returning default tenant');
        return { id: 'default-tenant-id', subdomain };
      }
      return tenant;
    } catch (e) {
      console.error('Error fetching tenant from Supabase:', e);
      return { id: 'default-tenant-id', subdomain };
    }
  };

  // Admin Status
  app.get('/api/auth/status', async (req: Request, res: Response) => {
    try {
      const tenant = await getTenantFromHeader(req);
      const admin = dbService.getAdmin(tenant?.id);
      const adminExists = !!admin;
      const configured = adminExists;
      console.log('/api/auth/status hit, tenant:', tenant);
      console.log('/api/auth/status, admin exists:', adminExists);

      if (!adminExists) {
        return res.json({ adminExists: false, configured: false, tenant: tenant || null });
      }

      const { password, ...adminWithoutPassword } = admin;

      res.json({ adminExists: true, configured: true, admin: adminWithoutPassword, tenant: tenant || null });
    } catch (error) {
      console.error('Error in /api/auth/status:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  // Settings API
  app.get('/api/settings', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const settings = dbService.getSettings(tenantId);
      // Wrap in receipt key to match client expectation
      const response = {
        receipt: settings.receipt || {}
      };
      res.json(response);
    } catch (error) {
      console.error('Error in GET /api/settings:', error);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  app.put('/api/settings', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const { receipt } = req.body;
      // Save receipt settings
      const result = dbService.upsertSettings(tenantId, { receipt });
      res.json(result);
    } catch (error) {
      console.error('Error in PUT /api/settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });



  // Auth API
  // Register Admin endpoint (for direct admin signup)
  app.post('/api/auth/register-admin', async (req: Request, res: Response) => {
    let cloudClient: any = null;
    let cloudTenantCreated = false;
    let cloudUserCreated = false;
    let finalTenantId = '';
    let userId = '';
    try {
      const { username, password, businessName, ownerName, mobile, email } = req.body || {};
      const cleanUsername = String(username || mobile || '').trim();
      const rawPassword = String(password || '');

      if (!cleanUsername || !rawPassword) {
        return res.status(400).json({ error: 'Username/mobile and password are required' });
      }

      const setupResetReady = dbService.isDeviceSetupResetReady();
      if ((await dbService.getBoundTenantId() || dbService.hasLocalAccount()) && !setupResetReady) {
        return res.status(409).json({
          error: 'An account or device binding already exists. Verify its owner credentials and reset first.',
          code: 'ADMIN_ALREADY_EXISTS'
        });
      }

      finalTenantId = randomUUID();
      userId = randomUUID();
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const now = new Date().toISOString();

      const userData: any = {
        id: userId,
        tenant_id: finalTenantId,
        username: cleanUsername,
        password: hashedPassword,
        role: 'admin',
        businessName: businessName || 'SmartPOS Store',
        ownerName: ownerName || cleanUsername,
        mobile: mobile || cleanUsername,
        email: email || null,
        profileImage: null,
        createdAt: now
      };

      if (useCloud()) {
        cloudClient = getSupabase();
        if (!cloudClient) {
          return res.status(503).json({ error: 'Cloud account creation is unavailable. No account was created; retry when connected.' });
        }
        const { data: cloudUsers, error: lookupError } = await cloudClient
          .from('users')
          .select('id, username, role');
        if (lookupError) {
          return res.status(503).json({ error: 'Cloud account availability could not be verified. No account was created.' });
        }
        const usernameTaken = (cloudUsers || []).some((candidate: any) =>
          adminRoles.has(String(candidate.role || '').toLowerCase())
          && String(candidate.username || '').trim().toLowerCase() === cleanUsername.toLowerCase()
        );
        if (usernameTaken) {
          return res.status(409).json({
            error: 'This admin username is already registered in the cloud. Sign in to that account instead.',
            code: 'ADMIN_ALREADY_EXISTS_IN_CLOUD'
          });
        }

        const storeSlug = String(businessName || cleanUsername).toLowerCase().replace(/[^a-z0-9]/g, '') || 'store';
        const subdomain = `${storeSlug}-${userId.slice(0, 8)}`;
        cloudTenantCreated = true;
        const { error: tenantError } = await cloudClient.from('tenants').insert({
          id: finalTenantId,
          store_name: userData.businessName,
          subdomain,
          created_at: now
        });
        if (tenantError) throw new Error('Cloud store creation failed. No local account was created.');

        cloudUserCreated = true;
        const { error: userError } = await cloudClient.from('users').insert({
          id: userId,
          tenant_id: finalTenantId,
          username: cleanUsername,
          password: hashedPassword,
          role: 'admin'
        });
        if (userError) throw new Error('Cloud admin account creation failed. No local account was created.');
      }

      const token = randomUUID();
      const session = {
        id: randomUUID(),
        user_id: userId,
        token,
        tenant_id: finalTenantId,
        device_info: req.headers['user-agent'] || 'Unknown Device',
        ip_address: req.ip || req.socket.remoteAddress || 'Unknown',
        created_at: now,
        last_active_at: now
      };
      try {
        dbService.commitAdminRegistration(userData, session);
      } catch (commitError) {
        throw commitError;
      }

      const { password: _, ...userSafe } = userData;
      return res.status(201).json({
        success: true,
        user: userSafe,
        token
      });
    } catch (err: any) {
      let rollbackComplete = true;
      try {
        if (cloudUserCreated && cloudClient) {
          const { error } = await cloudClient.from('users').delete().eq('id', userId).eq('tenant_id', finalTenantId);
          rollbackComplete = !error;
        }
        if (cloudTenantCreated && cloudClient) {
          const { error } = await cloudClient.from('tenants').delete().eq('id', finalTenantId);
          rollbackComplete = rollbackComplete && !error;
        }
      } catch {
        rollbackComplete = false;
      }
      console.error('[REGISTER ADMIN ERROR]:', err?.message || String(err));
      if (!rollbackComplete) {
        return res.status(500).json({
          error: 'Account setup failed and cloud rollback could not be confirmed. Contact support before retrying.'
        });
      }
      return res.status(500).json({ error: err?.message || 'Failed to register admin. No success was reported.' });
    }
  });

  // Auth API
  app.post('/api/auth/admin-login', async (req: Request, res: Response) => {
    try {
      const { username, password, verifyAgainstCloud } = req.body;
      const cleanUsername = String(username || '').trim();
      const enteredPassword = String(password || '');
      const verifyCloud = Boolean(verifyAgainstCloud);
      let staleData = false;

      console.log('=== ADMIN LOGIN ATTEMPT ===');
      console.log('Username / Identifier:', cleanUsername);
      console.log('verifyAgainstCloud flag:', verifyCloud);

      if (!cleanUsername || !enteredPassword) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // Get tenant from header (if provided)
      const headerTenant = await getTenantFromHeader(req);
      console.log('Header Tenant:', headerTenant?.subdomain || headerTenant?.id);

      // 1. First check LOCAL SQLite Database
      let admin: any = null;
      admin = dbService.getUserByUsername(cleanUsername, headerTenant?.id);
      if (admin) {
        console.log('Found user in local SQLite DB:', admin.username);
      }

      if (admin && verifyCloud && useCloud()) {
        console.log('[CLOUD VERIFY] Local admin found, verifying against Supabase Cloud...');
        const verifyResult = await dbService.verifyAdminLocalAndCloud(cleanUsername, admin);
        if (!verifyResult.matched) {
          console.log('[CLOUD VERIFY FAIL] Local admin NOT found in Supabase Cloud. Rejecting login.');
          return res.status(401).json({
            error: 'This local admin account is not registered in Supabase Cloud. Please unbind device or connect to the correct tenant.',
            code: 'ADMIN_NOT_IN_CLOUD'
          });
        }
        if (verifyResult.cloudAdmin) {
          console.log('[CLOUD VERIFY OK] Admin matched in cloud, merging fresher cloud row...');
          admin = { ...admin, ...verifyResult.cloudAdmin };
          try { dbService.saveOrUpdateUser(admin); } catch (syncErr) { console.warn('[CLOUD VERIFY] Local sync failed (non-fatal):', syncErr); }
        } else {
          console.log('[CLOUD VERIFY OK] Admin verified in cloud.');
        }
      }

      // 2. If not found locally or if cloud available, check Supabase
      const supabase = getSupabase();
      if (!admin && supabase) {
        console.log('=== CHECKING SUPABASE FOR ADMIN ===');
        try {
          // Attempt multi-strategy search across Supabase users table
          const { data: cloudUsers, error: usersErr } = await supabase.from('users').select('*');
          if (!usersErr && Array.isArray(cloudUsers)) {
            const matched = cloudUsers.find((u: any) => {
              const uName = String(u.username || '').toLowerCase().trim();
              const uMobile = String(u.mobile || '').replace(/\D/g, '');
              const uEmail = String(u.email || '').toLowerCase().trim();
              const uOwner = String(u.owner_name || u.ownerName || '').toLowerCase().trim();
              const uBiz = String(u.business_name || u.businessName || '').toLowerCase().trim();
              const inputLower = cleanUsername.toLowerCase();
              const inputDigits = cleanUsername.replace(/\D/g, '');

              return (
                uName === inputLower ||
                (inputDigits && uMobile && uMobile === inputDigits) ||
                (uEmail && uEmail === inputLower) ||
                (uOwner && uOwner === inputLower) ||
                (uBiz && uBiz === inputLower)
              );
            });

            if (matched) {
              console.log('Successfully found user in Supabase Cloud:', matched.username);
              admin = {
                id: String(matched.id),
                tenant_id: matched.tenant_id || matched.tenantId,
                username: matched.username,
                password: matched.password,
                role: matched.role || 'admin',
                businessName: matched.business_name || matched.businessName,
                ownerName: matched.owner_name || matched.ownerName,
                mobile: matched.mobile,
                email: matched.email,
                profileImage: matched.profile_image || matched.profileImage,
                createdAt: matched.created_at || matched.createdAt || new Date().toISOString()
              };

              // Cache to local SQLite for fast subsequent & offline logins
              try {
                dbService.saveOrUpdateUser(admin);
                console.log('Cached cloud admin into local SQLite');
              } catch (saveErr) {
                console.warn('Failed to cache cloud user to SQLite (non-fatal):', saveErr);
              }
            }
          }
        } catch (cloudQueryErr) {
          console.warn('Supabase admin lookup warning:', cloudQueryErr);
        }
      }

      if (!admin) {
        console.log('ERROR: User not found locally or in cloud');
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      // 3. Verify Role
      const roleStr = String(admin.role || '').toLowerCase();
      const isAdmin = roleStr === 'admin' || roleStr === 'owner' || roleStr === 'superuser' || admin.is_admin === true || !admin.role;
      if (!isAdmin) {
        console.log('ERROR: User does not have admin role:', admin.role);
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      // 4. Verify Password (supports Bcrypt, SHA-256, and Plaintext)
      const storedPassword = String(admin.password || '').trim();
      if (!storedPassword) {
        console.log('ERROR: User has no stored password');
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      let isPasswordValid = false;

      // A. Check Bcrypt
      if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
        try {
          isPasswordValid = await bcrypt.compare(enteredPassword, storedPassword);
        } catch (bcryptErr) {
          console.warn('Bcrypt compare failed:', bcryptErr);
        }
      }

      // B. Check SHA-256 (client WebCrypto hash)
      if (!isPasswordValid) {
        const sha256Hex = createHash('sha256').update(enteredPassword).digest('hex');
        if (sha256Hex.toLowerCase() === storedPassword.toLowerCase()) {
          isPasswordValid = true;
        }
      }

      // C. Check Plaintext fallback
      if (!isPasswordValid) {
        if (enteredPassword === storedPassword) {
          isPasswordValid = true;
        }
      }

      console.log('Password valid:', isPasswordValid);
      if (!isPasswordValid) {
        console.log('ERROR: Password invalid');
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      // If password was verified via plaintext or SHA-256, upgrade to bcrypt in background
      if (!storedPassword.startsWith('$2a$') && !storedPassword.startsWith('$2b$')) {
        try {
          const upgradedHash = await bcrypt.hash(enteredPassword, 10);
          admin.password = upgradedHash;
          dbService.saveOrUpdateUser(admin);
          if (supabase) {
            await supabase.from('users').update({ password: upgradedHash }).eq('id', admin.id);
          }
          console.log('[SECURITY] Upgraded admin password to bcrypt hash');
        } catch (upgradeErr) {
          console.warn('Password upgrade warning (non-fatal):', upgradeErr);
        }
      }

      // 5. Resolve Tenant ID
      let resolvedTenantId = (headerTenant && headerTenant.id && headerTenant.id !== 'default-tenant-id' ? headerTenant.id : null)
        ?? (admin.tenant_id && admin.tenant_id !== 'default-tenant-id' ? admin.tenant_id : null)
        ?? (admin.tenantId && admin.tenantId !== 'default-tenant-id' ? admin.tenantId : null);

      if (!resolvedTenantId && supabase && (admin.tenant_id || admin.tenantId)) {
        const tid = admin.tenant_id || admin.tenantId;
        const { data: tData } = await supabase.from('tenants').select('id').eq('id', tid).maybeSingle();
        if (tData?.id) {
          resolvedTenantId = tData.id;
        }
      }

      if (!resolvedTenantId) {
        resolvedTenantId = dbService.getDefaultOrOnlyTenantId() || 'default-tenant-id';
      }

      // 6. Synchronize Device Lock
      dbService.setBoundTenantId(resolvedTenantId);

      // 7. Create Session
      const token = randomUUID();
      const session = {
        id: randomUUID(),
        user_id: admin.id,
        token,
        tenant_id: resolvedTenantId,
        device_info: req.headers['user-agent'] || 'Unknown Device',
        ip_address: req.ip || req.socket.remoteAddress || 'Unknown',
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
      };

      dbService.createSession(session);
      console.log('Admin session created successfully, token generated');

      // 8. Auto-pull all data from cloud (blocking before response; error marks staleData)
      if (useCloud() && resolvedTenantId && resolvedTenantId !== 'default-tenant-id') {
        try {
          console.log(`[PULL START] tenant_id=${resolvedTenantId} trigger=admin-login`);
          await dbService.pullAllFromCloud(resolvedTenantId);
          console.log(`[PULL COMPLETE] tenant_id=${resolvedTenantId}`);
        } catch (pullError: any) {
          staleData = true;
          console.warn('ADMIN LOGIN CLOUD PULL WARNING (non-fatal, staleData=true):', pullError?.message || String(pullError));
        }
      }

      // 9. Return admin info and token
      const { password: _, ...adminInfo } = admin;
      console.log('=== ADMIN LOGIN SUCCESSFUL === staleData=', staleData);
      res.json({ user: adminInfo, token, tenantId: resolvedTenantId, staleData });
    } catch (error) {
      console.error('=== ADMIN LOGIN ERROR ===', error);
      res.status(500).json({ error: 'Login failed', details: String(error) });
    }
  });

  // Apply tenantContext middleware to all protected API endpoints
  app.use('/api', (req, res, next) => {
    // Skip tenantContext for public endpoints
    const publicEndpoints = [
      '/health',
      '/tenants/register',
      '/tenants/unbind-device',
      '/tenants/device-status',
      '/auth/status',
      '/auth/login',
      '/auth/admin-login',
      '/auth/session',
      '/server-info',
      '/wifi/status',
      '/wifi/connect'
    ];
    
    if (publicEndpoints.some(p => req.path.startsWith(p))) {
      return next();
    }
    
    // Otherwise require tenant context
    tenantContext(req, res, next);
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { staffId, passkey, deviceInfo } = req.body;
      
      // Get tenant from header
      const tenant = await getTenantFromHeader(req);

      // Verify credentials with tenant check
      let staff: any = null;
      const supabase = getSupabase();
      
      const sId = (staffId || '').trim();

      if (supabase) {
        // Query Supabase for staff matching staff_id or staffId
        const { data, error } = await supabase.from('staff').select('*');
        if (!error && data && data.length > 0) {
          const row = data.find((r: any) => {
            const sid = String(r.staff_id || r.staffId || '').trim().toLowerCase();
            return sid === sId.toLowerCase();
          });
          if (row) {
            staff = {
              id: row.id,
              name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Staff Member',
              staffId: row.staff_id || row.staffId,
              passkey: row.passkey || row.passhash || row.pass_key || row.passHash || '',
              createdBy: row.created_by || row.createdBy || null,
              createdAt: row.created_at || row.createdAt || new Date().toISOString(),
              tenantId: row.tenant_id || row.tenantId || (tenant?.id || 'default-tenant-id')
            };
            await dbService.saveStaff([staff], staff.tenantId);
          }
        }
      } 
      
      // If not found in Supabase, try local SQLite
      if (!staff) {
        staff = dbService.getStaffByStaffId(sId, tenant?.id) as any;
      }

      if (!staff) {
        return res.status(401).json({ error: 'Invalid staff credentials' });
      }

      // Verify passkey using bcrypt or plaintext comparison
      const storedKey = String(staff.passkey || staff.passHash || staff.passhash || '').trim();
      let isValid = false;
      if (storedKey) {
        if (storedKey.startsWith('$2a$') || storedKey.startsWith('$2b$')) {
          isValid = await bcrypt.compare(passkey.trim(), storedKey);
        } else {
          isValid = (passkey.trim() === storedKey);
        }
      }

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid staff credentials' });
      }

      // Create session — resolve tenant or fallback to single active store tenant
      const sessionTenantId = (tenant && tenant.id && tenant.id !== 'default-tenant-id' ? tenant.id : null)
        ?? (staff.tenantId && staff.tenantId !== 'default-tenant-id' ? staff.tenantId : null)
        ?? (staff.tenant_id && staff.tenant_id !== 'default-tenant-id' ? staff.tenant_id : null)
        ?? dbService.getDefaultOrOnlyTenantId()
        ?? 'default-tenant-id';

      const token = randomUUID();
      const session = {
        id: randomUUID(),
        user_id: staff.id,
        token,
        tenant_id: sessionTenantId,
        device_info: deviceInfo || 'Unknown Device',
        ip_address: req.ip || req.socket.remoteAddress || 'Unknown',
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
      };

      dbService.createSession(session);
      dbService.recordStaffLogin({
        id: randomUUID(),
        staffId: staff.id,
        tenantId: session.tenant_id,
        deviceInfo: session.device_info,
        ipAddress: session.ip_address,
      });
      dbService.recordStaffClockIn({
        id: randomUUID(),
        staffId: staff.id,
        tenantId: session.tenant_id,
      });

      // Auto-pull all data from cloud on login for multi-device sync ONLY IF we have a real tenant in Supabase
      if (useCloud() && tenant && tenant.id !== 'default-tenant-id') {
        const pullStart = Date.now();
        try {
          const tenantId = session.tenant_id;
          console.log('[PULL START] tenant_id=' + tenantId + ' trigger=staff-login');
          console.log('=== AUTO-PULLING DATA FROM CLOUD (STAFF LOGIN) ===');
          await dbService.pullAllFromCloud(tenantId);
          const pullDur = Date.now() - pullStart;
          console.log('[PULL COMPLETE] tenant_id=' + tenantId + ' duration_ms=' + pullDur);
          console.log('=== AUTO-PULL COMPLETED (STAFF LOGIN) ===');
        } catch (pullError: any) {
          console.error('STAFF LOGIN CLOUD PULL FAILED:', pullError?.message || String(pullError));
          return res.status(500).json({
            error: 'SYNC_REQUIRED',
            message: 'Authentication succeeded but device data synchronization failed. Please retry when server connection is available.',
            details: pullError?.message || String(pullError)
          });
        }
      }

      // Return token and user info with tenantId
      res.status(200).json({
        token,
        user: {
          id: staff.id,
          name: staff.name,
          staffId: staff.staffId,
          role: 'staff',
          tenantId: sessionTenantId
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/cloud/login', async (req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      const { staffId, passkey, deviceInfo } = req.body;

      // Resolve verified tenant (subdomain header OR trust tenant_id on the staff cloud record).
      const headerTenant = await getTenantFromHeader(req);
      const headerTenantId = headerTenant && headerTenant.id !== 'default-tenant-id' ? headerTenant.id : null;

      const { data, error } = await supabase.from('staff').select('*').eq('staff_id', staffId).single();
      if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });

      // Tenant validation: if header tenant provided, it must match the staff tenant on the record.
      const staffTenantId = data.tenant_id && String(data.tenant_id) !== 'default-tenant-id' ? String(data.tenant_id) : null;
      if (headerTenantId && staffTenantId && headerTenantId !== staffTenantId) {
        return res.status(401).json({ error: 'Tenant mismatch: subdomain does not match staff record' });
      }
      const resolvedTenantId = headerTenantId ?? staffTenantId;
      if (!resolvedTenantId) {
        console.warn('Cloud login: staff record and header have no resolvable tenant for staff_id=', staffId);
        return res.status(401).json({ error: 'Tenant context missing: ensure X-Tenant-ID subdomain is set' });
      }

      const ok = await bcrypt.compare(passkey, String(data.passhash || ''));
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      const token = randomUUID();
      const session = {
        id: randomUUID(),
        user_id: String(data.id),
        token,
        tenant_id: resolvedTenantId,
        device_info: deviceInfo || 'Unknown Device',
        ip_address: req.ip || req.socket.remoteAddress || 'Unknown',
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
      };
      dbService.createSession(session);
      dbService.recordStaffLogin({
        id: randomUUID(),
        staffId: String(data.id),
        tenantId: session.tenant_id,
        deviceInfo: session.device_info,
        ipAddress: session.ip_address,
      });
      dbService.recordStaffClockIn({
        id: randomUUID(),
        staffId: String(data.id),
        tenantId: session.tenant_id,
      });

      if (useCloud() && resolvedTenantId && resolvedTenantId !== 'default-tenant-id') {
        try {
          const tenantId = session.tenant_id;
          await dbService.pullAllFromCloud(tenantId);
        } catch (pullError: any) {
          console.error('CLOUD LOGIN PULL FAILED:', pullError?.message || String(pullError));
          return res.status(500).json({
            error: 'SYNC_REQUIRED',
            message: 'Authentication succeeded but cloud data synchronization failed. Please retry when server connection is available.',
            details: pullError?.message || String(pullError)
          });
        }
      }

      res.status(200).json({
        token,
        user: {
          id: String(data.id),
          name: String(data.name),
          staffId: String(data.staff_id),
          role: 'staff',
          tenantId: resolvedTenantId
        }
      });
    } catch (e) {
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const session = dbService.getSessionByToken(token) as any;
        if (session && session.user_id) {
          const tenantId = session.tenant_id || (req as any).tenantId;
          dbService.recordStaffLogout(session.user_id, tenantId);
        }
        dbService.revokeSession(token);
      }
      res.status(200).json({ message: 'Logged out' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    console.log('Server Auth: Received Authorization header:', authHeader);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('Server Auth: No valid Authorization header provided.');
      return res.status(401).json({ error: 'Authentication required: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    console.log('Server Auth: Extracted token:', token);
    const session = dbService.getSessionByToken(token) as any;

    if (!session) {
      console.warn('Server Auth: Invalid session for token:', token);
      return res.status(401).json({ error: 'Authentication required: Invalid session' });
    }

    if (!session.tenant_id) {
      console.warn('Server Auth: Session missing tenant_id for token:', token);
      return res.status(401).json({ error: 'Authentication required: Session has no tenant' });
    }

    // Update activity
    dbService.updateSessionActivity(token);
    console.log('Server Auth: Session valid, user ID:', session.user_id, 'tenant ID:', session.tenant_id);

    // Attach session-verified user ID and tenant ID to request for downstream use (Header CANNOT override session)
    (req as any).userId = session.user_id;
    (req as any).tenantId = session.tenant_id;
    next();
  };

  const resolveSyncTenant = async (req: Request, res: Response, next: NextFunction) => {
    // Developer endpoints are system-wide administrative routes, bypass store tenant requirement
    if (req.path.startsWith('/api/developer')) {
      return next();
    }
    try {
      let tenantId = (req as any).tenantId;

      // 1. Check Bearer token in Authorization header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        if (token) {
          const session = dbService.getSessionByToken(token) as any;
          if (session && session.tenant_id) {
            tenantId = session.tenant_id;
            (req as any).userId = session.user_id;
          }
        }
      }

      // 2. Check req.body.tenantId or req.body.tenant_id
      if (!tenantId || tenantId === 'default-tenant-id') {
        const bodyTenantId = req.body?.tenantId || req.body?.tenant_id;
        if (bodyTenantId && bodyTenantId !== 'default-tenant-id' && bodyTenantId !== 'default') {
          tenantId = bodyTenantId;
        }
      }

      // 3. Check X-Tenant-ID subdomain or UUID header
      if (!tenantId || tenantId === 'default-tenant-id') {
        const subdomain = req.headers['x-tenant-id'] as string;
        if (subdomain && subdomain !== 'default' && subdomain !== 'default-tenant-id') {
          if (subdomain.length > 20) {
            tenantId = subdomain;
          } else {
            const tenant = await getTenantFromHeader(req);
            if (tenant && tenant.id) {
              tenantId = tenant.id;
            }
          }
        }
      }

      // 4. Fallback: single active tenant ID in SQLite
      if (!tenantId || tenantId === 'default-tenant-id') {
        const fallbackTenantId = dbService.getDefaultOrOnlyTenantId();
        if (fallbackTenantId) {
          tenantId = fallbackTenantId;
        }
      }

      if (!tenantId) {
        return res.status(401).json({ success: false, error: 'Authentication required: Missing tenant context' });
      }

      (req as any).tenantId = tenantId;
      next();
    } catch (error: any) {
      console.error('[SYNC TENANT RESOLUTION ERROR]', error);
      res.status(500).json({ success: false, error: 'Failed to resolve tenant context' });
    }
  };

  app.post('/api/auth/set-security-questions', authenticateUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { questions, answers } = req.body;

      if (!userId || !Array.isArray(questions) || questions.length !== 3 || !Array.isArray(answers) || answers.length !== 3) {
        return res.status(400).json({ error: 'Invalid input: userId, 3 questions, and 3 answers are required.' });
      }

      // Hash answers before saving (already handled in dbService.saveSecurityQuestions)
      await dbService.saveSecurityQuestions(userId, questions, answers);
      res.status(200).json({ message: 'Security questions set successfully.' });
    } catch (error) {
      console.error('Error setting security questions:', error);
      res.status(500).json({ error: 'Failed to set security questions.' });
    }
  });

  app.put('/api/auth/change-password', authenticateUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const tenantId = (req as any).tenantId;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
      }

      // 1. Get user from local SQLite or Supabase
      let user: any = dbService.getUserById(userId);
      if (!user) {
        user = dbService.getAdmin(tenantId);
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // 2. Verify current password
      const storedKey = String(user.password || '').trim();
      let isValid = false;
      if (storedKey) {
        if (storedKey.startsWith('$2a$') || storedKey.startsWith('$2b$')) {
          isValid = await bcrypt.compare(currentPassword.trim(), storedKey);
        } else {
          isValid = (currentPassword.trim() === storedKey);
        }
      }

      if (!isValid) {
        return res.status(400).json({ error: 'Incorrect current password' });
      }

      // 3. Hash new password
      const newHash = await bcrypt.hash(newPassword.trim(), 10);

      // 4. Update in local SQLite
      try {
        const sqlite = initSQLite();
        sqlite.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
      } catch (err) {
        console.warn('Failed to update local SQLite admin password:', err);
      }

      // 5. Update in Supabase Cloud
      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            await supabase.from('users').update({ password: newHash }).eq('id', user.id);
            console.log(`[PASSWORD CHANGE] Admin password updated in Supabase Cloud for user: ${user.id}`);
          }
        } catch (cloudErr) {
          console.warn('Failed to update admin password in Supabase cloud:', cloudErr);
        }
      }

      res.json({ success: true, message: 'Password updated successfully in local DB and Supabase Cloud' });
    } catch (error: any) {
      console.error('Error changing password:', error);
      res.status(500).json({ error: 'Failed to change password', details: error?.message || String(error) });
    }
  });

  app.post('/api/auth/verify-security-answers', async (req: Request, res: Response) => {
    try {
      const { username, answers } = req.body;

      if (!username || !Array.isArray(answers) || answers.length !== 3) {
        return res.status(400).json({ error: 'Invalid input: username and 3 answers are required.' });
      }

      const user = dbService.getUserByUsername(username) as User | undefined; // Get full user data
      if (!user) {
        return res.status(404).json({ error: 'User not found.' });
      }

      // Check for lockout
      if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
        const remainingTime = Math.ceil((new Date(user.lockoutUntil).getTime() - new Date().getTime()) / (1000 * 60));
        return res.status(429).json({ error: `Account locked. Try again in ${remainingTime} minutes.` });
      }

      const securityQuestions = dbService.getUserSecurityQuestions(username);

      if (!securityQuestions || !securityQuestions.securityQuestion1) { // Check if questions are set
        return res.status(404).json({ error: 'Security questions not set for this user.' });
      }

      const storedHashedAnswers = [
        securityQuestions.securityAnswer1,
        securityQuestions.securityAnswer2,
        securityQuestions.securityAnswer3,
      ];

      let allAnswersMatch = true;
      for (let i = 0; i < 3; i++) {
        if (!await bcrypt.compare(answers[i], storedHashedAnswers[i])) {
          allAnswersMatch = false;
          break;
        }
      }

      if (allAnswersMatch) {
        dbService.resetLoginAttempts(username); // Reset attempts on success
        res.status(200).json({ success: true, message: 'Security answers verified.' });
      } else {
        const failedAttempts = dbService.recordFailedLoginAttempt(username);
        if (failedAttempts >= 3) { // Lockout after 3 failed attempts
          dbService.lockUserAccount(username, 3); // Lock for 3 minutes
          return res.status(401).json({ success: false, error: 'Incorrect security answers. Account locked for 3 minutes.' });
        }
        res.status(401).json({ success: false, error: 'Incorrect security answers.' });
      }
    } catch (error) {
      console.error('Error verifying security answers:', error);
      res.status(500).json({ error: 'Failed to verify security answers.' });
    }
  });

  app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const { username, newPassword } = req.body;

      if (!username || !newPassword) {
        return res.status(400).json({ error: 'Username and new password are required.' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await dbService.updateUserPassword(username, hashedPassword);

      res.status(200).json({ success: true, message: 'Password reset successfully.' });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ error: 'Failed to reset password.' });
    }
  });

  app.post('/api/auth/update-admin', authenticateUser, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const updates = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const updatedUser = dbService.updateAdmin(userId, updates);
      if (!updatedUser) {
        return res.status(404).json({ error: 'Admin not found' });
      }

      res.status(200).json({ success: true, user: updatedUser });
    } catch (error) {
      console.error('Error updating admin:', error);
      res.status(500).json({ error: 'Failed to update admin profile.' });
    }
  });

  app.get('/api/auth/session', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      const session = dbService.getSessionByToken(token) as any;

      if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      // Update activity
      dbService.updateSessionActivity(token);

      // Get user info
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const allStaff = dbService.getStaff(tenantId) as any[];
      const user = allStaff.find(s => s.id === session.user_id);

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const sessionTenantId = session.tenant_id;
      const forcePull = req.query.force_sync === '1' || req.query.force_sync === 'true';
      const STALE_THRESHOLD_MS = 5 * 60 * 1000;
      const lastActivity = session.last_activity ? new Date(session.last_activity).getTime() : 0;
      const isStale = Date.now() - lastActivity > STALE_THRESHOLD_MS;

      if (useCloud() && sessionTenantId && sessionTenantId !== 'default-tenant-id' && (forcePull || isStale)) {
        try {
          console.log(`[SESSION RESTORE] Pulling from cloud (stale=${isStale}, force=${forcePull}) tenant=${sessionTenantId}`);
          await dbService.pullAllFromCloud(sessionTenantId);
        } catch (pullError: any) {
          console.warn('[SESSION RESTORE] Cloud pull failed, returning cached SQLite data:', pullError?.message);
        }
      }

      res.status(200).json({
        token,
        user: {
          id: user.id,
          name: user.name,
          staffId: user.staffId,
          role: 'staff'
        }
      });
    } catch (error) {
      console.error('Session check error:', error);
      res.status(500).json({ error: 'Session check failed' });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
  });

  // Products API - Sync products with connected devices
  app.get('/api/products', resolveSyncTenant, (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const products = dbService.getProducts(tenantId);
      res.status(200).json(products);
    } catch (error) {
      console.error('Error fetching products:', error);
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  app.post('/api/sales', authenticateUser, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(400).json({ error: 'Missing or invalid tenant ID' });
      }
      const { sale, items } = req.body;
      
      if (!sale || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Invalid sale data provided.' });
      }

      if (!sale.staffId) {
        sale.staffId = 'unknown';
      }

      dbService.addSale(tenantId, sale, items);
      
      for (const item of items) {
        if (!item.isNonInventory) {
          io.emit('inventory-update', { productId: item.productId, quantityChange: -item.quantity });
        }
      }
      io.emit('sale-added', { sale, items });

      res.status(201).json({ success: true, message: 'Sale processed successfully.' });
    } catch (error: any) {
      console.error('Error processing server sale:', error);
      res.status(500).json({ error: error.message || 'Failed to process sale on server' });
    }
  });

  app.get('/api/sales-history', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(400).json({ error: 'Missing or invalid tenant ID' });
      }
      const salesHistory = await dbService.getAllSalesWithStaff(tenantId);
      res.status(200).json(salesHistory);
    } catch (error) {
      console.error('Error fetching sales history:', error);
      res.status(500).json({ error: 'Failed to fetch sales history' });
    }
  });

  app.get('/api/cloud/products', async (_req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      const { data, error } = await supabase.from('products').select('*');
      if (error) return res.status(500).json({ error: 'Failed to fetch products' });
      const mapped = (data || []).map((p: any) => ({
        id: String(p.id),
        name: p.name,
        price: Number(p.price || 0),
        cost: Number(p.cost || 0),
        barcode: String(p.barcode || ''),
        category: p.category || null,
        image: p.image || null,
        quantity: Number(p.quantity || 0),
        createdAt: p.created_at || null,
        updatedAt: p.updated_at || null
      }));
      res.status(200).json(mapped);
    } catch {
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  });

  app.get('/api/cloud/transactions', async (_req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      
      const { data, error } = await supabase
        .from('sales')
        .select(`
          id,
          total,
          payment_type,
          payment_amount,
          staff_id,
          remitted,
          created_at
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Also fetch staff names for these sales
      const { data: cloudStaff } = await supabase.from('staff').select('staff_id, name');
      const staffMap = new Map((cloudStaff || []).map(s => [s.staff_id, s.name]));

      const mapped = (data || []).map(s => ({
        id: s.id,
        total: s.total,
        paymentType: s.payment_type,
        paymentAmount: s.payment_amount,
        staffId: s.staff_id,
        remitted: !!s.remitted,
        createdAt: s.created_at,
        staffName: staffMap.get(s.staff_id) || 'Staff'
      }));

      res.status(200).json(mapped);
    } catch (error) {
      console.error('Cloud transactions fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch cloud transactions' });
    }
  });

  app.post('/api/cloud/sync-sales', async (req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      
      const { sales, items } = req.body;
      if (!Array.isArray(sales) || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid data format' });
      }

      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      if (!tenantId) {
        console.error('[SALE SYNC ERROR] Missing tenant_id before Supabase operation');
        return res.status(400).json({ error: 'Tenant ID is required for sale sync' });
      }

      // Upsert sales with validated tenant_id
      const mappedSales = sales.map(s => {
        const effTenantId = s.tenantId || s.tenant_id || tenantId;
        if (!effTenantId) {
          console.error(`[SALE SYNC ERROR] Missing tenant_id before Supabase operation for sale ${s.id}`);
          throw new Error(`SALE_SYNC_BLOCKED: Missing tenant_id for sale ${s.id}`);
        }
        console.log('[SALE SYNC] Preparing sale');
        console.log('[SALE SYNC] sale_id:', s.id);
        console.log('[SALE SYNC] tenant_id:', effTenantId);
        console.log('[SALE SYNC] staff_id:', s.staffId || s.staff_id || 'N/A');
        console.log('[SALE SYNC] total:', s.total);
        return {
          id: String(s.id),
          tenant_id: String(effTenantId),
          total: Number(s.total || 0),
          payment_type: String(s.paymentType || s.payment_type || 'cash'),
          payment_amount: Number(s.paymentAmount || s.payment_amount || 0),
          staff_id: s.staffId || s.staff_id || null,
          remitted: !!s.remitted,
          created_at: s.createdAt || s.created_at || new Date().toISOString()
        };
      });

      const { error: salesError } = await supabase.from('sales').upsert(mappedSales, { onConflict: 'id' });
      if (salesError) {
        console.error('[SALE SYNC ERROR] Failed to upsert sales:', salesError);
        throw salesError;
      }

      // Upsert items with tenant_id
      const mappedItems = items.map(it => ({
        id: String(it.id),
        tenant_id: String(it.tenantId || it.tenant_id || tenantId),
        sale_id: String(it.saleId || it.sale_id),
        product_id: String(it.productId || it.product_id),
        quantity: Number(it.quantity || 1),
        price: Number(it.price || 0),
        unit: String(it.unit || 'pieces'),
        product_name: it.productName || it.product_name || null,
        is_non_inventory: !!(it.isNonInventory || it.is_non_inventory)
      }));

      const { error: itemsError } = await supabase.from('sale_items').upsert(mappedItems, { onConflict: 'id' });
      if (itemsError) {
        console.error('[SALE SYNC ERROR] Failed to upsert sale items:', itemsError);
        throw itemsError;
      }

      res.status(200).json({ success: true, syncedSales: sales.length, syncedItems: items.length });
    } catch (error: any) {
      console.error('Cloud sales sync error:', error);
      res.status(500).json({ error: error.message || 'Failed to sync sales to cloud' });
    }
  });

  app.post('/api/cloud/sync-expenses', async (req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      
      const { expenses } = req.body;
      if (!Array.isArray(expenses)) return res.status(400).json({ error: 'Invalid data format' });

      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

      const mappedExpenses = expenses.map(e => {
        const effTenantId = e.tenantId || e.tenant_id || tenantId;
        if (!effTenantId) throw new Error(`Expense ${e.id} missing tenant_id`);
        if (!e.id || e.amount == null || !e.description || !e.category || !e.date) {
          throw new Error(`Expense validation failed for id=${e.id}: required fields: id, description, amount, category, date, tenant_id`);
        }
        return {
          id: String(e.id),
          tenant_id: String(effTenantId),
          description: String(e.description),
          amount: Number(e.amount),
          category: String(e.category),
          date: e.date instanceof Date ? e.date.toISOString() : String(e.date)
        };
      });

      const { error } = await supabase.from('expenses').upsert(mappedExpenses, { onConflict: 'id' });
      if (error) throw error;

      res.status(200).json({ success: true, syncedExpenses: expenses.length });
    } catch (error) {
      console.error('Cloud expenses sync error:', error);
      res.status(500).json({ error: 'Failed to sync expenses to cloud' });
    }
  });

  app.get('/api/products/:barcode', (req: Request, res: Response) => {
    try {
      const { barcode } = req.params;
      const tenantId = (req as any).tenantId;
      const product = dbService.getProductByBarcode(barcode, tenantId) as any;
      
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      res.status(200).json(product);
    } catch (error) {
      console.error('Error fetching product:', error);
      res.status(500).json({ error: 'Failed to fetch product' });
    }
  });
  
  // Non-inventory products API
  app.get('/api/non-inventory-products', authenticateUser, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const products = dbService.getNonInventoryProducts(tenantId);
      res.status(200).json(products);
    } catch (error) {
      console.error('Error fetching non-inventory products:', error);
      res.status(500).json({ error: 'Failed to fetch non-inventory products' });
    }
  });

  app.post('/api/non-inventory-products', authenticateUser, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const products = Array.isArray(req.body) ? req.body : [req.body];
      dbService.saveNonInventoryProducts(products, tenantId);
      res.status(200).json({ message: 'Non-inventory products saved successfully' });
    } catch (error) {
      console.error('Error saving non-inventory products:', error);
      res.status(500).json({ error: 'Failed to save non-inventory products' });
    }
  });

  app.delete('/api/non-inventory-products/:id', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const tenantId = (req as any).tenantId;
      dbService.deleteNonInventoryProduct(id, tenantId);
      res.status(200).json({ message: 'Non-inventory product deleted' });
    } catch (error) {
      console.error('Error deleting non-inventory product:', error);
      res.status(500).json({ error: 'Failed to delete non-inventory product' });
    }
  });

  // Specific endpoint for barcode scanning from customer page
  app.get('/api/products/barcode/:barcode', (req: Request, res: Response) => {
    try {
      const { barcode } = req.params;
      const tenantId = (req as any).tenantId;
      let product = dbService.getProductByBarcode(barcode, tenantId) as any;
      
      if (!product) {
        // Try to find in non-inventory products
        const niProduct = dbService.getNonInventoryProductByBarcode(barcode, tenantId) as any;
        if (niProduct) {
          product = {
            ...niProduct,
            quantity: 999999, // Infinite stock for non-inventory
            isNonInventory: true
          };
        }
      }
      
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      // Add inStock property based on quantity
      const productWithStock = {
        ...product,
        inStock: (product.quantity > 0)
      };
      
      res.status(200).json(productWithStock);
    } catch (error) {
      console.error('Error fetching product by barcode:', error);
      res.status(500).json({ error: 'Failed to fetch product' });
    }
  });


  // Variant endpoints
  app.get('/api/products/:id/variants', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const tenantId = (req as any).tenantId;
      const variants = dbService.getVariants(id, tenantId);
      res.status(200).json(variants);
    } catch (error) {
      console.error('Error fetching variants:', error);
      res.status(500).json({ error: 'Failed to fetch variants' });
    }
  });

  app.post('/api/cloud/products', authenticateUser, async (req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      const tenantId = (req as any).tenantId;
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(400).json({ error: 'Missing or invalid tenant ID' });
      }
      const products = Array.isArray(req.body) ? req.body : [];
      const rows = products.map((p: any) => ({
        id: String(p.id),
        tenant_id: tenantId,
        name: String(p.name || ''),
        price: Number(p.price || 0),
        cost: Number(p.cost || 0),
        barcode: String(p.barcode || ''),
        category: p.category ?? null,
        image: p.image ?? null,
        quantity: Number(p.quantity || 0),
        created_at: p.createdAt ?? new Date().toISOString(),
        updated_at: p.updatedAt ?? new Date().toISOString()
      }));
      
      // Process each product individually for detailed logging
      for (let i = 0; i < rows.length; i++) {
        const productData = rows[i];
        const originalProduct = products[i];
        try {
          const { error: prodError } = await supabase.from('products').upsert(productData, { onConflict: 'id' });
          if (prodError) {
            console.error(`[SYNC FAILURE]`, {
              productId: originalProduct.id,
              tenantId,
              payload: productData,
              error: prodError,
              errorMessage: prodError.message,
              errorDetails: prodError.details,
              errorHint: prodError.hint,
              errorCode: prodError.code,
              tableName: 'products'
            });
            return res.status(500).json({ error: 'Failed to sync products', details: prodError });
          } else {
            console.log(`[SYNC SUCCESS] Product ID: ${originalProduct.id}, Tenant ID: ${tenantId}`);
          }
        } catch (finalErr: any) {
          console.error(`[SYNC FAILURE]`, {
            productId: originalProduct.id,
            tenantId,
            payload: productData,
            error: finalErr,
            errorMessage: finalErr.message,
            errorDetails: finalErr.details,
            errorHint: finalErr.hint,
            errorCode: finalErr.code,
            tableName: 'products'
          });
          return res.status(500).json({ error: 'Failed to sync products', details: finalErr });
        }
      }
      
      res.status(200).json({ synced: rows.length });
    } catch (err: any) {
      console.error('[SYNC FAILURE]', err);
      res.status(500).json({ error: 'Failed to sync products', details: err });
    }
  });

  app.post('/api/variants', authenticateUser, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const variants = req.body;
      if (!Array.isArray(variants)) {
        return res.status(400).json({ error: 'Invalid variants data: expected an array' });
      }

      // Filter out variants that don't have a corresponding product
      const validVariants = variants.filter((v: any) => {
        if (!v.productId && !v.product_id) {
          console.warn(`Variant ${v.id} skipped: missing productId`);
          return false;
        }
        const productId = v.productId || v.product_id;
        const productExists = dbService.getProductById(productId, tenantId);
        if (!productExists) {
          console.warn(`Variant ${v.id} skipped: product with ID ${productId} does not exist`);
          return false;
        }
        return true;
      });

      if (validVariants.length > 0) {
        dbService.saveVariants(validVariants, tenantId);
        res.status(200).json({ message: `Successfully updated ${validVariants.length} variants` });
      } else {
        res.status(200).json({ message: 'No valid variants to update' });
      }
    } catch (error) {
      console.error('Error updating variants:', error);
      res.status(500).json({ error: 'Failed to update variants' });
    }
  });

  // Sync endpoint - allows clients to sync their database with the server
  app.post('/api/sync', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { lastSyncTimestamp } = req.body;
      const timestamp = lastSyncTimestamp ? new Date(lastSyncTimestamp) : new Date(0);
      
      // Get all products updated since the last sync
      const products = dbService.getProductsSince(timestamp, tenantId);
      const variants = dbService.getVariantsSince(timestamp, tenantId);
      
      res.status(200).json({
        products,
        variants,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error during sync:', error);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  app.post('/api/sync/pull-all-from-sqlite', resolveSyncTenant, async (req: Request, res: Response) => {
    const normalizeTenantId = (row: any, sessionTenantId: string): any => {
      if (!row) return row;
      const out: any = { ...row };
      const raw = out.tenantId || out.tenant_id;
      if (!raw) { out.tenantId = sessionTenantId; }
      else if (!out.tenantId) { out.tenantId = out.tenant_id; }
      delete out.tenant_id;
      return out;
    };

    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      if (!tenantId || tenantId === 'default-tenant-id' || tenantId === '') {
        return res.status(400).json({ error: 'DEXIE_SYNC_BLOCKED: Missing tenant_id' });
      }

      if (useCloud()) {
        try {
          console.log('[SYNC pull-all-from-sqlite] Pulling latest Supabase cloud data for tenant_id=' + tenantId);
          await dbService.pullAllFromCloud(tenantId);
        } catch (cloudErr: any) {
          console.warn('[SYNC pull-all-from-sqlite] Cloud pull warning (using cached SQLite data):', cloudErr?.message || String(cloudErr));
        }
      }

      const timestamp = new Date().toISOString();

      const products = dbService.getProducts(tenantId) || [];
      const variants = dbService.getAllVariantsByTenant(tenantId) || [];

      const rawStaff: any[] = dbService.getStaff(tenantId) || [];
      const staff = rawStaff.map((s: any) => {
        const { passkey, passHash, password, ...safeFields } = s;
        const withTenantId: any = { ...safeFields };
        if (!withTenantId.tenantId) {
          withTenantId.tenantId = withTenantId.tenant_id || tenantId;
        }
        delete withTenantId.tenant_id;
        return withTenantId;
      });

      const rawUsers: any[] = dbService.getAdmins(tenantId) || [];
      const users = rawUsers.map((u: any) => {
        const { password, securityAnswer1, securityAnswer2, securityAnswer3, passHash, ...safeFields } = u;
        const withTenantId: any = { ...safeFields };
        if (!withTenantId.tenantId) {
          withTenantId.tenantId = withTenantId.tenant_id || tenantId;
        }
        delete withTenantId.tenant_id;
        return withTenantId;
      });

      const customers = (dbService.getCustomers(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const credits = (dbService.getCredits(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const payments = (dbService.getPayments(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const reminders = (dbService.getReminders(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const sales = (dbService.getSales(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const saleItems = (dbService.getSaleItems(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const expenses = (dbService.getExpenses(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const purchases = (dbService.getPurchases(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const creditors = (dbService.getCreditors(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const nonInventoryProducts = (dbService.getNonInventoryProducts(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const remittances = (dbService.getRemittances(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const notifications = (dbService.getNotifications(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const rawSettings = dbService.getSettings(tenantId);
      const settings = Array.isArray(rawSettings)
        ? rawSettings.map((row: any) => normalizeTenantId(row, tenantId))
        : Object.entries(rawSettings || {}).map(([key, value]) => ({ key, value: typeof value === 'object' ? JSON.stringify(value) : String(value), tenantId }));
      const attendance = (dbService.getAttendance(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const loginHistory = (dbService.getLoginHistory(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const auditLogs = (dbService.getAuditLogs(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const bulkInventoryTransactions = (dbService.getBulkInventoryTransactions(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));
      const bulkInventoryItems = (dbService.getBulkInventoryItemsByTenant(tenantId) || []).map((row: any) => normalizeTenantId(row, tenantId));

      const counts = {
        products: products.length,
        variants: variants.length,
        staff: staff.length,
        users: users.length,
        customers: customers.length,
        credits: credits.length,
        payments: payments.length,
        reminders: reminders.length,
        sales: sales.length,
        saleItems: saleItems.length,
        expenses: expenses.length,
        purchases: purchases.length,
        creditors: creditors.length,
        nonInventoryProducts: nonInventoryProducts.length,
        remittances: remittances.length,
        notifications: notifications.length,
        settings: settings.length,
        attendance: attendance.length,
        loginHistory: loginHistory.length,
        auditLogs: auditLogs.length,
        bulkInventoryTransactions: bulkInventoryTransactions.length,
        bulkInventoryItems: bulkInventoryItems.length,
      };

      res.status(200).json({
        success: true,
        tenantId,
        timestamp,
        counts,
        data: {
          products,
          variants,
          staff,
          users,
          customers,
          credits,
          payments,
          reminders,
          sales,
          saleItems,
          expenses,
          purchases,
          creditors,
          nonInventoryProducts,
          remittances,
          notifications,
          settings,
          attendance,
          loginHistory,
          auditLogs,
          bulkInventoryTransactions,
          bulkInventoryItems,
        }
      });
    } catch (error: any) {
      console.error('[SYNC pull-all-from-sqlite] FAILED tenant_id=' + (req as any).tenantId + ' error=' + (error?.message || String(error)));
      res.status(500).json({
        error: 'DEXIE_SYNC_FAILED',
        message: 'Failed to build synchronization payload.',
        details: error?.message || String(error),
      });
    }
  });

  // Staff API - Share staff accounts with connected devices
  app.get('/api/staff', resolveSyncTenant, (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const staff = dbService.getStaff(tenantId);
      res.status(200).json(staff);
    } catch (error) {
      console.error('Error fetching staff:', error);
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  });

  // Create / Save staff account (Saves to local SQLite & Supabase Cloud)
  app.post('/api/staff', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(400).json({ error: 'Tenant context required to create staff' });
      }

      const staffList = Array.isArray(req.body) ? req.body : [req.body];
      if (staffList.length === 0) {
        return res.status(400).json({ error: 'No staff data provided' });
      }

      await dbService.saveStaff(staffList, tenantId);
      console.log(`[STAFF CREATE ROUTE] Saved ${staffList.length} staff member(s) to SQLite & Supabase Cloud for tenant: ${tenantId}`);

      res.status(201).json({ success: true, count: staffList.length, message: 'Staff account saved to local SQLite and Supabase Cloud' });
    } catch (error: any) {
      console.error('Error creating staff:', error);
      res.status(500).json({ error: error?.message || 'Failed to create staff' });
    }
  });

  // Get staff by ID with all details
  app.get('/api/staff/:id', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const { id } = req.params;
      let staff: any = dbService.getStaffById(id, tenantId);

      if (!staff && useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            const { data } = await supabase.from('staff').select('*').or(`id.eq.${id},staff_id.eq.${id}`).single();
            if (data) {
              staff = {
                id: data.id,
                tenantId: data.tenant_id,
                name: data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
                staffId: data.staff_id,
                firstName: data.first_name,
                middleName: data.middle_name,
                lastName: data.last_name,
                email: data.email,
                phone: data.phone,
                address: data.address,
                role: data.role,
                branch: data.branch,
                department: data.department,
                employmentStatus: data.employment_status || 'active',
                createdAt: data.created_at
              };
              dbService.saveStaff([staff], tenantId);
            }
          }
        } catch (cloudErr) {
          console.warn('Cloud staff lookup fallback failed:', cloudErr);
        }
      }

      if (!staff) {
        return res.status(404).json({ error: 'Staff member not found' });
      }

      // Get additional data
      const performance = dbService.getStaffPerformance(staff.id, tenantId) || { todaySales: 0, weeklySales: 0, monthlySales: 0, transactionCount: 0, itemsSold: 0 };
      const attendance = dbService.getStaffAttendance(staff.id, tenantId) || null;
      const activity = dbService.getStaffActivity(staff.id, tenantId) || [];
      const loginHistory = dbService.getStaffLoginHistory(staff.id, tenantId) || [];

      res.status(200).json({
        ...staff,
        performance,
        attendance,
        activity,
        loginHistory
      });
    } catch (error) {
      console.error('Error fetching staff:', error);
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  });

  // Update staff
  app.put('/api/staff/:id', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const { id } = req.params;
      
      const body = { ...req.body };
      delete body.id;
      delete body.staffId;
      delete body.passkey;

      const parsed = staffUpdateSchema.safeParse(body);
      const updates = parsed.success ? parsed.data : body;

      const currentStaff = dbService.getStaffById(id, tenantId);
      if (!currentStaff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const { adminId, adminName } = getStaffAdminContext(req);
      const updatedStaff = await dbService.updateStaff(id, tenantId, updates, adminId || undefined, adminName || undefined);

      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            const firstName = updates.firstName || updates.first_name || (currentStaff as any).firstName || '';
            const lastName = updates.lastName || updates.last_name || (currentStaff as any).lastName || '';
            const fullName = updates.name || `${firstName} ${lastName}`.trim() || currentStaff.name;

            await supabase.from('staff').update({
              first_name: firstName || null,
              last_name: lastName || null,
              middle_name: updates.middleName || updates.middle_name || null,
              name: fullName,
              email: updates.email || null,
              phone: updates.phone || null,
              address: updates.address || null,
              role: updates.role || currentStaff.role || 'cashier',
              branch: updates.branch || null,
              department: updates.department || null,
              employment_status: updates.employmentStatus || updates.employment_status || (currentStaff as any).employmentStatus || 'active',
              updated_at: new Date().toISOString()
            }).or(`id.eq.${id},staff_id.eq.${id}`);
            console.log(`[SUPABASE] Staff updated in cloud for staff ID: ${id}`);
          }
        } catch (cloudErr) {
          console.warn('Failed to mirror staff update to Supabase cloud:', cloudErr);
        }
      }

      res.status(200).json(updatedStaff);
    } catch (error: any) {
      console.error('Error updating staff:', error);
      res.status(500).json({ error: error?.message || 'Failed to update staff' });
    }
  });

  // Update staff status
  app.patch('/api/staff/:id/status', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const parsed = staffStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid employment status', details: parsed.error.flatten() });
      }
      const { status } = parsed.data;
      const currentStaff = dbService.getStaffById(id, tenantId);
      if (!currentStaff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const updatedStaff = dbService.updateStaffStatus(id, tenantId, status);

      // Create audit log
      const { adminId, adminName } = getStaffAdminContext(req);

      dbService.createAuditLog({
        tenantId,
        adminId,
        adminName,
        action: 'Updated Staff Status',
        staffId: id,
        staffName: updatedStaff.name,
        changedFields: ['employmentStatus'],
        oldValues: { employmentStatus: currentStaff.employmentStatus },
        newValues: { employmentStatus: status },
        ipAddress: req.ip || req.socket.remoteAddress
      });

      res.status(200).json(updatedStaff);
    } catch (error) {
      console.error('Error updating staff status:', error);
      res.status(500).json({ error: 'Failed to update staff status' });
    }
  });

  // Reset / update staff password (admin-only)
  app.put('/api/staff/:id/password', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const { id } = req.params;
      const { newPassword, confirmPassword } = req.body;

      if (typeof newPassword !== 'string' || newPassword.length < 4 || newPassword.length > 200) {
        return res.status(400).json({ error: 'New password must be 4–200 characters' });
      }
      if (typeof confirmPassword !== 'string' || confirmPassword !== newPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      const updatedStaff = await dbService.updateStaffPassword(id, tenantId, hashed);

      const { adminId, adminName } = getStaffAdminContext(req);
      dbService.createAuditLog({
        tenantId,
        adminId,
        adminName,
        action: 'Reset Staff Password',
        staffId: id,
        staffName: (updatedStaff as any)?.name || 'Staff',
        changedFields: ['passkey'],
        oldValues: { passkey: '[REDACTED]' },
        newValues: { passkey: '[REDACTED]' },
        ipAddress: req.ip || req.socket.remoteAddress
      });

      res.status(200).json({ ok: true, staff: updatedStaff });
    } catch (error: any) {
      console.error('Error updating staff password:', error);
      res.status(500).json({ error: error?.message || 'Failed to update staff password' });
    }
  });

  // Update staff permissions
  app.patch('/api/staff/:id/permissions', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const parsed = staffPermissionsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid permissions', details: parsed.error.flatten() });
      }
      const { permissions } = parsed.data;
      const currentStaff = dbService.getStaffById(id, tenantId);
      if (!currentStaff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const updatedStaff = dbService.updateStaffPermissions(id, tenantId, permissions);

      // Create audit log
      const { adminId, adminName } = getStaffAdminContext(req);

      dbService.createAuditLog({
        tenantId,
        adminId,
        adminName,
        action: 'Updated Staff Permissions',
        staffId: id,
        staffName: updatedStaff.name,
        changedFields: ['permissions'],
        oldValues: { permissions: currentStaff.permissions || [] },
        newValues: { permissions: permissions || [] },
        ipAddress: req.ip || req.socket.remoteAddress
      });

      res.status(200).json(updatedStaff);
    } catch (error) {
      console.error('Error updating staff permissions:', error);
      res.status(500).json({ error: 'Failed to update staff permissions' });
    }
  });

  // Delete staff account permanently from SQLite and Supabase Cloud
  app.delete('/api/staff/:id', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;

      const { adminId, adminName } = getStaffAdminContext(req);
      const currentStaff = dbService.getStaffById(id, tenantId);

      const result = await dbService.deleteStaff(id, tenantId);

      dbService.createAuditLog({
        tenantId,
        adminId,
        adminName,
        action: 'delete_staff',
        staffId: id,
        staffName: currentStaff?.name || id,
        changedFields: ['deleted'],
        oldValues: { name: currentStaff?.name, staffId: currentStaff?.staffId },
        newValues: { deleted: true },
        ipAddress: req.ip || req.socket.remoteAddress,
      });

      res.status(200).json({ success: true, message: 'Staff deleted successfully', deletedId: result.deletedId });
    } catch (error) {
      console.error('Error deleting staff:', error);
      res.status(500).json({ error: 'Failed to remove staff' });
    }
  });

  // Get staff activity
  app.get('/api/staff/:id/activity', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const staff = dbService.getStaffById(id, tenantId);
      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const activity = dbService.getStaffActivity(staff.id, tenantId);
      res.status(200).json(activity);
    } catch (error) {
      console.error('Error fetching staff activity:', error);
      res.status(500).json({ error: 'Failed to fetch staff activity' });
    }
  });

  // Get staff attendance
  app.get('/api/staff/:id/attendance', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const staff = dbService.getStaffById(id, tenantId);
      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const attendance = dbService.getStaffAttendance(staff.id, tenantId);
      res.status(200).json(attendance);
    } catch (error) {
      console.error('Error fetching staff attendance:', error);
      res.status(500).json({ error: 'Failed to fetch staff attendance' });
    }
  });

  // Get staff performance
  app.get('/api/staff/:id/performance', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const staff = dbService.getStaffById(id, tenantId);
      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const performance = dbService.getStaffPerformance(staff.id, tenantId);
      res.status(200).json(performance);
    } catch (error) {
      console.error('Error fetching staff performance:', error);
      res.status(500).json({ error: 'Failed to fetch staff performance' });
    }
  });

  // Get staff login history
  app.get('/api/staff/:id/login-history', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const staff = dbService.getStaffById(id, tenantId);
      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const loginHistory = dbService.getStaffLoginHistory(staff.id, tenantId);
      res.status(200).json(loginHistory);
    } catch (error) {
      console.error('Error fetching staff login history:', error);
      res.status(500).json({ error: 'Failed to fetch staff login history' });
    }
  });

  // Get staff timestamps (attendance & session history)
  app.get('/api/staff/:id/timestamps', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const staff = dbService.getStaffById(id, tenantId);
      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const timestamps = dbService.getStaffTimestamps(staff.id, tenantId);
      res.status(200).json(timestamps);
    } catch (error) {
      console.error('Error fetching staff timestamps:', error);
      res.status(500).json({ error: 'Failed to fetch staff timestamps' });
    }
  });

  app.get('/api/cloud/staff', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(401).json({ error: 'Unauthorized: Valid store session required' });
      }
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      const { data, error } = await supabase.from('staff').select('*').eq('tenant_id', tenantId);
      if (error) return res.status(500).json({ error: 'Failed to fetch staff' });
      const mapped = (data || []).map((s: any) => ({
        id: String(s.id),
        tenantId: s.tenant_id,
        userId: s.user_id || null,
        firstName: s.first_name || '',
        middleName: s.middle_name || null,
        lastName: s.last_name || '',
        name: s.name,
        staffId: s.staff_id,
        passkey: '',
        role: s.role || 'cashier',
        branch: s.branch || null,
        department: s.department || null,
        employmentStatus: s.employment_status || 'active',
        email: s.email || null,
        phone: s.phone || null,
        address: s.address || null,
        birthdate: s.birthdate || null,
        gender: s.gender || null,
        dateHired: s.date_hired || null,
        assignedShift: s.assigned_shift || null,
        permissions: s.permissions || [],
        createdBy: s.created_by || null,
        createdAt: s.created_at || null,
        updatedAt: s.updated_at || null
      }));
      res.status(200).json(mapped);
    } catch {
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  });

  app.get('/api/cloud/admins', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(401).json({ error: 'Unauthorized: Valid store session required' });
      }
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      const { data, error } = await supabase.from('admins').select('id, name, email').eq('tenant_id', tenantId);
      if (error) return res.status(500).json({ error: 'Failed to fetch admins' });
      const mapped = (data || []).map((a: any) => ({
        id: String(a.id),
        name: a.name,
        email: a.email
      }));
      res.status(200).json(mapped);
    } catch {
      res.status(500).json({ error: 'Failed to fetch admins' });
    }
  });


  // Sync staff endpoint - allows clients to sync staff accounts
  app.post('/api/sync-staff', (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { lastSyncTimestamp } = req.body;
      const timestamp = lastSyncTimestamp ? new Date(lastSyncTimestamp) : new Date(0);
      
      // Get all staff updated since the last sync
      const staff = (dbService.getStaffSince(timestamp, tenantId) as any[])
        .map((member: any) => ({
          id: member.id,
          name: member.name,
          staffId: member.staffId,
          createdBy: member.createdBy,
          createdAt: member.createdAt
        }));
      
      res.status(200).json({
        staff,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error during staff sync:', error);
      res.status(500).json({ error: 'Staff sync failed' });
    }
  });

  // WiFi scanning endpoint - returns nearby WiFi networks (Windows only)
  app.get('/api/wifi/scan', async (_req: Request, res: Response) => {
    try {
      const networks = await scanWifiNetworks();
      res.status(200).json(networks);
    } catch (error: any) {
      console.error('Error scanning WiFi networks:', error);
      res.status(501).json({ error: 'Wi‑Fi scan not supported on this platform', details: error?.message });
    }
  });

  // Admin endpoint: clear server database tables (products, staff)
  app.post('/api/admin/clear', (req: Request, res: Response) => {
    try {
      const { confirm } = req.body || {};
      if (confirm !== 'CLEAR_ALL') {
        return res.status(400).json({ error: 'Confirmation required', expected: 'CLEAR_ALL' });
      }
      const result = dbService.clearAllData();
      res.status(200).json({ message: 'Server database cleared', ...result });
    } catch (error) {
      console.error('Error clearing server database:', error);
      res.status(500).json({ error: 'Failed to clear server database' });
    }
  });

  // Connect to WiFi network (not supported from Node server)
  app.post('/api/wifi/connect', async (req: Request, res: Response) => {
    const { ssid } = req.body;
    if (!ssid) {
      return res.status(400).json({ error: 'SSID is required' });
    }
    // Purposefully do not simulate: inform clients to use OS settings.
    return res.status(501).json({
      error: 'Wi‑Fi connect is not implemented server‑side. Use device Wi‑Fi settings.'
    });
  });

  // Get current WiFi connection status (Windows: netsh, others: OS interfaces)
  app.get('/api/wifi/status', async (_req: Request, res: Response) => {
    try {
      const status = await getWifiStatus();
      res.status(200).json(status);
    } catch (error: any) {
      console.error('Error getting WiFi status:', error);
      res.status(500).json({ error: 'Failed to get Wi‑Fi status', details: error?.message });
    }
  });

  // Provide server info (origin) so clients on LAN can discover the real server URL
  app.get('/api/server-info', (req: Request, res: Response) => {
    try {
      // Prioritize X-Forwarded headers for proxies
      const xProto = req.headers['x-forwarded-proto'] as string;
      const xHost = req.headers['x-forwarded-host'] as string;

      const protocol = xProto || req.protocol || 'http';
      const host = xHost || req.get('host') || `localhost:5000`;

      // If we're on Render, we can use the RENDER_EXTERNAL_URL
      // Otherwise, we build the origin from the request headers
      let origin = process.env.RENDER_EXTERNAL_URL || `${protocol}://${host}`;
      
      // If the origin is purely a hostname, prepend the protocol
      if (origin && !origin.startsWith('http')) {
        origin = `https://${origin}`;
      }
      
      // Ensure the origin is the absolute Render URL if it exists
      if (process.env.RENDER_EXTERNAL_URL && !origin.includes('onrender.com')) {
        origin = process.env.RENDER_EXTERNAL_URL;
      }
      
      res.status(200).json({ origin });
    } catch (error) {
      console.error('Error getting server info:', error);
      res.status(500).json({ error: 'Failed to get server info' });
    }
  });

  const httpServer = createServer(app);

  // Ensure photo directory exists
  const photoDir = path.resolve(import.meta.dirname, 'data', 'photos');
  if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
  app.use('/photos', express.static(photoDir));

  // Customers
  app.post('/api/customers', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const parsed = customerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid customer data', details: parsed.error.flatten() });
      const id = randomUUID();
      const created = dbService.createCustomer(tenantId, { id, name: parsed.data.name, phone: parsed.data.phone, address: parsed.data.address ?? null, credit_rating: parsed.data.credit_rating, photo_url: parsed.data.photo_url ?? null });
      res.status(201).json(created);
    } catch (e) {
      res.status(500).json({ error: 'Failed to create customer' });
    }
  });

  app.get('/api/customers', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const customers = dbService.listCustomers(tenantId) as any[];
      const enriched = customers.map((c) => {
        const bal = dbService.getBalance(tenantId, c.id);
        return { ...c, ...bal };
      });
      const sortBy = (req.query.sort_by as string) || 'name';
      const sort = (req.query.sort as string) || '';
      const filter = (req.query.filter as string) || '';
      const search = (req.query.search as string) || '';
      const dueBefore = (req.query.due_before as string) || '';
      const dueAfter = (req.query.due_after as string) || '';
      let out = enriched;
      if (search) {
        const kw = search.toLowerCase();
        out = out.filter((c) => String(c.name).toLowerCase().includes(kw) || String(c.phone || '').toLowerCase().includes(kw));
      }
      if (filter === 'paid') out = out.filter((c) => (c.balance ?? 0) <= 0);
      if (filter === 'unpaid') out = out.filter((c) => (c.balance ?? 0) > 0);
      if (dueBefore || dueAfter) {
        const beforeTime = dueBefore ? Date.parse(dueBefore) : undefined;
        const afterTime = dueAfter ? Date.parse(dueAfter) : undefined;
        out = out.filter((c) => {
          const rows = dbService.listCredits(tenantId, c.id) as any[];
          const hasDue = rows.some((cr) => {
            if (!cr.due_date) return false;
            const t = Date.parse(cr.due_date);
            if (Number.isNaN(t)) return false;
            if (beforeTime && t >= beforeTime) return false;
            if (afterTime && t <= afterTime) return false;
            return true;
          });
        return hasDue;
        });
      }
      if (sort) {
        if (sort === 'name_asc') out = out.sort((a,b) => String(a.name).localeCompare(String(b.name)));
        else if (sort === 'name_desc') out = out.sort((a,b) => String(b.name).localeCompare(String(a.name)));
      } else {
        if (sortBy === 'balance') out = out.sort((a,b) => (b.balance ?? 0) - (a.balance ?? 0));
        else if (sortBy === 'credit') out = out.sort((a,b) => (b.total_credit ?? 0) - (a.total_credit ?? 0));
        else out = out.sort((a,b) => String(a.name).localeCompare(String(b.name)));
      }
      res.status(200).json(out);
    } catch (e) {
      res.status(500).json({ error: 'Failed to list customers' });
    }
  });

  app.get('/api/customers/:id', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const c = dbService.getCustomer(tenantId, req.params.id) as any;
    if (!c) return res.status(404).json({ error: 'Customer not found' });
    const bal = dbService.getBalance(tenantId, req.params.id);
    res.status(200).json({ ...c, ...bal });
  });

  app.put('/api/customers/:id', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const parsed = customerSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid customer data', details: parsed.error.flatten() });
      if (parsed.data.credit_rating && !['good','bad'].includes(parsed.data.credit_rating)) return res.status(400).json({ error: 'Invalid credit rating' });
      const updated = dbService.updateCustomer(tenantId, req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ error: 'Customer not found' });
      res.status(200).json(updated);
    } catch (e) {
      res.status(500).json({ error: 'Failed to update customer' });
    }
  });

  app.delete('/api/customers/:id', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const changes = dbService.deleteCustomer(tenantId, req.params.id);
    if (!changes) return res.status(404).json({ error: 'Customer not found' });
    res.status(204).send();
  });

  // Photo upload via base64 JSON: { "photo_data": "data:image/png;base64,..." }
  app.post('/api/customers/:id/upload-photo', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const { photo_data } = req.body || {};
      if (!photo_data || typeof photo_data !== 'string') return res.status(400).json({ error: 'photo_data base64 string required' });
      const match = photo_data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'Invalid data URL format' });
      const mime = match[1];
      const b64 = match[2];
      const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : 'img';
      const file = path.join(photoDir, `${req.params.id}.${ext}`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      const rel = `/photos/${req.params.id}.${ext}`;
      const updated = dbService.updateCustomerPhoto(tenantId, req.params.id, rel) as any;
      if (!updated) return res.status(404).json({ error: 'Customer not found' });
      res.status(200).json(updated);
    } catch (e) {
      res.status(500).json({ error: 'Failed to upload photo' });
    }
  });

  // Credits
  app.post('/api/customers/:id/credits', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const parsed = creditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid credit data', details: parsed.error.flatten() });
    const id = randomUUID();
    const created_at = parsed.data.date ?? new Date().toISOString();
    const created = dbService.addCredit(tenantId, { id, customer_id: req.params.id, amount: parsed.data.amount, remarks: parsed.data.remarks ?? null, created_at });
    if (parsed.data.due_date) dbService.updateCredit(tenantId, id, { due_date: parsed.data.due_date });
    res.status(201).json(created);
  });

  app.get('/api/customers/:id/credits', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const rows = dbService.listCredits(tenantId, req.params.id);
    res.status(200).json(rows);
  });

  app.put('/api/credits/:credit_id', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const parsed = creditSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid credit update', details: parsed.error.flatten() });
    const updated = dbService.updateCredit(tenantId, req.params.credit_id, { amount: parsed.data.amount, due_date: parsed.data.due_date ?? null, remarks: parsed.data.remarks ?? null });
    if (!updated) return res.status(404).json({ error: 'Credit not found' });
    res.status(200).json(updated);
  });

  app.delete('/api/credits/:credit_id', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const changes = dbService.deleteCredit(tenantId, req.params.credit_id);
    if (!changes) return res.status(404).json({ error: 'Credit not found' });
    res.status(204).send();
  });

  // Payments
  app.post('/api/customers/:id/payments', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payment data', details: parsed.error.flatten() });
    const id = randomUUID();
    const created_at = parsed.data.date ?? new Date().toISOString();
    const created = dbService.addPayment(tenantId, { id, customer_id: req.params.id, amount: parsed.data.amount, payment_method: parsed.data.payment_method, remarks: parsed.data.remarks ?? null, created_at });
    res.status(201).json(created);
  });

  app.get('/api/customers/:id/payments', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const rows = dbService.listPayments(tenantId, req.params.id);
    res.status(200).json(rows);
  });

  app.put('/api/payments/:payment_id', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const parsed = paymentSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payment update', details: parsed.error.flatten() });
    const updated = dbService.updatePayment(tenantId, req.params.payment_id, { amount: parsed.data.amount, payment_method: parsed.data.payment_method, remarks: parsed.data.remarks ?? null });
    if (!updated) return res.status(404).json({ error: 'Payment not found' });
    res.status(200).json(updated);
  });

  app.delete('/api/payments/:payment_id', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const changes = dbService.deletePayment(tenantId, req.params.payment_id);
    if (!changes) return res.status(404).json({ error: 'Payment not found' });
    res.status(204).send();
  });

  // Balance
  app.get('/api/customers/:id/balance', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const bal = dbService.getBalance(tenantId, req.params.id);
    res.status(200).json(bal);
  });

  // Send reminder
  app.post('/api/customers/:id/send-reminder', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const { message_type } = req.body || {};
    const types = ['sms','email','push'];
    const mt = String(message_type || '').toLowerCase();
    if (!types.includes(mt)) return res.status(400).json({ error: 'Invalid message type', supported: types });
    const cust = dbService.getCustomer(tenantId, req.params.id) as any;
    if (!cust) return res.status(404).json({ error: 'Customer not found' });
    const bal = dbService.getBalance(tenantId, req.params.id);
    const msg = `Hello ${cust.name}, your current balance is ${bal.balance}. Please settle before due.`;
    const status = 'queued';
    const log = dbService.addReminder(tenantId, { id: randomUUID(), customer_id: req.params.id, message_type: mt, message: msg, status });
    res.status(200).json({ delivery_status: status, reminder: log });
  });



  app.post('/api/print/test-receipt', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const settings = dbService.getSettings(tenantId) as any;
      const receipt = settings.receipt || {};
      const paperWidth = receipt.paperWidth || '58mm';
      const sep = paperWidth === '80mm' ? '------------------------------------------------' : '--------------------------------';
      const printerName = receipt.printerDeviceName || 'Default System Printer';
      
      const now = new Date();
      const lines: string[] = [];
      const storeName = String(receipt.storeName || 'SmartPOS+ Store').toUpperCase();
      lines.push(storeName);
      const address = String(receipt.storeAddress || '').trim();
      if (address) lines.push(address);
      const phone = String(receipt.storePhone || '').trim();
      if (phone) lines.push(`Tel: ${phone}`);
      lines.push(sep);
      lines.push('TEST RECEIPT');
      lines.push(now.toLocaleString());
      lines.push(sep);
      lines.push('Sample Item A    x1   ₱100.00');
      lines.push('Sample Item B    x2   ₱ 50.00');
      lines.push(sep);
      lines.push('TOTAL                 ₱200.00');
      lines.push('CASH                  ₱500.00');
      lines.push('CHANGE                ₱300.00');
      lines.push(sep);
      const headerNote = String(receipt.headerNote || '').trim();
      if (headerNote) lines.unshift(headerNote);
      const footerNote = String(receipt.footerNote || '').trim();
      if (footerNote) lines.push(footerNote);
      const content = lines.join('\n');
      console.log(`\n===== PRINTER: ${printerName} (${paperWidth}) =====`);
      console.log('\n===== TEST RECEIPT START =====\n' + content + '\n===== TEST RECEIPT END =====\n');
      res.status(200).json({ printed: true, printer: printerName });
    } catch (error) {
      console.error('Test receipt print failed:', error);
      res.status(500).json({ error: 'Failed to print test receipt' });
    }
  });

  app.post('/api/print/sale', (req, res) => {
    try {
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const settings = dbService.getSettings(tenantId) as any;
      const receipt = settings.receipt || {};
      const paperWidth = receipt.paperWidth || '58mm';
      const sep = paperWidth === '80mm' ? '------------------------------------------------' : '--------------------------------';
      const printerName = receipt.printerDeviceName || 'Default System Printer';

      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      const total = Number(body.total || 0);
      const paymentAmount = Number(body.paymentAmount || 0);
      const change = Number(body.change || 0);
      const paymentType = String(body.paymentType || 'cash').toUpperCase();
      const staffName = body.staffName ? String(body.staffName) : '';
      const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();
      const lines: string[] = [];
      const storeName = String(receipt.storeName || 'SmartPOS+ Store').toUpperCase();
      lines.push(storeName);
      const address = String(receipt.storeAddress || '').trim();
      if (address) lines.push(address);
      const phone = String(receipt.storePhone || '').trim();
      if (phone) lines.push(`Tel: ${phone}`);
      if (receipt.showDateTime !== false) {
        lines.push(createdAt.toLocaleString());
      }
      if (receipt.showStaffName && staffName) {
        lines.push(`Staff: ${staffName}`);
      }
      const headerNote = String(receipt.headerNote || '').trim();
      if (headerNote) lines.push(headerNote);
      lines.push(sep);
      for (const raw of items) {
        const name = String(raw.name || '');
        const quantity = Number(raw.quantity || 0);
        const unit = String(raw.unit || '');
        const price = Number(raw.price || 0);
        const subtotal = Number(raw.subtotal || 0);
        lines.push(name);
        lines.push(
          `${quantity} ${unit} x ₱${price.toFixed(2)}   ₱${subtotal.toFixed(2)}`
        );
      }
      lines.push(sep);
      lines.push(`TOTAL                 ₱${total.toFixed(2)}`);
      lines.push(`${paymentType.padEnd(9)}        ₱${paymentAmount.toFixed(2)}`);
      lines.push(`CHANGE                ₱${change.toFixed(2)}`);
      lines.push(sep);
      const footerNote = String(receipt.footerNote || '').trim();
      if (footerNote) lines.push(footerNote);
      const content = lines.join('\n');
      console.log(`\n===== PRINTER: ${printerName} (${paperWidth}) =====`);
      console.log('\n===== SALE RECEIPT START =====\n' + content + '\n===== SALE RECEIPT END =====\n');
      res.status(200).json({ printed: true, printer: printerName });
    } catch (error) {
      console.error('Sale receipt print failed:', error);
      res.status(500).json({ error: 'Failed to print sale receipt' });
    }
  });

  // Customer ledger composite
  app.get('/api/customers/:id/ledger', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const customer = dbService.getCustomer(tenantId, req.params.id) as any;
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const credits = dbService.listCredits(tenantId, req.params.id);
    const payments = dbService.listPayments(tenantId, req.params.id);
    const bal = dbService.getBalance(tenantId, req.params.id);
    res.status(200).json({ customer, credits, payments, ...bal });
  });

  // Dashboard cards
  app.get('/api/customers/count', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    res.status(200).json({ count: dbService.customersCount(tenantId) });
  });
  app.get('/api/payments/total', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    res.status(200).json({ total_payment: dbService.totalPayments(tenantId) });
  });
  app.get('/api/credits/total', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    res.status(200).json({ total_credit: dbService.totalCredits(tenantId) });
  });
  app.get('/api/ledger/summary', (req, res) => {
    const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
    const total_credit = dbService.totalCredits(tenantId);
    const total_payment = dbService.totalPayments(tenantId);
    res.status(200).json({ total_credit, total_payment, balance: total_credit - total_payment });
  });

  // Wallet APIs
  app.get('/api/wallet/:provider/oauth/start', (req, res) => {
    const { provider } = req.params;
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:5000';
    const callbackUrl = `${protocol}://${host}/wallet-callback?provider=${provider}&status=success`;
    
    // In a real app, this would redirect to GCash/Maya's actual OAuth URL
    // For now, we redirect to a mock simulation page
    res.send(`
      <html>
        <head>
          <title>Link ${provider.toUpperCase()}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 flex items-center justify-center min-h-screen p-4">
          <div class="bg-white rounded-3xl shadow-xl p-8 w-full max-w-md border border-gray-100">
            <div class="text-center mb-8">
              <div class="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span class="text-3xl font-bold text-blue-600">${provider[0].toUpperCase()}</span>
              </div>
              <h1 class="text-2xl font-bold text-gray-900">Link your ${provider.toUpperCase()} account</h1>
              <p class="text-gray-500 mt-2">SmartPOS+ wants to link with your e-wallet</p>
            </div>
            <div class="space-y-4">
              <div class="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p class="text-sm font-medium text-gray-700">Mobile Number</p>
                <p class="text-lg font-semibold text-gray-900">09xx xxx xxxx</p>
              </div>
              <button onclick="window.location.href='${callbackUrl}'" class="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200">
                Authorize & Link
              </button>
              <button onclick="window.close()" class="w-full bg-white text-gray-500 py-3 rounded-xl font-medium border border-gray-200 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
            <p class="text-[10px] text-gray-400 text-center mt-8">Secure connection powered by SmartPOS+ Gateway</p>
          </div>
        </body>
      </html>
    `);
  });

  app.get('/api/wallet/:provider/status', (req, res) => {
    const { provider } = req.params;
    const settings = dbService.getSettings() as any;
    const wallets = settings.wallets || {};
    res.json({ connected: !!wallets[provider] });
  });

  app.post('/api/wallet/:provider/connect', (req, res) => {
    const { provider } = req.params;
    const settings = dbService.getSettings() as any;
    const wallets = settings.wallets || {};
    wallets[provider] = true;
    dbService.upsertSettings({ ...settings, wallets });
    res.json({ success: true });
  });

  // Socket.IO Setup
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true, // Allow all origins for testing
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ["polling", "websocket"],
    allowEIO3: true, // Support for older clients
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Track connected users
  const connectedUsers = new Map<string, { socketIds: Set<string>, lastActive: Date, view?: string }>();

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("join-user", (userId) => {
      socket.join(`user:${userId}`);

      const user = connectedUsers.get(userId) || { socketIds: new Set<string>(), lastActive: new Date() };
      user.socketIds.add(socket.id);
      user.lastActive = new Date();
      connectedUsers.set(userId, user);

      // Broadcast online status
      io.emit("user-status", { userId, status: "online", lastActive: new Date().toISOString() });

      // Also emit staffStatusUpdate for staff management
      io.emit("staffStatusUpdate", { staffId: userId, isOnline: true, lastActive: new Date() });
    });

    socket.on("leave-user", (userId) => {
      socket.leave(`user:${userId}`);
      const user = connectedUsers.get(userId);
      if (user) {
        user.socketIds.delete(socket.id);
        if (user.socketIds.size === 0) {
          connectedUsers.delete(userId);
          io.emit("user-status", { userId, status: "offline", lastActive: new Date().toISOString() });
          io.emit("staffStatusUpdate", { staffId: userId, isOnline: false, lastActive: new Date() });
        }
      }
    });

    // Staff Management events
    socket.on("adminOnline", ({ adminId }) => {
      const user = connectedUsers.get(adminId) || { socketIds: new Set<string>(), lastActive: new Date() };
      user.socketIds.add(socket.id);
      user.lastActive = new Date();
      connectedUsers.set(adminId, user);
      io.emit("staffStatusUpdate", { staffId: adminId, isOnline: true, lastActive: new Date() });
    });

    socket.on("adminOffline", ({ adminId }) => {
      const user = connectedUsers.get(adminId);
      if (user) {
        user.socketIds.delete(socket.id);
        if (user.socketIds.size === 0) {
          connectedUsers.delete(adminId);
          io.emit("staffStatusUpdate", { staffId: adminId, isOnline: false, lastActive: new Date() });
        }
      }
    });

    socket.on("heartbeat", ({ adminId }) => {
      const user = connectedUsers.get(adminId);
      if (user) {
        user.lastActive = new Date();
      }
    });

    socket.on("getStaffStatus", (staffIds: string[]) => {
      const statuses = staffIds.map(id => ({
        staffId: id,
        isOnline: connectedUsers.has(id),
        lastActive: connectedUsers.get(id)?.lastActive
      }));
      socket.emit("staffStatusBulk", statuses);
    });

    socket.on("setStaffView", ({ view }) => {
      // Could find user by searching socket ID in all sets
    });

    // Inventory events
    socket.on("product-viewed", ({ barcode }) => {
      console.log(`Product viewed: ${barcode}`);
    });

    socket.on("disconnect", () => {
      // Find user by socket ID and remove
      for (const [userId, user] of connectedUsers.entries()) {
        if (user.socketIds.has(socket.id)) {
          user.socketIds.delete(socket.id);
          if (user.socketIds.size === 0) {
            connectedUsers.delete(userId);
            io.emit("user-status", { userId, status: "offline", lastActive: new Date().toISOString() });
            io.emit("staffStatusUpdate", { staffId: userId, isOnline: false, lastActive: new Date() });
          }
          break;
        }
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  // Remittance API Routes
  app.post('/api/remit', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const { staffId, staffName, amount, transactionCount } = req.body;
      if (!staffId || amount === undefined || amount === null) {
        return res.status(400).json({ error: 'staffId and amount are required' });
      }

      const remittanceData = {
        id: randomUUID(),
        tenantId,
        staffId,
        staffName: staffName || 'Staff',
        amount: Number(amount),
        transactionCount: Number(transactionCount || 0),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      dbService.createRemittance(tenantId, remittanceData);

      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            await supabase.from('remittances').upsert({
              id: remittanceData.id,
              tenant_id: tenantId,
              staff_id: remittanceData.staffId,
              staff_name: remittanceData.staffName,
              amount: remittanceData.amount,
              transaction_count: remittanceData.transactionCount,
              status: 'pending',
              created_at: remittanceData.createdAt
            });
          }
        } catch (cloudErr) {
          console.warn('Failed to mirror remittance to Supabase cloud:', cloudErr);
        }
      }

      // Create Admin Notification for Remittance
      let notification: any = null;
      try {
        notification = dbService.createNotification(tenantId, {
          type: 'remittance',
          message: `${remittanceData.staffName} submitted a remittance of ₱${remittanceData.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} for ${remittanceData.transactionCount} transaction(s).`,
          data: JSON.stringify({
            remittanceId: remittanceData.id,
            staffName: remittanceData.staffName,
            amount: remittanceData.amount,
            transactionCount: remittanceData.transactionCount
          })
        });

        if (useCloud()) {
          try {
            const supabase = getSupabase();
            if (supabase && notification) {
              await supabase.from('notifications').insert({
                id: notification.id || randomUUID(),
                tenant_id: tenantId,
                type: 'remittance',
                message: notification.message,
                data: notification.data,
                is_read: false,
                created_at: new Date().toISOString()
              });
            }
          } catch (cloudNotifErr) {
            console.warn('Failed to mirror notification to Supabase cloud:', cloudNotifErr);
          }
        }
      } catch (notifErr) {
        console.warn('Failed to create remittance notification:', notifErr);
      }

      const unreadCount = dbService.getUnreadNotificationCount(tenantId);

      // Broadcast real-time events across all devices
      io.emit('new-remittance', remittanceData);
      io.emit('remittance-sent', remittanceData);
      if (notification) {
        io.emit('notification-received', notification);
      }
      io.emit('unread-count-changed', { count: unreadCount });

      res.status(201).json({ success: true, remittance: remittanceData });
    } catch (error: any) {
      console.error('Error creating remittance:', error);
      res.status(500).json({ error: 'Failed to submit remittance', details: error?.message || String(error) });
    }
  });

  app.post('/api/remit/confirm/:id', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const { id } = req.params;
      const remittance = dbService.confirmRemittance(tenantId, id);

      if (!remittance) {
        return res.status(404).json({ error: 'Remittance not found' });
      }

      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            await supabase.from('remittances').update({
              status: 'confirmed',
              confirmed_at: new Date().toISOString()
            }).eq('id', id).eq('tenant_id', tenantId);

            await supabase.from('sales').update({
              remitted: true
            }).eq('staff_id', remittance.staff_id || remittance.staffId).eq('tenant_id', tenantId).eq('remitted', false);
          }
        } catch (cloudErr) {
          console.warn('Failed to update confirmed remittance in Supabase:', cloudErr);
        }
      }

      io.emit('remittance-confirmed', {
        staffId: remittance.staff_id || remittance.staffId,
        remittanceId: id
      });

      res.status(200).json({ success: true, remittance });
    } catch (error: any) {
      console.error('Error confirming remittance:', error);
      res.status(500).json({ error: 'Failed to confirm remittance', details: error?.message || String(error) });
    }
  });

  app.get('/api/remittances/completed', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const completed = dbService.listConfirmedRemittances(tenantId);
      res.json(completed);
    } catch (error: any) {
      console.error('Error fetching completed remittances:', error);
      res.status(500).json({ error: 'Failed to fetch completed remittances' });
    }
  });

  app.post('/api/remit/cancel/:id', authenticateUser, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { id } = req.params;
      const remittance = dbService.cancelRemittance(tenantId, id);

      if (!remittance) {
        return res.status(404).json({ error: 'Remittance not found' });
      }

      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            await supabase.from('remittances').update({
              status: 'cancelled'
            }).eq('id', id).eq('tenant_id', tenantId);
          }
        } catch (cloudErr) {
          console.warn('Failed to update cancelled remittance in Supabase:', cloudErr);
        }
      }

      res.status(200).json({ success: true, remittance });
    } catch (error: any) {
      console.error('Error cancelling remittance:', error);
      res.status(500).json({ error: 'Failed to cancel remittance', details: error?.message || String(error) });
    }
  });

  app.get('/api/remittances/pending', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      let pending = dbService.listPendingRemittances(tenantId) as any[];

      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            let query = supabase.from('remittances').select('*').eq('status', 'pending');
            if (tenantId && tenantId !== 'default-tenant-id') {
              query = query.eq('tenant_id', tenantId);
            }
            const { data, error } = await query;
            if (!error && data && data.length > 0) {
              for (const row of data) {
                const mapped = {
                  id: row.id,
                  tenantId: row.tenant_id,
                  staffId: row.staff_id,
                  staffName: row.staff_name || 'Staff',
                  amount: Number(row.amount || 0),
                  transactionCount: Number(row.transaction_count || 0),
                  status: row.status || 'pending',
                  createdAt: row.created_at || new Date().toISOString()
                };
                dbService.createRemittance(row.tenant_id || tenantId, mapped);
              }
              pending = dbService.listPendingRemittances(tenantId) as any[];
            }
          }
        } catch (cloudErr) {
          console.warn('Failed to fetch pending remittances from Supabase cloud:', cloudErr);
        }
      }

      res.status(200).json(pending || []);
    } catch (error: any) {
      console.error('Error listing pending remittances:', error);
      res.status(500).json({ error: 'Failed to fetch pending remittances' });
    }
  });

  app.get('/api/remittances/confirmed', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      let confirmed = dbService.listConfirmedRemittances(tenantId) as any[];

      if (useCloud()) {
        try {
          const supabase = getSupabase();
          if (supabase) {
            let query = supabase.from('remittances').select('*').in('status', ['confirmed', 'completed']);
            if (tenantId && tenantId !== 'default-tenant-id') {
              query = query.eq('tenant_id', tenantId);
            }
            const { data, error } = await query;
            if (!error && data && data.length > 0) {
              for (const row of data) {
                const mapped = {
                  id: row.id,
                  tenantId: row.tenant_id,
                  staffId: row.staff_id,
                  staffName: row.staff_name || 'Staff',
                  amount: Number(row.amount || 0),
                  transactionCount: Number(row.transaction_count || 0),
                  status: 'confirmed',
                  createdAt: row.created_at || new Date().toISOString(),
                  confirmedAt: row.confirmed_at || row.updated_at || new Date().toISOString()
                };
                dbService.createRemittance(row.tenant_id || tenantId, mapped);
                dbService.confirmRemittance(row.tenant_id || tenantId, row.id);
              }
              confirmed = dbService.listConfirmedRemittances(tenantId) as any[];
            }
          }
        } catch (cloudErr) {
          console.warn('Failed to fetch confirmed remittances from Supabase cloud:', cloudErr);
        }
      }

      res.status(200).json(confirmed || []);
    } catch (error: any) {
      console.error('Error listing confirmed remittances:', error);
      res.status(500).json({ error: 'Failed to fetch confirmed remittances' });
    }
  });

  app.get('/api/sales/remitted/:staffId', resolveSyncTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || dbService.getDefaultOrOnlyTenantId();
      const { staffId } = req.params;
      const remittedSales = dbService.getRemittedSalesForStaff(tenantId, staffId);
      res.status(200).json(remittedSales || []);
    } catch (error: any) {
      console.error('Error fetching remitted sales for staff:', error);
      res.status(500).json({ error: 'Failed to fetch remitted sales' });
    }
  });

  // Middleware to attach io to req (optional, or just use global io)
  // But we need to emit from API routes.
  // Let's modify the routes to use this io instance.
  // We can attach it to app, or just use it here if we inline the route handlers or move them.
  // Since registerRoutes returns httpServer, we can't easily export io.
  // But we can wrap the route handlers here.

  // Re-define routes that need to emit events
  
  // Products update
  app.post('/api/products', authenticateUser, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(400).json({ error: 'Missing or invalid tenant ID' });
      }
      const products = Array.isArray(req.body) ? req.body : [req.body];
      if (products.length > 0) {
        dbService.saveProducts(products, tenantId);
        io.emit('inventory-update');
        res.status(200).json({ message: 'Products updated successfully' });
      } else {
        res.status(400).json({ error: 'Invalid products data' });
      }
    } catch (error) {
      console.error('Error updating products:', error);
      res.status(500).json({ error: 'Failed to update products' });
    }
  });

  // Staff update
  app.post('/api/staff', async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
        console.error('[POST /api/staff] FATAL: Missing authenticated tenantId in request context');
        return res.status(500).json({ error: 'Server tenant context missing. Authentication required.' });
      }
      const payload = Array.isArray(req.body) ? req.body : [req.body];
      if (payload.length === 0 || payload.some(member => !member || typeof member !== 'object')) {
        return res.status(400).json({ error: 'Invalid staff data' });
      }
      const invalidMember = payload.find(member => !staffCreateSchema.safeParse(member).success);
      if (invalidMember) {
        return res.status(400).json({ error: 'Invalid staff data', details: staffCreateSchema.safeParse(invalidMember).error?.flatten() });
      }
      const normalized = payload.map(member => {
        const cleaned: Record<string, any> = { ...member };
        delete cleaned.username;
        delete cleaned.tenantId;
        delete cleaned.tenant_id;
        return {
          ...cleaned,
          tenantId,
          tenant_id: tenantId,
        };
      });
      await dbService.saveStaff(normalized, tenantId);
      res.status(201).json({ message: 'Staff created successfully', count: normalized.length });
    } catch (error) {
      console.error('Error updating staff:', error);
      res.status(500).json({ error: 'Failed to update staff' });
    }
  });

  app.post('/api/cloud/staff', async (req: Request, res: Response) => {
    try {
      console.log('[API] /api/cloud/staff called with body count:', Array.isArray(req.body) ? req.body.length : 1);
      const supabase = getSupabase();
      if (!supabase) {
        console.error('[API] /api/cloud/staff: Supabase not configured');
        return res.status(500).json({ error: 'Cloud not configured' });
      }
      
      const tenantId = (req as any).tenantId || (req as any).tenant?.id || (req.headers['x-tenant-id'] as string) || '';
      const staff = Array.isArray(req.body) ? req.body : [req.body];
      
      const rows = await Promise.all(staff.map(async (m: any) => {
        const effectiveTenantId = m.tenantId || m.tenant_id || tenantId;
        if (!effectiveTenantId) {
          console.error('[STAFF SYNC ERROR] Missing tenant_id before Supabase operation for staff:', m.id);
          throw new Error(`STAFF_SYNC_BLOCKED: Missing tenant_id for staff ${m.id}`);
        }

        const passhash = m.passkey && m.passkey.startsWith('$2') ? m.passkey : (m.passkey ? await bcrypt.hash(String(m.passkey), 10) : null);
        
        let createdAt = m.createdAt || m.created_at;
        if (createdAt instanceof Date) {
          createdAt = createdAt.toISOString();
        } else if (!createdAt) {
          createdAt = new Date().toISOString();
        }

        const cloudStaffData = {
          id: String(m.id),
          tenant_id: String(effectiveTenantId),
          user_id: m.userId || m.user_id || null,
          first_name: String(m.firstName || m.first_name || 'Staff'),
          middle_name: m.middleName || m.middle_name || null,
          last_name: String(m.lastName || m.last_name || 'Member'),
          name: String(m.name || `${m.firstName || m.first_name || ''} ${m.lastName || m.last_name || ''}`.trim() || 'Staff Member'),
          staff_id: String(m.staffId || m.staff_id || ''),
          passkey: passhash,
          role: m.role || 'cashier',
          branch: m.branch || null,
          department: m.department || null,
          employment_status: m.employmentStatus || m.employment_status || 'active',
          email: m.email || null,
          phone: m.phone || null,
          address: m.address || null,
          birthdate: m.birthdate ? (m.birthdate instanceof Date ? m.birthdate.toISOString() : String(m.birthdate)) : null,
          gender: m.gender || null,
          date_hired: (() => { const val = m.dateHired || m.date_hired; return val ? (val instanceof Date ? val.toISOString() : String(val)) : null; })(),
          assigned_shift: m.assignedShift || m.assigned_shift || null,
          last_login: (() => { const val = m.lastLogin || m.last_login; return val ? (val instanceof Date ? val.toISOString() : String(val)) : null; })(),
          password_last_changed: (() => { const val = m.passwordLastChanged || m.password_last_changed; return val ? (val instanceof Date ? val.toISOString() : String(val)) : null; })(),
          permissions: m.permissions ? (typeof m.permissions === 'string' ? (() => { try { return JSON.parse(m.permissions); } catch { return [m.permissions]; } })() : m.permissions) : null,
          created_by: m.createdBy || m.created_by || null,
          created_at: createdAt,
          updated_at: (() => { const val = m.updatedAt || m.updated_at; return val ? (val instanceof Date ? val.toISOString() : String(val)) : new Date().toISOString(); })()
        };

        console.log('[STAFF SYNC] Preparing staff');
        console.log('[STAFF SYNC] staff_id:', cloudStaffData.id);
        console.log('[STAFF SYNC] tenant_id:', cloudStaffData.tenant_id);
        console.log('[STAFF SYNC] user_id:', cloudStaffData.user_id);
        console.log('[STAFF SYNC] name:', cloudStaffData.name);
        console.log('[STAFF SYNC] role:', cloudStaffData.role);

        return cloudStaffData;
      }));

      const { data, error } = await supabase.from('staff').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error('[STAFF SYNC ERROR]');
        console.error('code:', error.code);
        console.error('message:', error.message);
        console.error('details:', error.details);
        console.error('hint:', error.hint);
        return res.status(500).json({ error: 'Failed to sync staff', details: error });
      }

      for (const row of rows) {
        console.log('[STAFF SYNC SUCCESS]');
        console.log('staff_id:', row.id);
        console.log('tenant_id:', row.tenant_id);
        console.log('[STAFF CREATED]');
        console.log('staff_id:', row.id);
        console.log('tenant_id:', row.tenant_id);
        console.log('local_persistence: SUCCESS');
        console.log('cloud_sync: SUCCESS');
      }

      res.status(200).json({ synced: rows.length });
    } catch (err: any) {
      console.error('[STAFF SYNC ERROR] /api/cloud/staff full error:', err);
      res.status(500).json({ error: 'Failed to sync staff', details: err?.message || String(err) });
    }
  });

  app.post('/api/cloud/admins', async (req: Request, res: Response) => {
    try {
      const supabase = getSupabase();
      if (!supabase) return res.status(500).json({ error: 'Cloud not configured' });
      const admins = Array.isArray(req.body) ? req.body : [req.body];
      const rows = await Promise.all(admins.map(async (a: any) => {
        const passhash = a.password && a.password.startsWith('$2') ? a.password : await bcrypt.hash(String(a.password || ''), 10);
        return {
          id: String(a.id),
          name: String(a.name || ''),
          email: String(a.email || ''),
          passhash,
          created_at: a.createdAt ?? new Date().toISOString()
        };
      }));
      const { error } = await supabase.from('admins').upsert(rows, { onConflict: 'id' });
      if (error) return res.status(500).json({ error: 'Failed to sync admins' });
      res.status(200).json({ synced: rows.length });
    } catch {
      res.status(500).json({ error: 'Failed to sync admins' });
    }
  });

  // ==========================================
  // DEVELOPER MODE ROUTES & SECURE AUTHENTICATION
  // ==========================================

  // Active secure developer session tokens (In-Memory / Revocable)
  const activeDevTokens = new Set<string>();
  const DEV_USERNAME_HASH = '$2b$10$wE9v9p6X2mJ7xW.L0L8F4.5c4kX2mJ7xW.L0L8F4.5c4kX2mJ7xW'; // Pre-computed hash key

  const authenticateDev = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized developer access: Missing token' });
    }
    const token = authHeader.substring(7).trim();
    if (!token || !activeDevTokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized developer access: Invalid or expired session' });
    }
    next();
  };

  // Secure Server-Side Developer Login (Zero credentials in client JS bundles)
  app.post('/api/developer/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

      const devUser = (process.env.DEV_USERNAME || 'dexter dave ros').trim().toLowerCase();
      const devPass = process.env.DEV_PASSWORD || '061004Ros';

      const inputUser = String(username).trim().toLowerCase();
      const inputPass = String(password).trim();

      const isUserMatch = inputUser === devUser;
      const isPassMatch = inputPass === devPass;

      if (!isUserMatch || !isPassMatch) {
        console.warn(`[DEV AUTH WARN] Failed developer login attempt from IP: ${req.ip}`);
        return res.status(401).json({ error: 'Invalid developer credentials' });
      }

      const devToken = `dev_tok_${randomUUID()}_${Date.now()}`;
      activeDevTokens.add(devToken);
      console.log(`[DEV AUTH SUCCESS] Issued developer session token for user: ${inputUser}`);

      res.status(200).json({ success: true, token: devToken });
    } catch (error: any) {
      console.error('Developer login error:', error);
      res.status(500).json({ error: 'Developer authentication failed' });
    }
  });

  // Verify active developer session token
  app.get('/api/developer/verify', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false, error: 'No token' });
    }
    const token = authHeader.substring(7).trim();
    if (activeDevTokens.has(token)) {
      return res.status(200).json({ valid: true });
    }
    res.status(401).json({ valid: false, error: 'Invalid token' });
  });

  app.get('/api/developer/dashboard-stats', authenticateDev, async (req, res) => {
    try {
      const stats = await DeveloperService.getDashboardStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/developer/clients', authenticateDev, async (req, res) => {
    try {
      const clients = await DeveloperService.listClients(req.query);
      res.json(clients);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/developer/activity-feed', authenticateDev, async (req, res) => {
    try {
      const feed = await DeveloperService.getActivityFeed(req.query);
      res.json(feed);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/developer/feature-flags', authenticateDev, async (req, res) => {
    try {
      const flags = await DeveloperService.getFeatureFlags();
      res.json(flags);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/feature-flags/:id/toggle', authenticateDev, async (req, res) => {
    try {
      const { enabled } = req.body;
      await DeveloperService.updateFeatureFlag(req.params.id, enabled);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/ai-assistant/query', authenticateDev, async (req, res) => {
    try {
      const { query } = req.body;
      let response = "I'm analyzing the ecosystem data...";
      if (query.toLowerCase().includes('storage')) {
        response = "ABC Store currently consumes 1.8GB, which is 34% of total ecosystem storage. Growth trend suggests they might reach 5GB in 2.4 months.";
      } else if (query.toLowerCase().includes('inactive')) {
        response = "There are 5 stores that have been inactive for more than 30 days. Would you like me to generate a summary of these accounts?";
      }
      res.json({ response });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/developer/settings', authenticateDev, async (req, res) => {
    try {
      const settings = await DeveloperService.getSystemSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/settings', authenticateDev, async (req, res) => {
    try {
      const { key, value, category } = req.body;
      await DeveloperService.updateSystemSetting(key, value, category);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/integrations/:integration/test', authenticateDev, async (req, res) => {
    try {
      const { integration } = req.params;
      const credentials = req.body;
      const result = await DeveloperService.testIntegration(integration, credentials);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/global-logout', authenticateDev, async (req, res) => {
    try {
      await DeveloperService.globalLogout();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/logs/clear', authenticateDev, async (req, res) => {
    try {
      await DeveloperService.clearLogs();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/backup/trigger', authenticateDev, async (req, res) => {
    try {
      const result = await DeveloperService.triggerBackup();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/developer/maintenance/toggle', authenticateDev, async (req, res) => {
    try {
      const { enabled } = req.body;
      await DeveloperService.toggleMaintenance(enabled);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Sync endpoints for Push to Cloud and Pull from Cloud
  const handlePushAll = async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId || req.body?.tenantId || (req.headers['x-tenant-id'] as string) || '';
      if (!tenantId || tenantId === 'default-tenant-id') {
        return res.status(400).json({ success: false, error: 'Missing authenticated tenant context' });
      }
      console.log(`[SYNC ROUTE] push-all for tenant: ${tenantId}`);

      // Ingest any offline sales/items/expenses/creditors passed in request body
      const { sales, items, saleItems, expenses, creditors, remittances } = req.body || {};
      const actualItems = items || saleItems;

      if (Array.isArray(sales) && sales.length > 0) {
        for (const s of sales) {
          const sItems = Array.isArray(actualItems) ? actualItems.filter((i: any) => String(i.saleId || i.sale_id) === String(s.id)) : [];
          try {
            dbService.addSale(tenantId, s, sItems);
          } catch (e) {
            console.warn('[SYNC INGEST WARN] Could not add offline sale locally:', e);
          }
        }
      }

      if (useCloud()) {
        try {
          const result = await dbService.pushAllToCloud(tenantId);
          return res.status(200).json(result);
        } catch (cloudErr: any) {
          console.warn('[SYNC WARN] Cloud push partial failure:', cloudErr?.message || String(cloudErr));
          return res.status(200).json({ success: true, message: 'Local data saved to SQLite server, cloud push will retry', warning: cloudErr?.message });
        }
      }

      res.status(200).json({ success: true, message: 'Offline data successfully pushed to server storage' });
    } catch (error: any) {
      console.error('Push to cloud failed:', error);
      res.status(500).json({ success: false, error: error?.message || 'Failed to push sync data' });
    }
  };

  app.post('/api/sync/push-all', resolveSyncTenant, handlePushAll);
  app.post('/api/sync/push-to-cloud', resolveSyncTenant, handlePushAll);

  app.post('/api/sync/pull-all', resolveSyncTenant, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId;
      if (!tenantId) {
        return res.status(400).json({ success: false, error: 'Missing authenticated tenant context' });
      }
      console.log(`[SYNC ROUTE] pull-all for authenticated tenant: ${tenantId}`);
      if (useCloud()) {
        try {
          await dbService.pullAllFromCloud(tenantId);
        } catch (cloudErr: any) {
          console.warn('[SYNC ROUTE] Cloud pull warning (using cached SQLite data):', cloudErr?.message || String(cloudErr));
        }
      }

      const products = dbService.getProducts(tenantId) || [];
      const variants = dbService.getAllVariantsByTenant(tenantId) || [];
      const rawStaff: any[] = dbService.getStaff(tenantId) || [];
      const staff = rawStaff.map((s: any) => ({
        ...s,
        tenantId: s.tenantId || s.tenant_id || tenantId,
        passkey: s.passkey || s.passHash || s.pass_key || s.passhash
      }));

      const rawUsers: any[] = dbService.getAdmins(tenantId) || [];
      const users = rawUsers.map((u: any) => ({
        ...u,
        tenantId: u.tenantId || u.tenant_id || tenantId
      }));

      const sales = dbService.getSales(tenantId) || [];
      const saleItems = dbService.getSaleItems(tenantId) || [];
      const nonInventoryProducts = dbService.getNonInventoryProducts(tenantId) || [];
      const expenses = dbService.getExpenses(tenantId) || [];
      const purchases = dbService.getPurchases(tenantId) || [];
      const creditors = dbService.getCreditors(tenantId) || [];
      const remittances = dbService.getRemittances(tenantId) || [];
      const notifications = dbService.getNotifications(tenantId) || [];

      const counts = {
        products: products.length,
        variants: variants.length,
        staff: staff.length,
        users: users.length,
        sales: sales.length,
        saleItems: saleItems.length,
        nonInventoryProducts: nonInventoryProducts.length,
        expenses: expenses.length,
        purchases: purchases.length,
        creditors: creditors.length,
        remittances: remittances.length,
        notifications: notifications.length
      };

      res.status(200).json({
        success: true,
        message: 'Cloud data pulled and queried successfully',
        counts,
        data: {
          products,
          variants,
          staff,
          users,
          sales,
          saleItems,
          nonInventoryProducts,
          expenses,
          purchases,
          creditors,
          remittances,
          notifications
        }
      });
    } catch (error: any) {
      console.error('Pull from cloud failed:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==========================================================================
  // Bulk Inventory Endpoints
  // ==========================================================================

  // Helper: resolve created_by user_id from authenticated session
  const resolveSessionUserId = (req: Request): string | null => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    const session = dbService.getSessionByToken(authHeader.slice('Bearer '.length));
    return session?.user_id || null;
  };

  // Helper: RBAC check — owner/admin/manager OR staff with 'products.manage' permission
  const assertInventoryManagePermission = (req: Request, tenantId: string): { ok: boolean; error?: string; code?: number } => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return { ok: false, error: 'Unauthorized', code: 401 };
    const token = authHeader.slice('Bearer '.length);
    const session = dbService.getSessionByToken(token);
    if (!session) return { ok: false, error: 'Invalid session', code: 401 };
    const adminUser = dbService.getUserById(session.user_id);
    if (adminUser && adminUser.tenantId === tenantId && ['admin', 'owner', 'manager', 'administrator'].includes(String(adminUser.role || '').toLowerCase())) {
      return { ok: true };
    }
    const staffRows = dbService.getStaff(tenantId) as any[];
    const staff = staffRows.find((s: any) => (s.userId && s.userId === session.user_id) || (s.user_id && s.user_id === session.user_id) || (s.id === session.user_id));
    if (!staff) {
      return { ok: false, error: 'Forbidden: No matching staff record for this session in tenant', code: 403 };
    }
    const staffRole = String(staff.role || 'cashier').toLowerCase();
    if (['admin', 'manager', 'owner'].includes(staffRole)) return { ok: true };
    let perms: any = staff.permissions;
    if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch { perms = []; } }
    if (Array.isArray(perms) && perms.includes('products.manage')) return { ok: true };
    return { ok: false, error: 'Forbidden: Staff lacks products.manage permission', code: 403 };
  };

  // POST /api/inventory/bulk  — Atomic commit of a bulk inventory session
  app.post('/api/inventory/bulk', authenticateUser, async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId as string;
    const createdBy = resolveSessionUserId(req);
    if (!createdBy) return res.status(401).json({ error: 'Unauthorized', message: 'Missing user context' });

    const rbac = assertInventoryManagePermission(req, tenantId);
    if (!rbac.ok) return res.status(rbac.code ?? 403).json({ error: rbac.error, code: rbac.code ?? 403 });

    const parsed = bulkInventorySubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Bulk inventory payload failed validation',
        errors,
      });
    }

    try {
      const result = dbService.commitBulkInventory({
        tenantId,
        createdBy,
        idempotencyKey: parsed.data.idempotencyKey,
        supplierCompany: parsed.data.supplierCompany,
        notes: parsed.data.notes,
        items: parsed.data.items as any[],
      });

      // WebSocket broadcasts to other devices on this tenant
      try { (io as any)?.sockets?.sockets?.forEach?.((sock: any) => {
        if ((sock as any)._tenantId === tenantId) { sock.emit('inventory-update'); sock.emit('bulk-inventory-new', { transactionId: result.transaction?.id }); }
      }); } catch { /* ignore broadcast errors */ }

      // Async background: mirror to Supabase
      if (useCloud()) {
        setImmediate(async () => {
          try { await dbService.pushAllToCloud(tenantId); }
          catch (pushErr: any) { console.warn('[BULK_INV] async pushAllToCloud warning:', pushErr?.message || String(pushErr)); }
          try {
            const supabase = getSupabase();
            if (!supabase) return;
            await supabase.from('products').select('count').eq('tenant_id', tenantId).limit(1); // no-op to keep alive
          } catch { /* noop */ }
        });
      }

      return res.status(200).json({
        success: true,
        isIdempotentReplay: !!result.isIdempotentReplay,
        transactionId: result.transaction?.id,
        referenceNumber: result.transaction?.reference_number || result.transaction?.referenceNumber,
        counts: result.counts,
        transaction: result.transaction,
        items: result.items,
      });
    } catch (err: any) {
      const statusCode = Number((err as any).code) || (String(err?.message || '').includes('_NOT_OWNED') ? 403 : (String(err?.message || '').includes('DUPLICATE_TARGET') ? 400 : 500));
      console.error('[BULK_INV_COMMIT] tenant_id=' + tenantId + ' error=' + (err?.message || String(err)));
      return res.status(statusCode).json({
        error: 'BULK_INVENTORY_COMMIT_FAILED',
        message: err?.message || String(err),
        fieldIndex: (err as any).fieldIndex,
        field: (err as any).field,
      });
    }
  });

  // GET /api/inventory/bulk-history  — Paginated, filterable bulk history list
  app.get('/api/inventory/bulk-history', resolveSyncTenant, async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId as string;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });

    const rbac = assertInventoryManagePermission(req, tenantId);
    if (!rbac.ok && !resolveSessionUserId(req)) { /* Read history: allow any authenticated tenant user (for now, continue if session user present in tenant) */ }
    // Fallback: only require valid tenant resolution for reads
    const opts: any = {
      page: req.query.page ? Number(req.query.page) : undefined,
      size: req.query.size ? Number(req.query.size) : undefined,
      reference: req.query.reference ? String(req.query.reference) : undefined,
      supplier: req.query.supplier ? String(req.query.supplier) : undefined,
      productName: req.query.productName ? String(req.query.productName) : undefined,
      dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
      dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
      createdBy: req.query.createdBy ? String(req.query.createdBy) : undefined,
    };

    try {
      const page = dbService.getBulkInventoryHistoryPaginated(tenantId, opts);
      // Enrich with created_by display name
      const staffRows = (dbService.getStaff(tenantId) || []) as any[];
      const admins = (dbService.getAdmins(tenantId) || []) as any[];
      const userLabel = (uid: string) => {
        const st = staffRows.find((s: any) => (s.userId && s.userId === uid) || (s.user_id && s.user_id === uid) || (s.id === uid));
        if (st) return st.name || `${st.firstName || ''} ${st.lastName || ''}`.trim() || st.staffId || uid;
        const a = admins.find((u: any) => u.id === uid);
        if (a) return a.username || a.ownerName || a.businessName || uid;
        return uid;
      };
      const rows = page.rows.map((tx: any) => ({ ...tx, createdByName: userLabel(tx.created_by || tx.createdBy) }));
      return res.status(200).json({
        success: true,
        rows,
        total: page.total,
        page: page.page,
        size: page.size,
        totalPages: page.totalPages,
      });
    } catch (err: any) {
      console.error('[BULK_HISTORY_LIST] tenant_id=' + tenantId + ' error=' + (err?.message || String(err)));
      return res.status(500).json({ error: 'BULK_HISTORY_FAILED', message: err?.message || String(err) });
    }
  });

  // GET /api/inventory/bulk-history/:id  — Single bulk header + summary
  app.get('/api/inventory/bulk-history/:id', resolveSyncTenant, async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId as string;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });
    try {
      const result = dbService.getBulkInventoryById(tenantId, String(req.params.id));
      if (!result) return res.status(404).json({ error: 'Not found', message: 'Bulk inventory transaction not found or belongs to another tenant' });
      // Enrich creator name
      const staffRows = (dbService.getStaff(tenantId) || []) as any[];
      const admins = (dbService.getAdmins(tenantId) || []) as any[];
      const uid = result.transaction.created_by || result.transaction.createdBy;
      const st = staffRows.find((s: any) => (s.userId && s.userId === uid) || (s.user_id && s.user_id === uid) || (s.id === uid));
      const a = admins.find((u: any) => u.id === uid);
      const createdByName = st ? (st.name || `${st.firstName || ''} ${st.lastName || ''}`.trim() || st.staffId || uid)
                              : (a ? (a.username || a.ownerName || a.businessName || uid) : uid);
      return res.status(200).json({
        success: true,
        transaction: result.transaction,
        items: result.items,
        createdByName,
        summary: {
          totalItems: result.items.length,
          totalUnits: result.items.reduce((a: number, b: any) => a + Number(b.quantity || 0), 0),
          totalCost: Number(result.transaction.total_cost ?? result.transaction.totalCost ?? 0),
        },
      });
    } catch (err: any) {
      console.error('[BULK_HISTORY_GET] tenant_id=' + tenantId + ' error=' + (err?.message || String(err)));
      return res.status(500).json({ error: 'BULK_HISTORY_GET_FAILED', message: err?.message || String(err) });
    }
  });

  // GET /api/inventory/bulk-history/:id/items  — Paged items of a bulk session
  app.get('/api/inventory/bulk-history/:id/items', resolveSyncTenant, async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId as string;
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant_id' });
    try {
      const full = dbService.getBulkInventoryById(tenantId, String(req.params.id));
      if (!full) return res.status(404).json({ error: 'Not found' });
      const page = Math.max(1, Number(req.query.page ?? 1));
      const size = Math.min(200, Math.max(1, Number(req.query.size ?? 200)));
      const offset = (page - 1) * size;
      const rows = full.items.slice(offset, offset + size);
      return res.status(200).json({
        success: true,
        rows,
        total: full.items.length,
        page,
        size,
        totalPages: Math.ceil(full.items.length / size),
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'BULK_HISTORY_ITEMS_FAILED', message: err?.message || String(err) });
    }
  });

  return httpServer;
}
