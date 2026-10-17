import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Building2, Globe, User, Lock, Eye, EyeOff, Sparkles, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, Store, Unlock, Loader2, Smartphone, Mail, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthService } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

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

const RegisterTenant: React.FC = () => {
  const [formData, setFormData] = useState({
    storeName: '',
    subdomain: '',
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; tenantUrl?: string } | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);

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
      setDeviceStatus({
        ...response,
        identityVerified,
        localAccountPresent: response.localAccountPresent === true,
        tenant: identityVerified ? response.tenant : null,
        admin: identityVerified ? response.admin : null,
      });
    } catch (e) {
      console.warn('[register-tenant] Failed to check device status');
      setStatusError('Device binding could not be verified. Retry before registering a store.');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    checkDeviceStatus();
  }, [checkDeviceStatus]);

  const handleStoreNameChange = (val: string) => {
    const slug = val.toLowerCase().replace(/[^a-z0-9]/g, '');
    setFormData(prev => ({
      ...prev,
      storeName: val,
      subdomain: slug
    }));
  };

  const handleConfirmUnbind = async () => {
    setUnbindLoading(true);
    try {
      const res = await fetch('/api/tenants/unbind-device', { method: 'POST' });
      const d = await res.json();
      if (res.ok) {
        const clientPurge = d && d.clientPurge;
        if (clientPurge && Array.isArray(clientPurge.localStorageKeys) && typeof localStorage !== 'undefined') {
          clientPurge.localStorageKeys.forEach((k: string) => localStorage.removeItem(k));
        }
        if (clientPurge && clientPurge.purgeAllLocalStorage && typeof localStorage !== 'undefined') {
          Object.keys(localStorage).forEach((k: string) => localStorage.removeItem(k));
        }
        await AuthService.purgeLocalState({ skipApiCall: true });

        setFormData({ storeName: '', subdomain: '', username: '', password: '' });
        setResult(null);
        setShowUnbindConfirm(false);
        toast({
          title: 'Device Successfully Unbound',
          description: 'All local data erased. Device is ready for a new store.',
          duration: 5000,
        });
        await checkDeviceStatus();
        if (typeof window !== 'undefined') {
          setTimeout(() => window.location.reload(), 800);
        }
      } else {
        toast({
          title: 'Unbind Failed',
          description: d.error || 'Failed to unbind device.',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({
        title: 'Unbind Failed',
        description: 'Network error during device reset.',
        variant: 'destructive',
      });
    } finally {
      setUnbindLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (statusLoading || statusError || deviceStatus?.bound || deviceStatus?.localAccountPresent) return;
    setLoading(true);
    setResult(null);

    try {
      const originalTenantId = localStorage.getItem('smartpos_tenant');
      localStorage.setItem('smartpos_tenant', formData.subdomain);

      const response = await fetch('/api/tenants/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': formData.subdomain
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: 'Store registered successfully! Setting up workspace...',
          tenantUrl: '/admin-login'
        });

        setTimeout(() => {
          setLocation('/admin-login', { replace: true });
        }, 2000);
      } else {
        setResult({
          success: false,
          message: data.message || data.error || 'Registration failed. Please try again.'
        });

        if (originalTenantId) {
          localStorage.setItem('smartpos_tenant', originalTenantId);
        } else {
          localStorage.removeItem('smartpos_tenant');
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      setResult({
        success: false,
        message: 'An unexpected network error occurred during registration.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between relative overflow-hidden font-sans">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Top Navbar Header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg text-white tracking-wide">SmartPOS<span className="text-blue-400">Pro</span></span>
            <span className="block text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Enterprise Retail OS</span>
          </div>
        </div>
        <button
          onClick={() => setLocation('/admin-login')}
          className="text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 px-4 py-2 rounded-xl transition-all"
        >
          Sign In to Existing Store
        </button>
      </header>

      {/* Main Registration Card Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 z-10 w-full max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center w-full">
          
          {/* Left Brand Column */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-5 space-y-6 text-left hidden lg:block"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Multi-Device Cloud Architecture</span>
            </div>
            
            <h1 className="text-4xl font-extrabold text-white leading-tight tracking-tight">
              Create & Scale Your Retail Store Business
            </h1>
            
            <p className="text-slate-400 text-sm leading-relaxed">
              Power your Point-of-Sale terminal with isolated tenant security, cross-device staff remittance, and real-time Supabase cloud synchronization.
            </p>

            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">1-Device Security Lock</h4>
                  <p className="text-xs text-slate-400">Protects your local database from cross-tenant data leakage.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Cross-Device Staff Terminal</h4>
                  <p className="text-xs text-slate-400">Staff members can log in on any phone or tablet to process sales.</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Form Column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-7 w-full"
          >
            <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 p-8 sm:p-10 rounded-3xl shadow-2xl shadow-slate-950/80 relative">
              <div className="mb-6 text-center lg:text-left">
                <h2 className="text-2xl font-bold text-white tracking-tight">Register Store Tenant</h2>
                <p className="text-xs text-slate-400 mt-1">Fill in your business details to generate your isolated tenant database</p>
              </div>

              {result && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 mb-6 rounded-2xl border text-xs flex items-start gap-3 ${
                    result.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {result.success ? (
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
                  )}
                  <div className="leading-relaxed font-medium flex-1">
                    <div>{result.message}</div>
                    {!result.success && (
                      <button
                        type="button"
                        onClick={() => setShowUnbindConfirm(true)}
                        className="mt-2.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 transition-all flex items-center gap-2 shadow-sm"
                      >
                        <Unlock className="w-4 h-4 text-rose-400" />
                        <span>Reset & Unbind Device Now</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {statusError && (
                <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="flex-1 text-xs font-medium">
                    <p>{statusError}</p>
                    <Button type="button" variant="outline" onClick={checkDeviceStatus} className="mt-3 h-9 rounded-xl border-amber-500/40 text-amber-100">
                      Retry status check
                    </Button>
                  </div>
                </div>
              )}

              {!statusLoading && (deviceStatus?.bound || deviceStatus?.localAccountPresent) && (
                <AnimatePresence>
                  <motion.div
                    initial={{ opacity: 0, y: -10, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-6"
                  >
                    <Card className="border-2 border-amber-500/40 bg-amber-500/10 backdrop-blur-sm rounded-3xl shadow-xl overflow-hidden">
                      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 px-5 py-3.5">
                        <div className="flex items-center gap-3 text-white">
                          <div className="w-9 h-9 bg-white/25 backdrop-blur rounded-xl flex items-center justify-center border border-white/30">
                            <Lock className="w-4.5 h-4.5" />
                          </div>
                          <div className="text-left flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Badge variant="destructive" className="bg-white/25 border-0 text-white text-[9px] font-black uppercase tracking-widest rounded-full px-2.5 py-0.5">
                                {deviceStatus.bound ? 'Device Bound' : 'Local Account Found'}
                              </Badge>
                              <span className="text-[9px] font-bold text-white/80 uppercase tracking-widest">
                                {deviceStatus.identityVerified ? 'Identity verified' : 'Identity unavailable'}
                              </span>
                            </div>
                            <h3 className="text-sm font-black tracking-tight">
                              {deviceStatus.identityVerified
                                ? deviceStatus.tenant?.storeName || deviceStatus.admin?.businessName || 'Store name unavailable'
                                : 'Account identity unavailable'}
                            </h3>
                          </div>
                        </div>
                      </div>
                      <CardContent className="p-4 space-y-2.5">
                        {!deviceStatus.identityVerified && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] font-semibold leading-relaxed text-amber-200">
                            {deviceStatus.bound
                              ? 'The device binding exists, but the account could not be verified. Cached account details are hidden.'
                              : 'Local account data exists without an explicit binding. Sign in to restore the binding before setting up another store.'}
                            <Button type="button" variant="outline" onClick={checkDeviceStatus} className="mt-2 h-8 rounded-lg border-amber-500/40 text-[10px] text-amber-100">
                              Refresh status
                            </Button>
                          </div>
                        )}
                        {deviceStatus.identityVerified && deviceStatus.admin && (
                        <>
                        <div className="flex items-center gap-2.5 p-2.5 bg-slate-900/50 rounded-2xl border border-slate-700/60">
                          <div className="w-8 h-8 bg-blue-500/15 text-blue-400 rounded-lg flex items-center justify-center flex-shrink-0">
                            <UserIcon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Bound Account User</p>
                            <p className="text-xs font-bold text-white truncate">
                              {deviceStatus.admin?.ownerName || deviceStatus.admin?.username || 'Store Admin'}
                            </p>
                          </div>
                        </div>
                        {deviceStatus.admin?.mobile && (
                          <div className="flex items-center gap-2.5 p-2.5 bg-slate-900/50 rounded-2xl border border-slate-700/60">
                            <div className="w-8 h-8 bg-emerald-500/15 text-emerald-400 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Smartphone className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Contact</p>
                              <p className="text-xs font-bold text-white truncate">{deviceStatus.admin.mobile}</p>
                            </div>
                          </div>
                        )}
                        </>
                        )}
                        <p className="text-[10px] font-semibold text-amber-300/90 leading-relaxed pt-1">
                          This device is already registered. You must unbind & factory-reset before creating a new store account.
                        </p>
                        {deviceStatus.bound ? (
                          <Button
                            type="button"
                            onClick={() => setShowUnbindConfirm(true)}
                            variant="destructive"
                            className="w-full rounded-2xl h-11 font-black text-xs shadow-lg bg-rose-600 hover:bg-rose-700 border-0"
                          >
                            <Unlock className="w-4 h-4 mr-1.5" />
                            Unbind & Reset This Device
                          </Button>
                        ) : (
                          <p className="text-[10px] font-semibold text-amber-200">
                            Use “Sign In to Existing Store” to recover this account and establish its explicit device binding.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                </AnimatePresence>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Store Name Input */}
                <div className="space-y-1.5">
                  <label htmlFor="storeName" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Store / Business Name
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="storeName"
                      name="storeName"
                      type="text"
                      autoComplete="organization"
                      required
                      value={formData.storeName}
                      onChange={(e) => handleStoreNameChange(e.target.value)}
                      placeholder="e.g. Masing Bakery"
                      className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                    />
                  </div>
                </div>

                {/* Subdomain Input */}
                <div className="space-y-1.5">
                  <label htmlFor="subdomain" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Store Subdomain Slug
                  </label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="subdomain"
                      name="subdomain"
                      type="text"
                      autoComplete="off"
                      required
                      value={formData.subdomain}
                      onChange={(e) => setFormData({ ...formData, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') })}
                      placeholder="e.g. masingbakery"
                      className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 rounded-xl pl-10 pr-24 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-mono"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-1 rounded-md">
                      .smartpos
                    </span>
                  </div>
                </div>

                {/* Admin Username Input */}
                <div className="space-y-1.5">
                  <label htmlFor="username" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Admin Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value.trim() })}
                      placeholder="e.g. admin"
                      className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Enter a secure password"
                      className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 focus:outline-none transition-colors"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading || statusLoading || !!statusError || !!deviceStatus?.bound || !!deviceStatus?.localAccountPresent}
                  className="w-full bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2 group mt-2"
                >
                  {loading ? (
                    <span>Registering Store...</span>
                  ) : (
                    <>
                      <span>Register Store Workspace</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </motion.div>

        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-4 text-center text-xs text-slate-500 z-10 border-t border-slate-900">
        &copy; {new Date().getFullYear()} SmartPOS Enterprise. Isolated Tenant Multi-Store Operating System.
      </footer>

      <AlertDialog open={showUnbindConfirm} onOpenChange={setShowUnbindConfirm}>
        <AlertDialogContent className="rounded-[2rem] max-w-md border-0 shadow-2xl bg-white">
          <AlertDialogHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-rose-500" />
            </div>
            <AlertDialogTitle className="text-xl font-black tracking-tight text-gray-900">
              Factory Reset This Device?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-gray-500 leading-relaxed pt-1">
              This will completely erase the registered store and all data from this device.
              The device will be blank and ready for a new store account.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="px-1 py-3 space-y-2">
            {[
              'Delete all products, inventory & variants',
              'Clear entire sales history & receipts',
              'Remove staff accounts & remittances',
              'Wipe customers, credits, payments',
              'Erase all settings & device preferences',
              'Delete admin account & sessions'
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-xs text-gray-600 font-medium bg-rose-50 px-3 py-2 rounded-xl border border-rose-100">
                <X className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <AlertDialogFooter className="flex-col sm:flex-col gap-2 pt-2">
            <AlertDialogCancel className="w-full rounded-xl h-12 font-bold text-sm border-gray-200">
              Cancel — Keep Data
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmUnbind(); }}
              disabled={unbindLoading}
              className="w-full rounded-xl h-12 font-black text-sm bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-200"
            >
              {unbindLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Erasing Everything…
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4 mr-2" />
                  Yes — Reset & Unbind Device
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RegisterTenant;
