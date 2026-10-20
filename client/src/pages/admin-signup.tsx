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
  legacyBindingPresent?: boolean;
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
      if (data.bound) {
        setIsLocked(true);
      } else {
        setIsLocked(false);
        if (!data.localAccountPresent) setResetCleanupScope(null);
      }
      return !data.bound;
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
        && !deviceStatus?.legacyBindingPresent
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

  if (statusError) {
    return (
      <main className="min-h-screen bg-[#f5f7f3] px-5 py-10 flex items-center justify-center">
        <Card className="w-full max-w-md rounded-2xl border border-[#e4d8bd] bg-white p-7 shadow-[0_18px_55px_rgba(29,54,42,0.08)] sm:p-8">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#fbf3e3] text-[#94651b]">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-[#263b30]">We couldn’t verify this device</h1>
          <p className="mt-2 text-sm leading-6 text-[#66756b]">{statusError}</p>
          <p className="mt-3 text-xs leading-5 text-[#7b877e]">Account creation stays unavailable until the status check succeeds.</p>
          <div className="mt-6 space-y-3">
          {resetCleanupScope && (
            <Button onClick={retryLocalCleanup} disabled={unbindLoading} variant="outline" className="h-11 w-full rounded-xl border-[#cbd9ce] text-[#285b45] hover:bg-[#f3f7f3]">
              {unbindLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Retry local cleanup
            </Button>
          )}
          <Button onClick={checkDeviceStatus} className="h-11 w-full rounded-xl bg-[#21634a] font-semibold text-white hover:bg-[#194d39]">Retry status check</Button>
          </div>
          <button
            type="button"
            onClick={() => setLocation('/role-selection')}
            data-testid="button-back"
            className="mx-auto mt-5 inline-flex items-center text-sm font-medium text-[#66756b] transition-colors hover:text-[#21634a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to role selection
          </button>
        </Card>
      </main>
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
        <main className="min-h-screen bg-[#f5f7f3] px-4 py-8 text-center sm:px-6 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto w-full max-w-xl"
          >
            <div className="mb-7">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#dfe8df] bg-white text-[#21634a] shadow-sm">
                <Lock className="h-6 w-6" />
              </div>
              <div className="mb-3 flex items-center justify-center gap-2">
                <Badge variant="outline" className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${hasConfirmedBinding ? 'border-[#c6d9cc] bg-[#eaf2eb] text-[#285b45]' : 'border-[#e4d8bd] bg-[#fbf3e3] text-[#80591c]'}`}>
                  {hasConfirmedBinding ? 'Device binding confirmed' : 'Browser data only'}
                </Badge>
              </div>
              <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[#263b30] sm:text-3xl">
                {hasConfirmedBinding ? 'This device is already set up' : 'Cached account data found'}
              </h1>
              <p className="mx-auto max-w-md text-sm leading-6 text-[#66756b]">
                {hasConfirmedBinding ? 'This device is linked to an existing account.' : 'This browser has local account data, but the device status does not confirm a server-side binding.'}
                {hasConfirmedBinding
                  ? identityVerified ? ' Verified account details are shown below.' : ' The account identity could not be verified, so cached details are hidden.'
                  : ' The cached details below are not a verified store identity.'}
              </p>
            </div>

            <Card className="mb-6 overflow-hidden rounded-2xl border border-[#dce5dc] bg-white text-left shadow-[0_18px_55px_rgba(29,54,42,0.08)]">
              <div className="border-b border-[#e5ece5] bg-[#f7faf6] px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3 text-[#263b30]">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf2eb] text-[#21634a]">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#748278]">
                      {identityVerified ? 'Verified Store' : hasConfirmedBinding ? 'Device Binding' : 'Local Account Data'}
                    </p>
                    <h2 className="text-lg font-semibold tracking-tight text-[#263b30]">{storeName}</h2>
                    {subdomain && (
                      <p className="mt-1 text-xs font-medium text-[#66756b]">
                        <span className="rounded-md bg-white px-2 py-0.5 font-mono">{subdomain}.smartpos</span>
                      </p>
                    )}
                  </div>
                  {hasConfirmedBinding && <CheckCircle2 className="h-5 w-5 shrink-0 text-[#397957]" />}
                </div>
              </div>

              <CardContent className="space-y-3 p-5 sm:p-6">
                {identityVerified ? (
                  <div className="space-y-3">
                    {deviceStatus?.admin && (
                      <>
                        <div className="flex items-center gap-3 rounded-xl border border-[#e5ece5] bg-[#fbfcfa] p-3.5">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#eaf2eb] text-[#397957]">
                            <UserIcon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#748278]">Bound Account User</p>
                            <p className="truncate text-sm font-semibold text-[#263b30]">{ownerName || 'Owner details unavailable'}</p>
                            {adminUsername && adminUsername !== ownerName && (
                              <p className="text-[11px] font-medium text-gray-500">@{adminUsername}</p>
                            )}
                          </div>
                          <Badge variant="outline" className="rounded-full border-[#dce5dc] bg-white px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#66756b]">
                            {deviceStatus.admin.role || 'Admin'}
                          </Badge>
                        </div>

                        {adminMobile && (
                          <div className="flex items-center gap-3 rounded-xl border border-[#e5ece5] bg-[#fbfcfa] p-3.5">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#eaf2eb] text-[#397957]">
                              <Smartphone className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#748278]">Contact Number</p>
                              <p className="truncate text-sm font-semibold text-[#263b30]">{adminMobile}</p>
                            </div>
                          </div>
                        )}

                        {adminEmail && (
                          <div className="flex items-center gap-3 rounded-xl border border-[#e5ece5] bg-[#fbfcfa] p-3.5">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#eaf2eb] text-[#397957]">
                              <Mail className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#748278]">Email Address</p>
                              <p className="truncate text-sm font-semibold text-[#263b30]">{adminEmail}</p>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#e4d8bd] bg-[#fbf7ed] p-3.5 text-xs font-medium leading-5 text-[#725727]">
                    {hasConfirmedBinding
                      ? 'The device is bound, but its account details are not available for verification. Refresh status before relying on an account name or owner.'
                      : 'Local browser account data is not proof that this device is bound to a server account.'}
                  </div>
                )}

                {(hasConfirmedBinding || deviceStatus?.localAccountPresent) && <div className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#94651b]" />
                    <p className="text-xs font-medium leading-5 text-[#725727]">
                      Reset clears this browser’s device binding and matching browser cache. A matching local server session is revoked when available; the cloud account and shared tenant data are not deleted.
                    </p>
                  </div>
                </div>}
              </CardContent>
            </Card>

            <div className="w-full space-y-3">
              <Button
                onClick={() => setLocation('/admin-login')}
                className="h-12 w-full rounded-xl bg-[#21634a] font-semibold text-white shadow-sm transition-colors hover:bg-[#194d39] active:scale-[0.99]"
              >
                <Store className="mr-2 h-4 w-4" />
                {identityVerified ? 'Sign In to This Store' : 'Sign In'}
              </Button>

              {!identityVerified && hasConfirmedBinding && (
                <Button
                  variant="outline"
                  onClick={checkDeviceStatus}
                  className="h-12 w-full rounded-xl border-[#cbd9ce] font-semibold text-[#285b45] hover:bg-[#f3f7f3]"
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
                  className="h-12 w-full rounded-xl border border-[#e4d8bd] bg-white font-semibold text-[#80591c] transition-colors hover:bg-[#fbf7ed] hover:text-[#684713]"
                >
                  <Unlock className="mr-2 h-4 w-4" />
                  Verify Owner & Reset Device
                </Button>
              )}
            </div>
          </motion.div>
        </main>

        <AlertDialog
          open={showUnbindConfirm}
          onOpenChange={(open) => {
            setShowUnbindConfirm(open);
            if (!open) setOwnerCredentials({ username: '', password: '' });
          }}
        >
          <AlertDialogContent className="max-w-md rounded-2xl border border-[#dce5dc] shadow-[0_24px_70px_rgba(29,54,42,0.18)]">
            <AlertDialogHeader className="text-center pb-2">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#fbf3e3] text-[#94651b]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <AlertDialogTitle className="text-xl font-semibold tracking-tight text-[#263b30]">
                Verify Owner and Reset Device
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-1 text-sm font-normal leading-6 text-[#66756b]">
                  Enter the current store owner’s sign-in credentials. They are checked against the bound tenant, or against the exact local account when no binding exists. No cloud account or cloud inventory is deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="px-1 py-3 space-y-4 text-left">
                <div className="space-y-1.5">
                  <label htmlFor="reset-owner-username" className="text-sm font-medium text-[#33463a]">Owner username or sign-in ID</label>
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
                  <label htmlFor="reset-owner-password" className="text-sm font-medium text-[#33463a]">Current password</label>
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
                <p className="text-xs leading-5 text-[#66756b]">
                  Only this device’s local account/session state and matching browser cache are cleared. Local data may remain in backups; this is not a secure data-erasure guarantee.
                </p>
              </div>

              <AlertDialogFooter className="flex-col sm:flex-col gap-2 pt-2">
                <AlertDialogCancel className="h-11 w-full rounded-xl border-[#dce5dc] font-medium text-[#526258]">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); handleConfirmUnbind(); }}
                  disabled={unbindLoading || !ownerCredentials.username.trim() || !ownerCredentials.password}
                  className="h-11 w-full rounded-xl bg-[#21634a] font-semibold text-white shadow-sm hover:bg-[#194d39]"
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
    <main className="min-h-screen bg-[#f5f7f3] text-[#263b30]">
      <div className="mx-auto max-w-7xl px-5 pb-8 pt-5 sm:px-8 sm:pt-7">
        <header className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold tracking-tight text-[#263b30]">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#21634a] text-white">
              <Store className="h-4 w-4" aria-hidden="true" />
            </span>
            SmartPOS
          </div>
          <p className="text-right text-xs text-[#66756b] sm:text-sm">
            Already have an account?
            <button
              type="button"
              onClick={() => setLocation('/admin-login')}
              data-testid="button-go-login"
              className="ml-1.5 font-semibold text-[#21634a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-2"
            >
              Sign in
            </button>
          </p>
        </header>

        <div className="mx-auto mt-8 grid max-w-6xl grid-cols-1 gap-8 lg:mt-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
          <section className="order-2 rounded-2xl bg-[#173f31] px-6 py-7 text-white shadow-[0_22px_60px_rgba(23,63,49,0.12)] sm:px-8 sm:py-9 lg:order-1 lg:min-h-[590px] lg:flex lg:flex-col lg:justify-between lg:p-10">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#c9ddd0]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                Built for your business
              </p>
              <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                A better way to run your store starts here.
              </h2>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[#d2e0d6]">
                Set up your SmartPOS account and bring your day-to-day sales into one clear, reliable workspace.
              </p>
            </div>
            <div
              aria-hidden="true"
              className="mt-8 w-full max-w-[19rem] rotate-[-1deg] rounded-2xl border border-[#eadfc7] bg-[#fbf7ed] p-4 text-[#263b30] shadow-[0_16px_32px_rgba(8,28,19,0.22)] sm:mt-10"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#748278]">Sample close</p>
                  <p className="mt-1 text-xs font-semibold text-[#263b30]">Today at the counter</p>
                </div>
                <span className="rounded-md bg-[#eaf2eb] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#285b45]">SmartPOS</span>
              </div>
              <div className="my-3 border-t border-dashed border-[#d8ccb2]" />
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium text-[#748278]">Sales recorded</p>
                  <p className="mt-0.5 text-xl font-semibold tracking-tight text-[#173f31]">₱18,420</p>
                </div>
                <p className="pb-1 text-right text-[10px] font-medium leading-4 text-[#66756b]">42 transactions<br />ready to review</p>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-dashed border-[#d8ccb2] pt-3 text-[10px] font-medium text-[#526258]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#397957]" />
                Your day's sales, in one place
              </div>
            </div>
            <div className="mt-8 border-t border-white/15 pt-5 lg:mt-12">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#d8e8dc]">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Your account, your control</p>
                  <p className="mt-1 text-xs leading-5 text-[#c2d7c8]">Your owner credentials help protect access to your store.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="order-1 rounded-2xl border border-[#dce5dc] bg-white px-5 py-7 shadow-[0_18px_55px_rgba(29,54,42,0.06)] sm:px-8 sm:py-9 lg:order-2 lg:px-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#397957]">Create your store</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#263b30] sm:text-3xl">Set up your account</h1>
              <p className="mt-2 text-sm leading-6 text-[#66756b]">A few details are all you need to get started.</p>
            </div>

            <div className="mt-7">
              <div role="group" aria-label="Account setup progress" className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#21634a] text-[11px] font-semibold text-white">1</span>
                  <span className="text-xs font-semibold text-[#33463a]">Store details</span>
                </div>
                <span className="h-px flex-1 bg-[#dce5dc]" aria-hidden="true" />
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#cbd9ce] bg-white text-[11px] font-semibold text-[#66756b]">2</span>
                  <span className="text-xs font-medium text-[#66756b]">Owner account</span>
                </div>
              </div>
            </div>

            {statusLoading ? (
              <div role="status" aria-live="polite" className="mt-6 flex items-center gap-2.5 rounded-xl border border-[#dce5dc] bg-[#f7faf6] px-3.5 py-3 text-xs font-medium text-[#526258]">
                <Loader2 className="h-4 w-4 animate-spin text-[#21634a]" aria-hidden="true" />
                Checking device availability…
              </div>
            ) : (deviceStatus?.localAccountPresent || deviceStatus?.legacyBindingPresent) && deviceStatus.bound !== true ? (
              <div role="status" className="mt-6 flex items-start gap-2.5 rounded-xl border border-[#e4d8bd] bg-[#fbf7ed] px-3.5 py-3 text-xs leading-5 text-[#725727]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#94651b]" aria-hidden="true" />
                <div className="flex-1">
                  <p>
                    {deviceStatus.legacyBindingPresent
                      ? 'A legacy server account exists without a device ID. It does not block this browser from creating a store.'
                      : 'Local account data is saved in this browser. It is separate from a server-confirmed device binding.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowUnbindConfirm(true)}
                    className="mt-2 font-semibold text-[#725727] underline underline-offset-2 hover:text-[#553f18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#94651b] focus-visible:ring-offset-2"
                  >
                    {deviceStatus.legacyBindingPresent ? 'Verify owner and reset legacy setup' : 'Verify owner and clear local account data'}
                  </button>
                </div>
              </div>
            ) : deviceStatus?.bound === true ? (
              <div role="status" className="mt-6 flex items-center gap-2.5 rounded-xl border border-[#c6d9cc] bg-[#eaf2eb] px-3.5 py-3 text-xs font-medium text-[#285b45]">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Device status verified.
              </div>
            ) : null}

            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-[#dce5dc] bg-[#f7faf6] px-3.5 py-3 text-xs leading-5 text-[#526258] lg:hidden">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#21634a]" aria-hidden="true" />
              <p>Your owner credentials help protect access to your store.</p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="mt-7 space-y-5">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-[#33463a]">Business Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Kanegosyo Store"
                          data-testid="input-business-name"
                          className="h-11 rounded-xl border-[#d6dfd6] bg-white px-3.5 text-sm text-[#263b30] placeholder:text-[#89958b] focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-1"
                          autoComplete="organization"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="border-t border-[#edf1ed] pt-5">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#748278]">Owner account</p>
                  <div className="space-y-5">
                    <FormField
                      control={form.control}
                      name="ownerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-[#33463a]">Owner&apos;s Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Your full name"
                              data-testid="input-owner-name"
                              className="h-11 rounded-xl border-[#d6dfd6] bg-white px-3.5 text-sm text-[#263b30] placeholder:text-[#89958b] focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-1"
                              autoComplete="name"
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
                          <FormLabel className="text-sm font-medium text-[#33463a]">Mobile Number</FormLabel>
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder="+63 9XX XXX XXXX"
                              data-testid="input-mobile"
                              className="h-11 rounded-xl border-[#d6dfd6] bg-white px-3.5 text-sm text-[#263b30] placeholder:text-[#89958b] focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-1"
                              autoComplete="tel"
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
                          <FormLabel className="text-sm font-medium text-[#33463a]">Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Create a strong password"
                              data-testid="input-password"
                              className="h-11 rounded-xl border-[#d6dfd6] bg-white px-3.5 text-sm text-[#263b30] placeholder:text-[#89958b] focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-1"
                              autoComplete="new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || statusLoading || form.formState.isSubmitting || form.formState.isValidating || isLocked || !!statusError || unbindLoading || !!resetCleanupScope}
                  data-testid="button-create-account"
                  className="mt-1 h-12 w-full rounded-xl bg-[#21634a] text-sm font-semibold text-white shadow-[0_8px_18px_rgba(33,99,74,0.16)] transition-colors hover:bg-[#194d39] focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#a7b9ad] disabled:text-white"
                >
                  {isLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</>
                  ) : 'Create account'}
                </Button>
              </form>
            </Form>
            {(deviceStatus?.localAccountPresent || deviceStatus?.legacyBindingPresent) && deviceStatus.bound !== true && (
              <AlertDialog
                open={showUnbindConfirm}
                onOpenChange={(open) => {
                  setShowUnbindConfirm(open);
                  if (!open) setOwnerCredentials({ username: '', password: '' });
                }}
              >
                <AlertDialogContent className="rounded-2xl border-[#dce5dc] sm:max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-lg font-semibold text-[#263b30]">
                      {deviceStatus.legacyBindingPresent ? 'Verify legacy store owner' : 'Clear this browser’s saved account'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-sm leading-6 text-[#66756b]">
                      {deviceStatus.legacyBindingPresent
                        ? 'The legacy server marker has no browser identity. Owner verification is required before it can be cleared; this does not affect new device registration.'
                        : 'This only clears matching local browser data. It does not delete a cloud account or store data.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="local-reset-owner-username" className="text-sm font-medium text-[#33463a]">Owner username or sign-in ID</label>
                      <Input
                        id="local-reset-owner-username"
                        autoComplete="username"
                        value={ownerCredentials.username}
                        onChange={(event) => setOwnerCredentials(current => ({ ...current, username: event.target.value }))}
                        disabled={unbindLoading}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="local-reset-owner-password" className="text-sm font-medium text-[#33463a]">Current password</label>
                      <Input
                        id="local-reset-owner-password"
                        type="password"
                        autoComplete="current-password"
                        value={ownerCredentials.password}
                        onChange={(event) => setOwnerCredentials(current => ({ ...current, password: event.target.value }))}
                        disabled={unbindLoading}
                      />
                    </div>
                  </div>
                  <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
                    <AlertDialogCancel className="h-11 w-full rounded-xl border-[#dce5dc]" disabled={unbindLoading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(event) => { event.preventDefault(); handleConfirmUnbind(); }}
                      disabled={unbindLoading || !ownerCredentials.username.trim() || !ownerCredentials.password}
                      className="h-11 w-full rounded-xl bg-[#21634a] font-semibold text-white hover:bg-[#194d39]"
                    >
                      {unbindLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying owner…</> : <><Unlock className="mr-2 h-4 w-4" />Verify and reset</>}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <button
              type="button"
              onClick={() => setLocation('/role-selection')}
              data-testid="button-back"
              className="mt-5 inline-flex items-center rounded-lg text-xs font-medium text-[#748278] transition-colors hover:text-[#21634a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21634a] focus-visible:ring-offset-2"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Back to role selection
            </button>
          </section>
        </div>
      </div>
    </main>
  );
};

export default AdminSignup;
