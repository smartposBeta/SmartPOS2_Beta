import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, ArrowLeft, Lock, X, Unlock, Loader2, Building2, User as UserIcon, Smartphone, Mail, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AuthService } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import api from '@/lib/api';

const signupSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  ownerName: z.string().min(1, 'Owner name is required'),
  mobile: z.string().min(10, 'Valid mobile number is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type SignupFormData = z.infer<typeof signupSchema>;

type DeviceStatus = {
  bound: boolean;
  identityVerified?: boolean;
  localAccountPresent?: boolean;
  tenant?: {
    id: string;
    storeName?: string;
    subdomain?: string;
    createdAt?: string;
  } | null;
  admin?: {
    id: string;
    username?: string;
    ownerName?: string;
    businessName?: string;
    mobile?: string;
    email?: string;
    role?: string;
  } | null;
  message?: string;
};

const AdminSignup: React.FC = () => {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const { login, unbindDevice } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    const hasToken = typeof localStorage !== 'undefined' && !!localStorage.getItem('smartpos_token');
    const hasUser = typeof localStorage !== 'undefined' && !!localStorage.getItem('smartpos_user');
    if (!hasToken && !hasUser) {
      AuthService.purgeLocalState({ skipApiCall: true }).catch(e =>
        console.warn('[admin-signup] Mount purge error (non-fatal):', e)
      );
    }
  }, []);

  const checkDeviceStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    setDeviceStatus(null);
    try {
      const response: DeviceStatus = await api.get('/api/tenants/device-status');
      if (typeof response?.bound !== 'boolean' || typeof response?.identityVerified !== 'boolean') {
        throw new Error('Device status response was incomplete or from an unsupported server version');
      }
      const identityVerified = response.identityVerified === true;
      const data = {
        ...response,
        identityVerified,
        localAccountPresent: response.localAccountPresent === true,
        tenant: identityVerified ? response.tenant : null,
        admin: identityVerified ? response.admin : null,
      };
      setDeviceStatus(data);
      if (data.bound || data.localAccountPresent) {
        setIsLocked(true);
      } else {
        setIsLocked(false);
      }
    } catch (e) {
      console.warn('Failed to verify device binding status:', e);
      setIsLocked(false);
      setStatusError('Device binding could not be verified. Retry before creating an account.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    checkDeviceStatus();
  }, [checkDeviceStatus]);

  const handleConfirmUnbind = async () => {
    setUnbindLoading(true);
    try {
      const r = await unbindDevice();
      if (!r.success) {
        toast({ title: 'Unbind Failed', description: r.error || 'Unable to unbind device.', variant: 'destructive' });
        return;
      }
      toast({
        title: 'Device Successfully Unbound',
        description: 'All local data has been erased. Device is ready for a new account.',
        duration: 5000,
      });
      setShowUnbindConfirm(false);
      await checkDeviceStatus();
      if (typeof window !== 'undefined') {
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (e: any) {
      toast({
        title: 'Unbind Failed',
        description: e?.message || String(e) || 'Unexpected error during unbind.',
        variant: 'destructive',
      });
    } finally {
      setUnbindLoading(false);
    }
  };

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      businessName: '',
      ownerName: '',
      mobile: '',
      password: '',
    },
  });

  const onSubmit = async (data: SignupFormData) => {
    if (statusLoading || statusError || isLocked) return;
    setIsLoading(true);
    try {
      const response = await AuthService.createAdmin(data);
      login(response.user, response.token);
      toast({
        title: 'Account Created',
        description: 'Welcome to SmartPOS+!',
      });
      setLocation('/admin-dashboard');
    } catch (error) {
      console.error('Signup error:', error);
      toast({
        title: 'Signup Failed',
        description: error instanceof Error ? error.message : 'An error occurred while creating your account',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (statusLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="animate-pulse space-y-4 text-center">
          <Loader2 className="w-12 h-12 text-[#FF8882] animate-spin mx-auto" />
          <p className="text-sm text-gray-500 font-medium">Checking device binding status…</p>
        </div>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full rounded-2xl border-amber-200 p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
          <h2 className="text-lg font-bold text-gray-900">Binding status unavailable</h2>
          <p className="text-sm text-gray-600">{statusError}</p>
          <Button onClick={checkDeviceStatus} className="w-full rounded-xl">Retry status check</Button>
        </Card>
      </div>
    );
  }

  if (isLocked) {
    const identityVerified = deviceStatus?.identityVerified === true;
    const hasConfirmedBinding = deviceStatus?.bound === true;
    const storeName = identityVerified
      ? deviceStatus?.tenant?.storeName || deviceStatus?.admin?.businessName || 'Store name unavailable'
      : 'Account identity unavailable';
    const ownerName = identityVerified ? deviceStatus?.admin?.ownerName || deviceStatus?.admin?.username : null;
    const subdomain = identityVerified ? deviceStatus?.tenant?.subdomain : undefined;
    const adminMobile = identityVerified ? deviceStatus?.admin?.mobile : undefined;
    const adminEmail = identityVerified ? deviceStatus?.admin?.email : undefined;
    const adminUsername = identityVerified ? deviceStatus?.admin?.username : undefined;

    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-rose-50 to-amber-50 flex flex-col items-center justify-center p-4 sm:p-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-lg"
          >
            <div className="mb-6">
              <div className="w-24 h-24 bg-gradient-to-br from-amber-100 to-rose-100 rounded-[2rem] flex items-center justify-center mb-5 mx-auto shadow-xl shadow-rose-100/60 border-4 border-white">
                <Lock className="w-12 h-12 text-rose-500" />
              </div>
              <div className="flex items-center justify-center gap-2 mb-3">
                <Badge variant="destructive" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] rounded-full bg-rose-500/90 border-0 shadow-lg shadow-rose-200">
                  <AlertTriangle className="w-3 h-3 mr-1.5" /> {hasConfirmedBinding ? 'Device Bound' : 'Local Account Found'}
                </Badge>
              </div>
              <h2 className="text-3xl font-black text-gray-900 tracking-tight mb-2">
                {hasConfirmedBinding ? 'Device Already Registered' : 'Account Setup Needs Attention'}
              </h2>
              <p className="text-sm text-gray-500 font-medium max-w-sm mx-auto leading-relaxed">
                This terminal is linked to an existing account.
                {hasConfirmedBinding
                  ? identityVerified ? ' Verified account details are shown below.' : ' The account identity could not be verified, so cached details are hidden.'
                  : ' Local account data exists, but no explicit device binding can be verified. Sign in to restore the binding.'}
              </p>
            </div>

            <Card className="mb-6 border-2 border-rose-100 bg-white/90 backdrop-blur-sm rounded-[2rem] shadow-2xl shadow-rose-100/50 overflow-hidden">
              <div className="bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500 px-6 py-5">
                <div className="flex items-center gap-3 text-white">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center border border-white/30">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80 mb-0.5">
                      {identityVerified ? 'Verified Store' : hasConfirmedBinding ? 'Device Binding' : 'Local Account Data'}
                    </p>
                    <h3 className="text-xl font-black tracking-tight">{storeName}</h3>
                    {subdomain && (
                      <p className="text-xs font-semibold text-white/80 mt-0.5">
                        <span className="bg-white/20 px-2 py-0.5 rounded-md font-mono">{subdomain}.smartpos</span>
                      </p>
                    )}
                  </div>
                  <CheckCircle2 className="w-7 h-7 text-white/90" />
                </div>
              </div>

              <CardContent className="p-5 space-y-3 text-left">
                {identityVerified ? (
                  <div className="space-y-3">
                    {deviceStatus?.admin && (
                      <>
                        <div className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-2xl border border-gray-100">
                          <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                            <UserIcon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Bound Account User</p>
                            <p className="text-sm font-bold text-gray-900 truncate">{ownerName || 'Owner details unavailable'}</p>
                            {adminUsername && adminUsername !== ownerName && (
                              <p className="text-[11px] font-medium text-gray-500">@{adminUsername}</p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest border-amber-200 bg-amber-50 text-amber-700 rounded-full px-2.5 py-0.5">
                            {deviceStatus.admin.role || 'Admin'}
                          </Badge>
                        </div>

                        {adminMobile && (
                          <div className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center flex-shrink-0">
                              <Smartphone className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Contact Number</p>
                              <p className="text-sm font-bold text-gray-900 truncate">{adminMobile}</p>
                            </div>
                          </div>
                        )}

                        {adminEmail && (
                          <div className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-2xl border border-gray-100">
                            <div className="w-10 h-10 bg-purple-50 text-purple-500 rounded-xl flex items-center justify-center flex-shrink-0">
                              <Mail className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Email Address</p>
                              <p className="text-sm font-bold text-gray-900 truncate">{adminEmail}</p>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] font-semibold text-amber-800">
                    {hasConfirmedBinding
                      ? 'The device is bound, but its account details are not available for verification. Refresh status before relying on an account name or owner.'
                      : 'Local account data exists without an explicit device binding. Sign in to restore the binding before setting up another account.'}
                  </div>
                )}

                {hasConfirmedBinding && <div className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">
                      Unbinding this device will <span className="font-black underline">permanently erase ALL local data</span> including
                      products, sales, staff records, and settings. The device will be completely blank and ready for a new account.
                    </p>
                  </div>
                </div>}
              </CardContent>
            </Card>

            <div className="w-full space-y-3">
              <Button
                onClick={() => setLocation('/admin-login')}
                className="w-full bg-gradient-to-r from-[#FF8882] to-[#FF9B95] hover:from-[#E87872] hover:to-[#E88A84] text-white rounded-2xl py-5 font-black text-sm shadow-xl shadow-rose-200/70 transition-all active:scale-[0.98]"
              >
                <Store className="w-4.5 h-4.5 mr-2" />
                {identityVerified ? 'Sign In to This Store' : 'Sign In'}
              </Button>

              {!identityVerified && hasConfirmedBinding && (
                <Button
                  variant="outline"
                  onClick={checkDeviceStatus}
                  className="w-full rounded-2xl py-5 font-bold text-sm"
                >
                  Refresh Binding Status
                </Button>
              )}

              {hasConfirmedBinding && (
                <Button
                  onClick={() => setShowUnbindConfirm(true)}
                  variant="destructive"
                  className="w-full rounded-2xl py-5 font-black text-sm shadow-lg shadow-red-100 transition-all active:scale-[0.98] bg-white text-red-600 border-2 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                >
                  <Unlock className="w-4.5 h-4.5 mr-2" />
                  Unbind & Factory Reset Device
                </Button>
              )}
            </div>
          </motion.div>
        </div>

        <AlertDialog open={showUnbindConfirm} onOpenChange={setShowUnbindConfirm}>
          <AlertDialogContent className="rounded-[2rem] max-w-md border-0 shadow-2xl">
            <AlertDialogHeader className="text-center pb-2">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <AlertDialogTitle className="text-xl font-black tracking-tight text-gray-900">
                Confirm Device Factory Reset
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium text-gray-500 leading-relaxed pt-1">
                You are about to unbind this device and perform a complete data wipe.
                This action is irreversible and will erase everything from this device:
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="px-1 py-3 space-y-2">
              {[
                'All products, variants & inventory records',
                'Complete sales history & receipts',
                'Staff accounts, permissions & remittances',
                'Customer records, credits & payments',
                'All settings, configuration & device preferences',
                'Admin account & session data'
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5 text-xs text-gray-600 font-medium bg-red-50 px-3 py-2 rounded-xl">
                  <X className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <AlertDialogFooter className="flex-col sm:flex-col gap-2 pt-2">
              <AlertDialogCancel className="w-full rounded-xl h-12 font-bold text-sm border-gray-200">
                Cancel — Keep Current Data
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleConfirmUnbind(); }}
                disabled={unbindLoading}
                className="w-full rounded-xl h-12 font-black text-sm bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200"
              >
                {unbindLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Erasing Everything…
                  </>
                ) : (
                  <>
                    <Unlock className="w-4 h-4 mr-2" />
                    Yes — Unbind & Reset Everything
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-white"
    >
      <div className="p-6">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center mb-6 pt-6"
        >
          <Store className="w-16 h-16 text-primary-500 mb-4 mx-auto" />
          <h2 className="text-2xl font-bold text-gray-800">Setup Your Business</h2>
          <p className="text-gray-600 mt-2">Create a new SmartPOS+ account</p>
        </motion.div>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="businessName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 font-medium">Business Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Kanegosyo Store"
                      data-testid="input-business-name"
                      className="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="ownerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 font-medium">Owner's Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Your full name"
                      data-testid="input-owner-name"
                      className="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="mobile"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 font-medium">Mobile Number</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="+63 9XX XXX XXXX"
                      data-testid="input-mobile"
                      className="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 font-medium">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Create a strong password"
                      data-testid="input-password"
                      className="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button
              type="submit"
              disabled={isLoading}
              data-testid="button-create-account"
              className="w-full bg-[#FF8882] text-white p-4 rounded-xl font-semibold shadow-lg hover:bg-[#D89D9D] mt-6 touch-feedback"
              style={{
                boxShadow: '0 4px 12px rgba(255, 136, 130, 0.3)',
              }}
            >
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </Button>
          </form>
        </Form>
        
        <div className="text-center mt-4">
          <span className="text-gray-500">Already have an account?</span>
          <button
            onClick={() => setLocation('/admin-login')}
            data-testid="button-go-login"
            className="text-primary-500 font-semibold ml-1"
          >
            Login
          </button>
        </div>
        
        <button
          onClick={() => setLocation('/role-selection')}
          data-testid="button-back"
          className="mt-4 text-gray-400 flex items-center touch-feedback"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </button>
      </div>
    </motion.div>
  );
};

export default AdminSignup;
