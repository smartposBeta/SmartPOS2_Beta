import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Store, ArrowLeft, Lock, Unlock, Loader2, Building2, User as UserIcon, Smartphone, Mail, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  serverLocalAccountPresent?: boolean;
  deviceResetReady?: boolean;
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
  const [ownerCredentials, setOwnerCredentials] = useState({ username: '', password: '' });
  const [resetCleanupScope, setResetCleanupScope] = useState<{ tenantId: string; accountId: string } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const { login, unbindDevice } = useAuth();
  const { toast } = useToast();

  const checkDeviceStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    setDeviceStatus(null);
    try {
      const response: DeviceStatus = await api.get('/api/tenants/device-status');
      if (
        typeof response?.bound !== 'boolean'
        || typeof response?.identityVerified !== 'boolean'
        || typeof response?.deviceResetReady !== 'boolean'
      ) {
        throw new Error('Device status response was incomplete or from an unsupported server version');
      }
      const identityVerified = response.identityVerified === true;
      const browserAccountPresent = await AuthService.hasLocalAdminAccount();
      const data = {
        ...response,
        identityVerified,
        serverLocalAccountPresent: response.localAccountPresent === true,
        localAccountPresent: response.localAccountPresent === true || browserAccountPresent,
        tenant: identityVerified ? response.tenant : null,
        admin: identityVerified ? response.admin : null,
      };
      setDeviceStatus(data);
      if (data.bound || data.localAccountPresent) {
        setIsLocked(true);
      } else {
        setIsLocked(false);
        setResetCleanupScope(null);
      }
      return !data.bound && !data.localAccountPresent;
    } catch (e) {
      console.warn('Failed to verify device binding status:', e);
      setIsLocked(true);
      setStatusError('Device binding could not be verified. Retry before creating an account.');
      return false;
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
      if (
        !deviceStatus?.bound
        && !deviceStatus?.serverLocalAccountPresent
        && deviceStatus?.localAccountPresent
      ) {
        const localScope = await AuthService.verifyLocalAdminCredentials(
          ownerCredentials.username,
          ownerCredentials.password
        );
        if (!localScope) {
          setOwnerCredentials(current => ({ ...current, password: '' }));
          toast({ title: 'Owner verification failed', description: 'Credentials did not match the local admin account on this browser.', variant: 'destructive' });
          return;
        }
        try {
          await AuthService.purgeDeviceTenantState(localScope.tenantId, localScope.accountId);
        } catch (error: any) {
          setResetCleanupScope(localScope);
          setStatusError(error?.message || 'Local cleanup failed. Retry before creating an account.');
          setIsLocked(true);
          return;
        }
        setShowUnbindConfirm(false);
        setOwnerCredentials({ username: '', password: '' });
        const ready = await checkDeviceStatus();
        if (!ready) {
          toast({ title: 'Reset needs attention', description: 'The device still reports a blocking local account. Retry status or contact support.', variant: 'destructive' });
          return;
        }
        toast({ title: 'Local account reset verified', description: 'No server binding or blocking local account remains.' });
        return;
      }

      const r = await unbindDevice({
        adminUsername: ownerCredentials.username,
        adminPassword: ownerCredentials.password
      });
      if (!r.success) {
        if (!r.resetCommitted) {
          setOwnerCredentials(current => ({ ...current, password: '' }));
        }
        if (r.resetCommitted && r.tenantId && r.accountId) {
          setResetCleanupScope({ tenantId: r.tenantId, accountId: r.accountId });
          setStatusError(r.error || 'The server reset the binding, but local cleanup did not finish. Retry cleanup before creating an account.');
          setIsLocked(true);
        }
        toast({ title: 'Unbind Failed', description: r.error || 'Unable to unbind device.', variant: 'destructive' });
        return;
      }
      setShowUnbindConfirm(false);
      setOwnerCredentials({ username: '', password: '' });
      const ready = await checkDeviceStatus();
      if (!ready) {
        toast({
          title: 'Reset needs attention',
          description: 'The device is still bound or local account data remains. Retry status or contact support.',
          variant: 'destructive'
        });
        return;
      }
      toast({ title: 'Device reset verified', description: 'The current device is ready for account setup.' });
    } catch (e: any) {
      setOwnerCredentials(current => ({ ...current, password: '' }));
      toast({
        title: 'Unbind Failed',
        description: e?.message || String(e) || 'Unexpected error during unbind.',
        variant: 'destructive',
      });
    } finally {
      setUnbindLoading(false);
    }
  };

  const retryLocalCleanup = async () => {
    if (!resetCleanupScope) return;
    setUnbindLoading(true);
    try {
      await AuthService.purgeDeviceTenantState(resetCleanupScope.tenantId, resetCleanupScope.accountId);
      setResetCleanupScope(null);
      const ready = await checkDeviceStatus();
      if (ready) {
        setStatusError(null);
        toast({ title: 'Device reset verified', description: 'The current device is ready for account setup.' });
      } else {
        setStatusError('Local cleanup completed, but the server still reports a blocking device account. Retry status or contact support.');
      }
    } catch (error: any) {
      setStatusError(error?.message || 'Local cleanup failed. Retry before creating an account.');
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
          {resetCleanupScope && (
            <Button onClick={retryLocalCleanup} disabled={unbindLoading} variant="outline" className="w-full rounded-xl">
              {unbindLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Retry local cleanup
            </Button>
          )}
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
      : hasConfirmedBinding ? 'Account identity unavailable' : 'Local account data found';
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
                {hasConfirmedBinding ? 'This terminal is linked to an existing account.' : 'A local admin account exists, but no device binding is recorded.'}
                {hasConfirmedBinding
                  ? identityVerified ? ' Verified account details are shown below.' : ' The account identity could not be verified, so cached details are hidden.'
                  : ' This local data is not shown as a verified store. Authenticate as its owner to clear the stale device account state.'}
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

                {(hasConfirmedBinding || deviceStatus?.localAccountPresent) && <div className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">
                      Reset removes this account’s device binding, local server session, and matching browser cache. It does not delete the cloud account, cloud inventory, or unrelated tenant records. Copies may remain in backups or other storage.
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

              {(hasConfirmedBinding || deviceStatus?.localAccountPresent) && (
                <Button
                  onClick={() => {
                    setOwnerCredentials({ username: adminUsername || '', password: '' });
                    setShowUnbindConfirm(true);
                  }}
                  variant="destructive"
                  className="w-full rounded-2xl py-5 font-black text-sm shadow-lg shadow-red-100 transition-all active:scale-[0.98] bg-white text-red-600 border-2 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                >
                  <Unlock className="w-4.5 h-4.5 mr-2" />
                  Verify Owner & Reset Device
                </Button>
              )}
            </div>
          </motion.div>
        </div>

        <AlertDialog
          open={showUnbindConfirm}
          onOpenChange={(open) => {
            setShowUnbindConfirm(open);
            if (!open) setOwnerCredentials({ username: '', password: '' });
          }}
        >
          <AlertDialogContent className="rounded-[2rem] max-w-md border-0 shadow-2xl">
            <AlertDialogHeader className="text-center pb-2">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
              <AlertDialogTitle className="text-xl font-black tracking-tight text-gray-900">
                Verify Owner and Reset Device
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium text-gray-500 leading-relaxed pt-1">
                  Enter the current store owner’s sign-in credentials. They are checked against the bound tenant, or against the exact local account when no binding exists. No cloud account or cloud inventory is deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="px-1 py-3 space-y-4 text-left">
                <div className="space-y-1.5">
                  <label htmlFor="reset-owner-username" className="text-sm font-semibold text-gray-700">Owner username or sign-in ID</label>
                  <Input
                    id="reset-owner-username"
                    autoComplete="username"
                    value={ownerCredentials.username}
                    onChange={(event) => setOwnerCredentials(current => ({ ...current, username: event.target.value }))}
                    placeholder="Enter the current owner’s sign-in"
                    disabled={unbindLoading}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="reset-owner-password" className="text-sm font-semibold text-gray-700">Current password</label>
                  <Input
                    id="reset-owner-password"
                    type="password"
                    autoComplete="current-password"
                    value={ownerCredentials.password}
                    onChange={(event) => setOwnerCredentials(current => ({ ...current, password: event.target.value }))}
                    placeholder="Enter the owner password"
                    disabled={unbindLoading}
                    required
                  />
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Only this device’s local account/session state and matching browser cache are cleared. Local data may remain in backups; this is not a secure data-erasure guarantee.
                </p>
              </div>

              <AlertDialogFooter className="flex-col sm:flex-col gap-2 pt-2">
                <AlertDialogCancel className="w-full rounded-xl h-12 font-bold text-sm border-gray-200">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); handleConfirmUnbind(); }}
                  disabled={unbindLoading || !ownerCredentials.username.trim() || !ownerCredentials.password}
                  className="w-full rounded-xl h-12 font-black text-sm bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200"
                >
                  {unbindLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying & resetting…
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4 mr-2" />
                      Confirm owner reset
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
