import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Save, LogOut, User, Store, Settings, Wifi, Shield, Key, Bell, Smartphone, Scan, Camera, Moon, Sun, Info, Mail, Database, RefreshCw, ChevronRight, Printer, Cpu, Wallet, HelpCircle, HardDrive, DollarSign, ShoppingCart, Play, Pause, Lock, Unlock, AlertCircle, Building2, User as UserIcon, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { useLocation } from 'wouter';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { useDevices } from '@/contexts/DeviceContext';
import { useToast } from '@/hooks/use-toast';
import { AuthService, SalesService, StaffService, db } from '@/lib/db';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import ExternalDeviceManager from '@/components/ExternalDeviceManager';
import { LocalizedContent } from '@/contexts/LanguageContext';

const profileSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  ownerName: z.string().min(1, 'Owner name is required'),
  mobile: z.string().min(10, 'Valid mobile number is required'),
});

const credentialsSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
});

const securityQuestionsSchema = z.object({
  question1: z.string().min(1, 'Question 1 is required'),
  answer1: z.string().min(1, 'Answer 1 is required'),
  question2: z.string().min(1, 'Question 2 is required'),
  answer2: z.string().min(1, 'Answer 2 is required'),
  question3: z.string().min(1, 'Question 3 is required'),
  answer3: z.string().min(1, 'Answer 3 is required'),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type CredentialsFormData = z.infer<typeof credentialsSchema>;
type SecurityQuestionsFormData = z.infer<typeof securityQuestionsSchema>;

type DeviceStatus = {
  bound: boolean;
  identityVerified?: boolean;
  localAccountPresent?: boolean;
  tenant?: {
    id?: string;
    storeName?: string;
    subdomain?: string;
    createdAt?: string;
  } | null;
  admin?: {
    id?: string;
    username?: string;
    ownerName?: string;
    businessName?: string;
    mobile?: string;
    email?: string;
    role?: string;
  } | null;
  message?: string;
};

type ReceiptSettings = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  headerNote: string;
  footerNote: string;
  autoPrintOnSale: boolean;
  printerDeviceName: string;
  paperWidth: '58mm' | '80mm';
  showDateTime: boolean;
  showStaffName: boolean;
};

type ExternalScannerSettings = {
  enabled: boolean;
  timeout: number;
};

type SettingsResponse = {
  receipt?: Partial<ReceiptSettings>;
  externalScanner?: Partial<ExternalScannerSettings>;
  [key: string]: any;
};

const defaultReceiptSettings: ReceiptSettings = {
  storeName: 'SmartPOS+ Store',
  storeAddress: '',
  storePhone: '',
  headerNote: 'Thank you for your purchase!',
  footerNote: 'No refunds without receipt.',
  autoPrintOnSale: false,
  printerDeviceName: '',
  paperWidth: '58mm',
  showDateTime: true,
  showStaffName: true,
};

const defaultExternalScannerSettings: ExternalScannerSettings = {
  enabled: true,
  timeout: 150,
};

const HardwareSettingsDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  return (
    <LocalizedContent>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[#FF8882]" />
            Hardware Configuration
          </DialogTitle>
          <DialogDescription>
            Set up your thermal printer, scanner, and external devices.
          </DialogDescription>
        </DialogHeader>
        <ExternalDeviceManager />
      </DialogContent>
    </Dialog>
    </LocalizedContent>
  );
};

const ProfileSettings: React.FC = () => {
  const [location, setLocation] = useLocation();
  const { user, logout, login } = useAuth();
  const { deviceMode } = useDevices();
  const { toast } = useToast();
  const { connectToRouter, disconnectFromRouter, isConnectedToRouter, syncWithRouter } = useApp();
  
  const [isLoading, setIsLoading] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [showRouterSettings, setShowRouterSettings] = useState(false);
  const [showHardwareSettings, setShowHardwareSettings] = useState(false);
  const [showStoreInfoDialog, setShowStoreInfoDialog] = useState(false);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showSecurityQuestions, setShowSecurityQuestions] = useState(false);
  const [showHelpSupportDialog, setShowHelpSupportDialog] = useState(false);
  const [helpQuery, setHelpQuery] = useState('');
  const [isTutorialPlaying, setIsTutorialPlaying] = useState(false);
  
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [selectedWiFiForPassword, setSelectedWiFiForPassword] = useState<string | null>(null);
  
  // App settings state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');
  
  const [profileImage, setProfileImage] = useState<string | null>(user?.profileImage || null);
  
  // WiFi scanning state
  const [availableWiFis, setAvailableWiFis] = useState<Array<{ssid: string, signal: number, security: string}>>([]);
  const [selectedWiFi, setSelectedWiFi] = useState<string>('');
  const [selectedWiFiSecurity, setSelectedWiFiSecurity] = useState<string>('');
  const [isScanningWiFi, setIsScanningWiFi] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const [totalIncome, setTotalIncome] = useState(0);
  const [activeStaff, setActiveStaff] = useState(0);
  const [totalCustomer, setTotalCustomer] = useState(0);
  const [backupCounts, setBackupCounts] = useState({users:0,products:0,sales:0,saleItems:0,staff:0,expenses:0,purchases:0,creditors:0});
  const [gcashConnected, setGcashConnected] = useState(false);
  const [mayaConnected, setMayaConnected] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<null | 'gcash' | 'maya'>(null);

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showDeviceBindingDialog, setShowDeviceBindingDialog] = useState(false);

  useEffect(() => {
    const checkWalletStatus = async () => {
      try {
        const [gcashData, mayaData] = await Promise.all([
          api.get('/api/wallet/gcash/status'),
          api.get('/api/wallet/maya/status')
        ]);
        setGcashConnected(!!gcashData.connected);
        setMayaConnected(!!mayaData.connected);
      } catch (e) {
        console.error('Failed to load wallet status', e);
      }
    };
    checkWalletStatus();
  }, []);

  const startWalletOAuth = async (provider: 'gcash' | 'maya') => {
    if (!navigator.onLine) {
      toast({ title: 'Internet Required', description: 'Please connect to the internet to link wallet', variant: 'destructive' });
      return;
    }
    setConnectingWallet(provider);
    const oauthUrl = `/api/wallet/${provider}/oauth/start`;
    const popup = window.open(oauthUrl, 'wallet-oauth', 'width=500,height=700');

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as any;
      if (data?.type === 'wallet_connected' && data.provider === provider) {
        try { await fetch(`/api/wallet/${provider}/connect`, { method: 'POST' }); } catch {}
        if (provider === 'gcash') setGcashConnected(true); else setMayaConnected(true);
        toast({ title: `${provider === 'gcash' ? 'GCash' : 'Maya'} Connected`, description: 'Wallet linked successfully' });
        setConnectingWallet(null);
        window.removeEventListener('message', onMessage);
        try { popup?.close(); } catch {}
      } else if (data?.type === 'wallet_error' && data.provider === provider) {
        toast({ title: 'Connection Failed', description: `Unable to link ${provider}`, variant: 'destructive' });
        setConnectingWallet(null);
        window.removeEventListener('message', onMessage);
        try { popup?.close(); } catch {}
      }
    };
    window.addEventListener('message', onMessage);

    let attempts = 0;
    const maxAttempts = 15;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/wallet/${provider}/status`);
        if (res.ok) {
          const status = await res.json();
          if (status.connected) {
            if (provider === 'gcash') setGcashConnected(true); else setMayaConnected(true);
            toast({ title: `${provider === 'gcash' ? 'GCash' : 'Maya'} Connected`, description: 'Wallet linked successfully' });
            clearInterval(poll);
            window.removeEventListener('message', onMessage);
            setConnectingWallet(null);
            try { popup?.close(); } catch {}
            return;
          }
        }
      } catch {}
      if (attempts >= maxAttempts || (popup && popup.closed)) {
        clearInterval(poll);
        window.removeEventListener('message', onMessage);
        setConnectingWallet(null);
      }
    }, 2000);
  };

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      businessName: user?.businessName || '',
      ownerName: user?.ownerName || '',
      mobile: user?.mobile || '',
    },
  });

  const credentialsForm = useForm<CredentialsFormData>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const securityQuestionsForm = useForm<SecurityQuestionsFormData>({
    resolver: zodResolver(securityQuestionsSchema),
    defaultValues: {
      question1: '',
      answer1: '',
      question2: '',
      answer2: '',
      question3: '',
      answer3: '',
    },
  });

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && user) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageData = e.target?.result as string;
        setProfileImage(imageData);
        try {
          await AuthService.updateProfileImage(user.id, imageData);
          toast({ title: 'Profile Picture Updated', description: 'Your profile picture has been saved successfully' });
        } catch (error) {
          toast({ title: 'Error', description: 'Failed to save profile picture', variant: 'destructive' });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleThemeToggle = () => {
    const newTheme = themeMode === 'light' ? 'dark' : 'light';
    setThemeMode(newTheme);
    if (newTheme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    toast({ title: 'Theme Changed', description: `Switched to ${newTheme} mode` });
  };

  const handleSendSupportEmail = () => {
    if (!helpQuery.trim()) {
      toast({ title: 'Query Required', description: 'Please describe your issue or question before sending.', variant: 'destructive' });
      return;
    }

    const supportEmail = 'support@smartpos.com';
    const subject = encodeURIComponent('SmartPOS Help Request');
    const body = encodeURIComponent(helpQuery.trim());
    window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
    toast({ title: 'Email Client Opened', description: 'Your help request has been prepared for sending.' });
    setHelpQuery('');
  };

  const onSubmitProfile = async (data: ProfileFormData) => {
    setIsLoading(true);
    try {
      if (user) {
        await AuthService.updateUser(user.id, data);
        login({ ...user, ...data });
        toast({ title: 'Profile Updated', description: 'Your profile has been updated successfully' });
        setShowStoreInfoDialog(false);
      }
    } catch (error) {
      console.error('Profile update error:', error);
      toast({ title: 'Error', description: 'Failed to update profile', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitCredentials = async (data: CredentialsFormData) => {
    if (data.newPassword !== data.confirmPassword) {
      toast({ title: 'Error', description: "New password and confirm password don't match", variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const response = await api.put('/api/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword
      });
      if (response && (response.success || response.ok)) {
        toast({ title: 'Password Updated', description: 'Your password has been updated in local DB and Supabase Cloud!' });
        credentialsForm.reset();
        setShowAccountDetails(false);
      } else {
        toast({ title: 'Error', description: (response as any)?.error || 'Failed to update password', variant: 'destructive' });
      }
    } catch (error: any) {
      console.error('Password update error:', error);
      toast({ title: 'Error', description: error?.response?.data?.error || error?.message || 'Failed to update password', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitSecurityQuestions = async (data: SecurityQuestionsFormData) => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      await api.post('/api/auth/set-security-questions', {
        userId: user.id,
        questions: [data.question1, data.question2, data.question3],
        answers: [data.answer1, data.answer2, data.answer3],
      });
      toast({ title: 'Security Questions Saved', description: 'Your account is now more secure.' });
      setShowSecurityQuestions(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save security questions', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    setLocation('/role-selection');
  };

  const scanWiFi = async () => {
    setIsScanningWiFi(true);
    try {
      const routerUrl = localStorage.getItem('routerUrl') || 'http://localhost:5000';
      const response = await fetch(`${routerUrl}/api/wifi/scan`);
      if (!response.ok) throw new Error('Failed to scan for WiFi networks');
      const networks = await response.json();
      setAvailableWiFis(networks);
      toast({ title: 'Scan Complete', description: `Found ${networks.length} available networks` });
    } catch (error) {
      toast({ title: 'Scan Failed', description: 'Could not scan for WiFi networks', variant: 'destructive' });
    } finally {
      setIsScanningWiFi(false);
    }
  };

  const handleWiFiSelection = (ssid: string) => {
    const wifi = availableWiFis.find(w => w.ssid === ssid);
    setSelectedWiFi(ssid);
    setSelectedWiFiSecurity(wifi?.security || '');
    if (wifi && wifi.security !== 'Open') {
      setSelectedWiFiForPassword(ssid);
      setShowPasswordDialog(true);
    } else {
      setSelectedWiFiForPassword(null);
      setPasswordInput('');
    }
  };

  const connectToWiFi = async () => {
    if (!selectedWiFi) return;
    const wifi = availableWiFis.find(w => w.ssid === selectedWiFi);
    if (wifi && wifi.security !== 'Open' && !passwordInput) {
      toast({ title: 'Password Required', description: 'Please enter the WiFi password', variant: 'destructive' });
      return;
    }
    setIsConnecting(true);
    try {
      const routerUrl = localStorage.getItem('routerUrl') || 'http://localhost:5000';
      const connectResponse = await fetch(`${routerUrl}/api/wifi/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: selectedWiFi, password: passwordInput }),
      });
      if (!connectResponse.ok) throw new Error('Failed to connect to WiFi');
      const connected = await connectToRouter(routerUrl);
      if (connected) {
        toast({ title: 'WiFi Connected', description: `Successfully connected to ${selectedWiFi}` });
        setShowPasswordDialog(false);
        setPasswordInput('');
        setShowRouterSettings(false);
      } else {
        toast({ title: 'Connection Failed', description: 'Could not connect to the router.', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Connection Error', description: 'An error occurred while connecting to WiFi', variant: 'destructive' });
    } finally {
      setIsConnecting(false);
    }
  };

  const checkDeviceStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      setStatusError(null);
      setDeviceStatus(null);
      const res = await fetch('/api/tenants/device-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Device status request failed (${res.status})`);
      const data = await res.json();
      if (typeof data?.bound !== 'boolean' || typeof data?.identityVerified !== 'boolean') {
        throw new Error('Device status response was incomplete or from an unsupported server version');
      }
      const identityVerified = data.identityVerified === true;
      setDeviceStatus({
        ...data,
        identityVerified,
        localAccountPresent: data.localAccountPresent === true,
        tenant: identityVerified ? data.tenant : null,
        admin: identityVerified ? data.admin : null,
      } as DeviceStatus);
    } catch (e) {
      console.warn('[device-status] failed', e);
      setStatusError(e instanceof Error ? e.message : 'Device status could not be loaded.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const income = await SalesService.getTotalSales();
        const staffList = await StaffService.getAllStaff();
        const sales = await db.sales.toArray();
        setTotalIncome(Math.round(income * 100) / 100);
        setActiveStaff(staffList.length);
        setTotalCustomer(sales.length);
      } catch {}
    };
    loadStats();
    checkDeviceStatus();
    if (location === '/account-details') setShowAccountDetails(true);
  }, [checkDeviceStatus, location]);

  const SettingsCard: React.FC<{ icon: any, title: string, subtitle: string, onClick: () => void, color?: string }> = ({ icon: Icon, title, subtitle, onClick, color = "gray" }) => (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 text-left flex items-center gap-3 transition-all hover:shadow-md group",
        (deviceMode === 'pc' || deviceMode === 'tablet') ? "p-4 rounded-2xl" : "p-3.5 rounded-xl"
      )}
    >
      <div className={cn(
        "rounded-xl flex items-center justify-center transition-colors",
        `bg-${color}-50 text-${color}-500 group-hover:bg-${color}-500 group-hover:text-white`,
        (deviceMode === 'pc' || deviceMode === 'tablet') ? "p-3" : "p-2.5"
      )}>
        <Icon className={cn(
          (deviceMode === 'pc' || deviceMode === 'tablet') ? "w-5 h-5" : "w-4.5 h-4.5"
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className={cn(
          "font-bold text-gray-900 dark:text-white tracking-tight",
          (deviceMode === 'pc' || deviceMode === 'tablet') ? "text-sm" : "text-xs"
        )}>{title}</h4>
        <p className={cn(
          "font-bold text-gray-400 uppercase tracking-widest truncate",
          (deviceMode === 'pc' || deviceMode === 'tablet') ? "text-[10px]" : "text-[8px]"
        )}>{subtitle}</p>
      </div>
      <ChevronRight className={cn(
        "text-gray-300 group-hover:text-gray-500 transition-colors",
        (deviceMode === 'pc' || deviceMode === 'tablet') ? "w-4 h-4" : "w-3.5 h-3.5"
      )} />
    </motion.button>
  );

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col"
      >
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto flex items-center justify-between p-4 px-6">
            <button
              onClick={() => setLocation('/admin-main')}
              className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
            <h1 className="text-sm font-black uppercase tracking-[0.2em] text-gray-900 dark:text-white">Profile & Settings</h1>
            <div className="w-9" />
          </div>
        </div>
        
        <div className={cn(
          "flex-1 max-w-7xl mx-auto w-full space-y-6",
          (deviceMode === 'pc' || deviceMode === 'tablet') ? "p-4 md:p-8" : "p-4"
        )}>
          {/* Profile Section */}
          <div className={cn(
            "grid gap-4",
            (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-12" : "grid-cols-1"
          )}>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={cn(
                "bg-gradient-to-br from-[#BF953F] to-[#B38728] shadow-xl text-white relative overflow-hidden flex flex-col items-center justify-center",
                (deviceMode === 'pc' || deviceMode === 'tablet') ? "col-span-4 p-8 rounded-[2.5rem]" : "p-6 rounded-2xl"
              )}
            >
              <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24 blur-3xl" />

              <div className={cn("relative group mb-4", (deviceMode === 'pc' || deviceMode === 'tablet') ? "" : "mb-3")}>
                <div 
                  className={cn(
                    "bg-white/20 backdrop-blur-md rounded-full border-4 border-white/30 flex items-center justify-center overflow-hidden cursor-pointer hover:scale-105 transition-transform",
                    (deviceMode === 'pc' || deviceMode === 'tablet') ? "w-24 h-24" : "w-20 h-20"
                  )}
                  onClick={() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.click()}
                >
                  {profileImage ? <img src={profileImage} className="w-full h-full object-cover" /> : <User className={cn("text-white", (deviceMode === 'pc' || deviceMode === 'tablet') ? "w-12 h-12" : "w-10 h-10")} />}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className={cn("text-white", (deviceMode === 'pc' || deviceMode === 'tablet') ? "w-6 h-6" : "w-5 h-5")} />
                  </div>
                </div>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </div>
              
              <div className="text-center z-10">
                <h3 className={cn("font-black tracking-tighter mb-1", (deviceMode === 'pc' || deviceMode === 'tablet') ? "text-2xl" : "text-xl")}>{user?.ownerName || user?.username || 'Commander'}</h3>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 border border-white/30 text-[9px] font-black uppercase tracking-widest">
                  <Shield className="w-2.5 h-2.5" /> {user?.role || 'Admin'}
                </div>
              </div>
            </motion.div>

            {/* Stats Cards */}
            <div className={cn(
              "grid gap-3",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "col-span-8 grid-cols-3" : "grid-cols-3"
            )}>
              {[
                { label: 'Total Revenue', value: `₱${totalIncome.toLocaleString()}`, icon: DollarSign, color: 'emerald' },
                { label: 'Active Members', value: activeStaff, icon: User, color: 'blue' },
                { label: 'Total Customers', value: totalCustomer, icon: ShoppingCart, color: 'amber' }
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 * (i + 1) }}
                  className={cn(
                    "bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center text-center",
                    (deviceMode === 'pc' || deviceMode === 'tablet') ? "p-6 rounded-[2rem]" : "p-4 rounded-2xl"
                  )}
                >
                  <div className={cn("rounded-2xl flex items-center justify-center mb-3", `bg-${stat.color}-50 text-${stat.color}-500`, (deviceMode === 'pc' || deviceMode === 'tablet') ? "w-12 h-12" : "w-10 h-10")}>
                    <stat.icon className={cn((deviceMode === 'pc' || deviceMode === 'tablet') ? "w-6 h-6" : "w-5 h-5")} />
                  </div>
                  <div className={cn("font-black text-gray-900 dark:text-white tracking-tighter", (deviceMode === 'pc' || deviceMode === 'tablet') ? "text-2xl" : "text-lg")}>{stat.value}</div>
                  <div className={cn("font-bold text-gray-400 uppercase tracking-widest mt-1", (deviceMode === 'pc' || deviceMode === 'tablet') ? "text-[10px]" : "text-[8px]")}>{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Settings Grid */}
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <h2 className="text-xs font-black uppercase tracking-[0.3em] text-gray-400">Main Configuration</h2>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>

            <div className={cn(
              "grid gap-4",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-3" : "grid-cols-1 md:grid-cols-2"
            )}>
              <SettingsCard icon={Store} title="Store Information" subtitle="Business Details" color="pink" onClick={() => setShowStoreInfoDialog(true)} />
              <SettingsCard icon={Shield} title="Security Center" subtitle="Access Control" color="purple" onClick={() => setShowAccountDetails(true)} />
              <SettingsCard icon={Cpu} title="Hardware Setup" subtitle="Printer & Scanner" color="orange" onClick={() => setShowHardwareSettings(true)} />
              <SettingsCard icon={Database} title="Data Management" subtitle="Backup & Sync" color="emerald" onClick={async () => {
                const [users, products, sales, saleItems, staff, expenses, purchases, creditors] = await Promise.all([
                  db.users.count(), db.products.count(), db.sales.count(), db.saleItems.count(), db.staff.count(), db.expenses.count(), db.purchases.count(), db.creditors.count()
                ]);
                setBackupCounts({users, products, sales, saleItems, staff, expenses, purchases, creditors});
                setShowBackupDialog(true);
              }} />
              <SettingsCard
                icon={Lock}
                title="Device Binding Status"
                subtitle={
                  statusLoading ? "Checking…" :
                  statusError ? "Status unavailable" :
                  deviceStatus?.bound ? (deviceStatus.identityVerified ? "Bound account verified" : "Bound · identity unavailable") :
                  deviceStatus?.localAccountPresent ? "Binding unknown · local account data" :
                  "No Account Linked"
                }
                color={deviceStatus?.bound || deviceStatus?.localAccountPresent || statusError ? "amber" : "teal"}
                onClick={() => setShowDeviceBindingDialog(true)}
              />
              <SettingsCard icon={HelpCircle} title="Help & Support" subtitle="Guides & Tutorials" color="blue" onClick={() => setShowHelpSupportDialog(true)} />
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <h2 className="text-xs font-black uppercase tracking-[0.3em] text-gray-400">App Preferences</h2>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>

            <div className={cn(
              "grid gap-4",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-3" : "grid-cols-1 md:grid-cols-2"
            )}>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-amber-50 text-amber-500"><Bell className="w-5 h-5" /></div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white tracking-tight">System Alerts</h4>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Notification Sounds</p>
                  </div>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
              </div>

              <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-blue-50 text-blue-500"><Moon className="w-5 h-5" /></div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white tracking-tight">Interface Theme</h4>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{themeMode} mode</p>
                  </div>
                </div>
                <Switch checked={themeMode === 'dark'} onCheckedChange={handleThemeToggle} />
              </div>
            </div>
          </div>



          <div className="pt-8 flex justify-center">
            <Button
              onClick={() => setShowLogoutDialog(true)}
              variant="destructive"
              className="w-full max-w-md py-7 rounded-3xl font-black uppercase tracking-[0.2em] shadow-lg shadow-red-200 hover:shadow-xl transition-all"
            >
              <LogOut className="w-5 h-5 mr-3" /> Terminate Session
            </Button>
          </div>
        </div>

        {/* Dedicated Hardware Settings Dialog */}
        <HardwareSettingsDialog open={showHardwareSettings} onOpenChange={setShowHardwareSettings} />

        {/* Device Binding Status Dialog */}
        <Dialog open={showDeviceBindingDialog} onOpenChange={setShowDeviceBindingDialog}>
          <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-[2rem] border-0 shadow-2xl">
            <DialogHeader className="text-center pb-1">
              <DialogTitle className="text-xl font-black tracking-tight text-gray-900 flex items-center justify-center gap-2">
                <Lock className="w-5 h-5 text-amber-500" />
                Device Binding Status
              </DialogTitle>
              <DialogDescription className="text-xs font-semibold text-gray-500">
                Check which store account is currently linked to this device.
              </DialogDescription>
            </DialogHeader>

            <div className="pt-2">
              {statusLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 className="w-8 h-8 text-[#BF953F] animate-spin" />
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Checking device status…</p>
                </div>
              ) : statusError ? (
                <Card className="border border-rose-200 bg-rose-50 rounded-3xl shadow-sm">
                  <CardContent className="p-6 text-center space-y-3">
                    <AlertTriangle className="w-8 h-8 mx-auto text-rose-500" />
                    <h3 className="font-bold text-gray-900">Device status could not be loaded.</h3>
                    <p className="text-xs text-gray-600">The device binding could not be verified. Try again before relying on this status.</p>
                    <Button variant="outline" onClick={checkDeviceStatus} className="rounded-xl">
                      <RefreshCw className="w-3.5 h-3.5 mr-2" />
                      Retry status check
                    </Button>
                  </CardContent>
                </Card>
              ) : deviceStatus?.localAccountPresent && !deviceStatus.bound ? (
                <Card className="border-2 border-amber-500/40 bg-amber-50/60 rounded-3xl shadow-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
                    <div className="flex items-center gap-3 text-white">
                      <AlertTriangle className="w-6 h-6" />
                      <div>
                        <Badge className="mb-1 bg-white/20 text-white border-0 text-[9px] font-black uppercase tracking-widest">Binding unknown</Badge>
                        <h3 className="text-base font-black tracking-tight">Local account data found</h3>
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-5 space-y-3">
                    <p className="text-xs font-semibold leading-relaxed text-amber-900">
                      No explicit binding is recorded. Local account data is not a verified store identity. Continue to secure setup to authenticate as its owner before clearing this device state.
                    </p>
                    <Button variant="destructive" onClick={() => setLocation('/admin-signup')} className="w-full rounded-xl">
                      <Unlock className="w-4 h-4 mr-2" />
                      Verify owner & reset device
                    </Button>
                    <Button variant="outline" onClick={checkDeviceStatus} className="w-full rounded-xl">
                      <RefreshCw className="w-3.5 h-3.5 mr-2" />
                      Refresh status
                    </Button>
                  </CardContent>
                </Card>
              ) : deviceStatus?.bound ? (
                <Card className="border-2 border-amber-500/40 bg-amber-50/60 backdrop-blur-sm rounded-3xl shadow-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 px-6 py-4">
                    <div className="flex items-center gap-3 text-white">
                      <div className="w-10 h-10 bg-white/25 backdrop-blur rounded-xl flex items-center justify-center border border-white/30">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div className="text-left flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="destructive" className="bg-white/25 border-0 text-white text-[9px] font-black uppercase tracking-widest rounded-full px-3 py-0.5">
                            Device Bound
                          </Badge>
                          <span className="text-[9px] font-bold text-white/80 uppercase tracking-widest">
                            {deviceStatus.identityVerified ? 'Identity verified' : 'Identity unavailable'}
                          </span>
                        </div>
                        <h3 className="text-base font-black tracking-tight">
                          {deviceStatus.identityVerified
                            ? deviceStatus.tenant?.storeName || deviceStatus.admin?.businessName || 'Store name unavailable'
                            : 'Account identity unavailable'}
                        </h3>
                        {deviceStatus.identityVerified && deviceStatus.tenant?.subdomain && (
                          <p className="text-[10px] font-bold text-white/80 uppercase tracking-widest mt-0.5">{deviceStatus.tenant.subdomain}.smartpos.app</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-5 space-y-3">
                    {!deviceStatus.identityVerified && (
                      <div className="p-3.5 bg-amber-100/80 rounded-2xl border border-amber-200/80 flex items-start gap-2.5">
                        <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] font-semibold text-amber-900/90 leading-relaxed">
                          The device binding exists, but the store account could not be verified. Cached or guessed account details are hidden. Refresh status when the server is reachable.
                        </p>
                      </div>
                    )}
                    {deviceStatus.identityVerified && deviceStatus.admin && (
                    <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                      <div className="w-9 h-9 bg-blue-50 text-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                        <UserIcon className="w-4.5 h-4.5" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Bound Account User</p>
                        <p className="text-sm font-bold text-gray-900 truncate">
                          {deviceStatus.admin?.ownerName || deviceStatus.admin?.username || 'Owner details unavailable'}
                        </p>
                        {deviceStatus.admin?.role && (
                          <Badge className="mt-1 bg-blue-50 text-blue-600 border-0 text-[9px] font-black uppercase tracking-widest">{deviceStatus.admin.role}</Badge>
                        )}
                      </div>
                    </div>
                    )}
                    {deviceStatus.identityVerified && deviceStatus.admin?.mobile && (
                      <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                        <div className="w-9 h-9 bg-emerald-50 text-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Smartphone className="w-4.5 h-4.5" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Contact Number</p>
                          <p className="text-sm font-bold text-gray-900 truncate">{deviceStatus.admin.mobile}</p>
                        </div>
                      </div>
                    )}
                    {deviceStatus.identityVerified && deviceStatus.admin?.email && (
                      <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                        <div className="w-9 h-9 bg-sky-50 text-sky-500 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Mail className="w-4.5 h-4.5" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Email Address</p>
                          <p className="text-sm font-bold text-gray-900 truncate">{deviceStatus.admin.email}</p>
                        </div>
                      </div>
                    )}
                    <div className="p-3.5 bg-amber-100/80 rounded-2xl border border-amber-200/80 flex items-start gap-2.5">
                      <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] font-semibold text-amber-900/90 leading-relaxed">
                        Unbinding this device will <span className="font-black">permanently erase</span> all store data,
                        products, sales history, and settings from this device. This action cannot be undone.
                      </p>
                    </div>
                    <div className="pt-2 flex flex-col gap-2">
                      <Button
                        variant="outline"
                        onClick={checkDeviceStatus}
                        className="w-full rounded-2xl h-11 font-black text-xs border-gray-200 text-gray-600 hover:bg-gray-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-2" />
                        Refresh Device Status
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setLocation('/admin-signup')}
                        className="w-full rounded-2xl h-12 font-black text-xs shadow-lg bg-rose-600 hover:bg-rose-700 border-0"
                      >
                        <Unlock className="w-4 h-4 mr-2" />
                        Verify owner & reset device
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-2 border-emerald-500/30 bg-emerald-50/60 rounded-3xl shadow-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-4">
                    <div className="flex items-center gap-3 text-white">
                      <div className="w-10 h-10 bg-white/25 backdrop-blur rounded-xl flex items-center justify-center border border-white/30">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div className="text-left flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className="bg-white/25 border-0 text-white text-[9px] font-black uppercase tracking-widest rounded-full px-3 py-0.5">
                            Ready
                          </Badge>
                        </div>
                        <h3 className="text-base font-black tracking-tight">Device is unbound</h3>
                        <p className="text-[10px] font-bold text-white/80 mt-0.5">No store account is currently linked.</p>
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-5 space-y-3">
                    <div className="p-3 bg-white rounded-2xl border border-gray-100 flex items-start gap-2.5">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] font-semibold text-gray-700 leading-relaxed">
                        This device is clean and ready. You can create a new store account or sign in to an existing one.
                      </p>
                    </div>
                    <div className="pt-2 flex flex-col gap-2">
                      <Button
                        variant="outline"
                        onClick={checkDeviceStatus}
                        className="w-full rounded-2xl h-11 font-black text-xs border-gray-200 text-gray-600 hover:bg-gray-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-2" />
                        Refresh Device Status
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Other Dialogs */}
        <Dialog open={showHelpSupportDialog} onOpenChange={setShowHelpSupportDialog}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-[#BF953F]" />
                Help & Support
              </DialogTitle>
              <DialogDescription>
                Reach out to the developer team and review a quick tutorial placeholder.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#BF953F] text-lg font-black text-white">
                  BD
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900">BSIS Developer</h3>
                  <p className="text-sm text-gray-500">Temporary support contact for SmartPOS assistance.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Your Query</Label>
                <Textarea
                  value={helpQuery}
                  onChange={(e) => setHelpQuery(e.target.value)}
                  placeholder="Type your question or issue here..."
                  className="min-h-24 rounded-2xl border-gray-200"
                />
                <Button onClick={handleSendSupportEmail} className="w-full rounded-2xl bg-[#BF953F] hover:bg-[#B38728]">
                  <Mail className="mr-2 h-4 w-4" /> Send Email
                </Button>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-gray-900">System Tutorial</h4>
                    <p className="text-sm text-gray-500">Temporary placeholder video section.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsTutorialPlaying(prev => !prev)}
                    className="rounded-full"
                  >
                    {isTutorialPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                    {isTutorialPlaying ? 'Pause' : 'Play'}
                  </Button>
                </div>
                <div className="mt-4 flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/80 px-4 text-center">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#BF953F]/10 text-[#BF953F]">
                      {isTutorialPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-1 h-5 w-5" />}
                    </div>
                    <p className="text-sm font-semibold text-gray-700">
                      {isTutorialPlaying ? 'Tutorial preview is now playing.' : 'Video tutorial placeholder will appear here.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showAccountDetails} onOpenChange={setShowAccountDetails}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#FF8882]" />
                Security Center
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="password" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="questions">Questions</TabsTrigger>
              </TabsList>
              
              <TabsContent value="password">
                <Form {...credentialsForm}>
                  <form onSubmit={credentialsForm.handleSubmit(onSubmitCredentials)} className="space-y-4 py-2">
                    <FormField control={credentialsForm.control} name="currentPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">Current Password</FormLabel>
                        <FormControl><Input type="password" {...field} className="rounded-xl h-12" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={credentialsForm.control} name="newPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">New Password</FormLabel>
                        <FormControl><Input type="password" {...field} className="rounded-xl h-12" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={credentialsForm.control} name="confirmPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">Confirm Password</FormLabel>
                        <FormControl><Input type="password" {...field} className="rounded-xl h-12" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="flex gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setShowAccountDetails(false)} className="flex-1 h-12 rounded-xl">Cancel</Button>
                      <Button type="submit" disabled={isLoading} className="flex-1 h-12 rounded-xl bg-[#FF8882] hover:bg-[#D89D9D]">
                        {isLoading ? 'Updating...' : 'Update Password'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="questions">
                <Form {...securityQuestionsForm}>
                  <form onSubmit={securityQuestionsForm.handleSubmit(onSubmitSecurityQuestions)} className="space-y-4 py-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    <div className="space-y-4">
                      {[1, 2, 3].map((num) => (
                        <div key={num} className="space-y-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#BF953F]">Question {num}</h4>
                          <FormField control={securityQuestionsForm.control} name={`question${num}` as any} render={({ field }) => (
                            <FormItem>
                              <FormControl><Input placeholder={`Security Question ${num}`} {...field} className="rounded-xl" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={securityQuestionsForm.control} name={`answer${num}` as any} render={({ field }) => (
                            <FormItem>
                              <FormControl><Input type="password" placeholder={`Answer ${num}`} {...field} className="rounded-xl" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setShowAccountDetails(false)} className="flex-1 h-12 rounded-xl">Cancel</Button>
                      <Button type="submit" disabled={isLoading} className="flex-1 h-12 rounded-xl bg-[#BF953F] hover:bg-[#B38728]">
                        {isLoading ? 'Saving...' : 'Save Questions'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        <Dialog open={showStoreInfoDialog} onOpenChange={setShowStoreInfoDialog}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Store className="w-5 h-5 text-[#FF8882]" />
                Store Profile
              </DialogTitle>
            </DialogHeader>
            <Form {...profileForm}>
              <form onSubmit={profileForm.handleSubmit(onSubmitProfile)} className="space-y-4 py-4">
                <FormField control={profileForm.control} name="businessName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">Business Name</FormLabel>
                    <FormControl><Input {...field} className="rounded-xl h-12" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={profileForm.control} name="ownerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">Owner Name</FormLabel>
                    <FormControl><Input {...field} className="rounded-xl h-12" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={profileForm.control} name="mobile" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">Mobile Number</FormLabel>
                    <FormControl><Input {...field} className="rounded-xl h-12" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowStoreInfoDialog(false)} className="flex-1 h-12 rounded-xl">Cancel</Button>
                  <Button type="submit" disabled={isLoading} className="flex-1 h-12 rounded-xl bg-[#FF8882] hover:bg-[#D89D9D]">Save Changes</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={showBackupDialog} onOpenChange={setShowBackupDialog}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-[#BF953F]" />
                Data Backup
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Users', count: backupCounts.users },
                  { label: 'Products', count: backupCounts.products },
                  { label: 'Sales', count: backupCounts.sales },
                  { label: 'Items', count: backupCounts.saleItems },
                  { label: 'Staff', count: backupCounts.staff },
                  { label: 'Expenses', count: backupCounts.expenses }
                ].map(item => (
                  <div key={item.label} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                    <div className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">{item.label}</div>
                    <div className="text-lg font-black text-gray-900 dark:text-white">{item.count}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={async () => {
                  const [u, p, s, si, st, e, pr, c] = await Promise.all([db.users.toArray(), db.products.toArray(), db.sales.toArray(), db.saleItems.toArray(), db.staff.toArray(), db.expenses.toArray(), db.purchases.toArray(), db.creditors.toArray()]);
                  const blob = new Blob([JSON.stringify({ timestamp: new Date().toISOString(), u, p, s, si, st, e, pr, c })], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `smartpos-backup-${Date.now()}.json`; a.click();
                  toast({ title: 'Success', description: 'Backup file downloaded' });
                }} className="h-12 rounded-xl bg-[#BF953F] hover:bg-[#B38728] font-bold">Download JSON Backup</Button>
                <Button variant="outline" onClick={async () => {
                  const success = await syncWithRouter();
                  if (success) toast({ title: 'Synced', description: 'Cloud backup complete' });
                  else toast({ title: 'Failed', description: 'Check network connection', variant: 'destructive' });
                }} className="h-12 rounded-xl font-bold">Sync to Cloud Router</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Router Settings Dialog */}
        <Dialog open={showRouterSettings} onOpenChange={setShowRouterSettings}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wifi className="w-5 h-5 text-indigo-500" />
                Network Setup
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className={cn("flex items-center justify-between p-4 rounded-2xl border transition-all", isConnectedToRouter ? "bg-emerald-50 border-emerald-100" : "bg-gray-50 border-gray-100")}>
                <div className="flex items-center gap-3">
                  <div className={cn("w-2.5 h-2.5 rounded-full", isConnectedToRouter ? "bg-emerald-500 animate-pulse" : "bg-gray-300")} />
                  <span className={cn("text-xs font-black uppercase tracking-widest", isConnectedToRouter ? "text-emerald-700" : "text-gray-500")}>
                    {isConnectedToRouter ? 'System Online' : 'System Offline'}
                  </span>
                </div>
                {isConnectedToRouter && <Button variant="ghost" size="sm" className="h-8 text-[10px] font-black" onClick={disconnectFromRouter}>DISCONNECT</Button>}
              </div>

              <Button variant="outline" className="w-full h-12 rounded-xl font-bold" onClick={scanWiFi} disabled={isScanningWiFi}>
                <RefreshCw className={cn("w-4 h-4 mr-2", isScanningWiFi && "animate-spin")} />
                {isScanningWiFi ? 'Scanning...' : 'Scan Available Networks'}
              </Button>

              <Select value={selectedWiFi} onValueChange={handleWiFiSelection}>
                <SelectTrigger className="h-12 rounded-xl"><SelectValue placeholder="Select WiFi" /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  {availableWiFis.map(wifi => (
                    <SelectItem key={wifi.ssid} value={wifi.ssid}>
                      <div className="flex items-center gap-2">
                        <span>{wifi.ssid}</span>
                        {wifi.security !== 'Open' && <Shield className="w-3 h-3 opacity-40" />}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowRouterSettings(false)} className="flex-1 h-12 rounded-xl">Cancel</Button>
                <Button onClick={connectToWiFi} disabled={!selectedWiFi || isConnecting} className="flex-1 h-12 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold">
                  {isConnecting ? '...' : 'Connect'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-500" />
                Network Password
              </DialogTitle>
              <DialogDescription className="text-xs font-bold uppercase tracking-wider">
                Connecting to {selectedWiFiForPassword}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} placeholder="Password" className="h-12 rounded-xl" autoFocus onKeyDown={e => e.key === 'Enter' && connectToWiFi()} />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowPasswordDialog(false); setPasswordInput(''); }} className="flex-1 h-12 rounded-xl">Cancel</Button>
              <Button onClick={connectToWiFi} disabled={!passwordInput || isConnecting} className="flex-1 h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold">
                {isConnecting ? '...' : 'Verify'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
          <AlertDialogContent className="rounded-3xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-black">Terminate Session?</AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium">
                You will be logged out of the commander console. All unsaved changes will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel className="h-12 rounded-xl">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleLogout} className="h-12 rounded-xl bg-red-500 hover:bg-red-600 font-bold">Logout</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </motion.div>
    </Layout>
  );
};

export default ProfileSettings;
