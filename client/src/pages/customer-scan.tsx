import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import Scanner from '@/components/Scanner';
import ProductImage from '@/components/ProductImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Moon, Sun, Keyboard, Camera, X, RefreshCw, Monitor, Lock, Unlock, ShieldAlert, CheckCircle, Package, Search, Sparkles, Tag, DollarSign, Store } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';
import io from 'socket.io-client';
import { ProductService, AuthService, db } from '@/lib/db';
import { 
  BrowserMultiFormatReader, 
  DecodeHintType, 
  BarcodeFormat 
} from '@zxing/library';
import api from '@/lib/api';
import { useDevices } from '@/contexts/DeviceContext';
import { cn } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  price: number;
  barcode: string | null;
  description?: string;
  imageUrl?: string;
  inStock: boolean;
  quantity?: number;
  category?: string;
}

const CustomerScan: React.FC = () => {
  const { deviceMode } = useDevices();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Kiosk Terminal Binding State
  const [boundTenantId, setBoundTenantId] = useState<string | null>(() => localStorage.getItem('customer_checker_tenant_id'));
  const [boundStoreName, setBoundStoreName] = useState<string>(() => localStorage.getItem('customer_checker_store_name') || 'SmartPOS+ Store');

  // Admin Setup / Unlock Modal State
  const [showSetupModal, setShowSetupModal] = useState<boolean>(!localStorage.getItem('customer_checker_tenant_id'));
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetAdminPassword, setResetAdminPassword] = useState('');

  // Scanner & Product State
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanning, setScanning] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);
  const [showProduct, setShowProduct] = useState(false);
  const [loading, setLoading] = useState(false);
  const [useLiveScanner, setUseLiveScanner] = useState(false);
  const [countdown, setCountdown] = useState<number>(8);

  const socketRef = useRef<any>(null);
  const scannerBufRef = useRef<string>('');
  const bufferTimerRef = useRef<any>(null);
  const countdownTimerRef = useRef<any>(null);

  // 1. Admin Store Setup / Binding Handler
  const handleAdminSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUsername.trim() || !adminPassword.trim()) {
      toast({ title: "Fields Required", description: "Please enter Admin username and password", variant: "destructive" });
      return;
    }
    setIsVerifyingAdmin(true);
    try {
      const res = await AuthService.loginAdmin(adminUsername.trim(), adminPassword.trim());

      if (res && res.user) {
        const tenantId = res.user.tenantId || (res.user as any).tenant_id || 'default-tenant-id';
        const storeName = res.user.businessName || res.user.ownerName || res.user.username || 'SmartPOS+ Store';

        localStorage.setItem('customer_checker_tenant_id', tenantId);
        localStorage.setItem('customer_checker_store_name', storeName);
        localStorage.setItem('smartpos_tenant', tenantId);

        setBoundTenantId(tenantId);
        setBoundStoreName(storeName);
        setShowSetupModal(false);
        setAdminUsername('');
        setAdminPassword('');

        toast({ title: "Kiosk Terminal Configured", description: `Successfully paired with ${storeName}!` });
      } else {
        toast({ title: "Setup Failed", description: "Invalid admin credentials", variant: "destructive" });
      }
    } catch (err: any) {
      console.error('Kiosk setup error:', err);
      toast({ title: "Setup Failed", description: err?.response?.data?.error || err?.message || "Invalid admin credentials", variant: "destructive" });
    } finally {
      setIsVerifyingAdmin(false);
    }
  };

  // 2. Admin Reset / Unbind Terminal Handler
  const handleResetTerminal = async () => {
    if (!resetAdminPassword.trim()) {
      toast({ title: "Password Required", description: "Enter admin password to authorize terminal reset", variant: "destructive" });
      return;
    }
    try {
      const admins = await db.users.where('role').equals('admin').toArray();
      let isValid = false;

      for (const adminUser of admins) {
        if (adminUser.username) {
          try {
            const response = await AuthService.loginAdmin(adminUser.username, resetAdminPassword.trim());
            if (response && response.user) {
              isValid = true;
              break;
            }
          } catch {}
        }
      }

      if (isValid) {
        localStorage.removeItem('customer_checker_tenant_id');
        localStorage.removeItem('customer_checker_store_name');
        setBoundTenantId(null);
        setBoundStoreName('SmartPOS+ Store');
        setShowResetConfirm(false);
        setResetAdminPassword('');
        setShowSetupModal(true);
        toast({ title: "Terminal Unbound", description: "Device reset. Please configure with an Admin account." });
      } else {
        toast({ title: "Authorization Failed", description: "Incorrect admin password", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Could not authorize reset", variant: "destructive" });
    }
  };

  // 3. Socket & Scanner Setup
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter') {
        const code = scannerBufRef.current.trim();
        if (code) {
          lookupProduct(code);
          scannerBufRef.current = '';
        }
        return;
      }
      if (e.key.length === 1) {
        scannerBufRef.current += e.key;
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = setTimeout(() => {
          const code = scannerBufRef.current.trim();
          if (code) lookupProduct(code);
          scannerBufRef.current = '';
        }, 150);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [boundTenantId]);

  // 4. Auto-Dismiss Countdown Timer for Product Modal
  useEffect(() => {
    if (showProduct) {
      setCountdown(8);
      countdownTimerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownTimerRef.current);
            setShowProduct(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    }
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [showProduct]);

  // 5. Look Up Product (Admin-Bound Catalog)
  const lookupProduct = async (barcode: string) => {
    if (!boundTenantId) {
      setShowSetupModal(true);
      return;
    }
    setLoading(true);
    try {
      let matchedData: any = null;

      // Try server API call with bound tenant ID
      try {
        const response = await api.get(`/api/products/barcode/${encodeURIComponent(barcode)}`);
        if (response) matchedData = response;
      } catch (err) {
        console.warn('API lookup failed, checking local Dexie DB for bound tenant:', err);
      }

      // Fallback to local Dexie search filtered by tenantId
      if (!matchedData) {
        const localProd = await ProductService.getProductByBarcode(barcode);
        if (localProd && (!localProd.tenantId || localProd.tenantId === boundTenantId)) {
          matchedData = localProd;
        }
      }

      if (matchedData) {
        setProduct({
          id: matchedData.id,
          name: matchedData.name,
          price: Number(matchedData.price || 0),
          barcode: matchedData.barcode ?? barcode,
          description: matchedData.description || '',
          imageUrl: matchedData.image || '',
          inStock: (matchedData.quantity ?? 0) > 0,
          quantity: matchedData.quantity ?? 0,
          category: matchedData.category || 'Store Inventory'
        });
        setShowProduct(true);
      } else {
        toast({
          title: "Product Not Found",
          description: `No product matching barcode "${barcode}" found in ${boundStoreName}.`,
          variant: "destructive"
        });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to look up product", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      lookupProduct(barcodeInput.trim());
      setBarcodeInput('');
    }
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    const url = URL.createObjectURL(file);
    setLoading(true);
    try {
      const result = await reader.decodeFromImageUrl(url);
      if (result) lookupProduct(result.getText());
      else toast({ title: "Scan Failed", description: "No clear barcode detected", variant: "destructive" });
    } catch (err) {
      toast({ title: "Scan Error", description: "Could not decode image barcode", variant: "destructive" });
    } finally {
      URL.revokeObjectURL(url);
      setLoading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden relative">
      {/* Background Glow Orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#BF953F]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Kiosk Top Header Bar */}
      <header className="px-6 py-4 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#BF953F] to-[#B38728] flex items-center justify-center shadow-lg shadow-[#BF953F]/20">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2 uppercase">
              {boundStoreName} <span className="text-[10px] font-bold text-[#BF953F] bg-[#BF953F]/10 px-2 py-0.5 rounded-full border border-[#BF953F]/20">Kiosk</span>
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Self-Service Price & Inventory Checker</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {boundTenantId ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700 flex items-center gap-1.5 text-xs font-bold"
              title="Admin Re-configure Kiosk"
            >
              <Lock className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Bound</span>
            </button>
          ) : (
            <button
              onClick={() => setShowSetupModal(true)}
              className="px-3 py-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5 animate-pulse"
            >
              <ShieldAlert className="w-4 h-4" /> Setup Required
            </button>
          )}
        </div>
      </header>

      {/* Main Kiosk Scanner Area */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-6 flex flex-col items-center justify-center z-10">
        <Card className="w-full bg-slate-900/80 border-slate-800 backdrop-blur-xl shadow-2xl rounded-[2.5rem] overflow-hidden p-8 text-center border">
          <CardHeader className="p-0 mb-6">
            <div className="w-16 h-16 rounded-3xl bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
              <Search className="w-8 h-8 text-blue-400" />
            </div>
            <CardTitle className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase">Price & Stock Checker</CardTitle>
            <CardDescription className="text-slate-400 text-xs font-medium mt-1">
              Scan barcode using attached scanner, camera, or enter barcode below
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 space-y-6">
            {/* External Scanner Kiosk Display Card */}
            <div className="w-full max-w-md aspect-video bg-gradient-to-b from-slate-950/80 to-slate-950/40 rounded-3xl border-2 border-dashed border-slate-800 flex flex-col items-center justify-center p-6 text-center mx-auto space-y-3 relative group hover:border-[#BF953F]/40 transition-all shadow-inner">
              <div className="w-16 h-16 bg-gradient-to-tr from-[#BF953F]/20 to-blue-500/20 rounded-3xl flex items-center justify-center border border-[#BF953F]/30 shadow-lg shadow-[#BF953F]/10 animate-pulse">
                <Monitor className="w-8 h-8 text-[#BF953F]" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase tracking-tight text-white">External Barcode Scanner Ready</h3>
                <p className="text-xs text-slate-400 font-medium mt-1">Scan any product item using the connected barcode scanner</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-extrabold uppercase tracking-widest mt-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> Kiosk Scanner Active
              </div>
            </div>

            {/* Manual Keypad Input */}
            <form onSubmit={handleManualSubmit} className="w-full max-w-md mx-auto flex gap-2">
              <Input
                placeholder="Enter or Scan Product Barcode..."
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                className="h-14 bg-slate-950 border-slate-800 rounded-2xl px-6 font-bold text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500/30"
              />
              <Button type="submit" disabled={loading || !barcodeInput.trim()} className="h-14 w-14 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30">
                <Keyboard className="w-6 h-6" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      {/* Pro Kiosk Product Price & Stock Modal */}
      <Dialog open={showProduct} onOpenChange={setShowProduct}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-100 rounded-[2.5rem] p-8 max-w-md z-[100] shadow-2xl">
          <DialogHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BF953F] bg-[#BF953F]/10 px-3 py-1 rounded-full border border-[#BF953F]/20">
                {product?.category || 'Inventory Product'}
              </span>
              <span className="text-[10px] font-bold text-slate-400">Auto-reset in {countdown}s</span>
            </div>
            <DialogTitle className="text-2xl font-black tracking-tight text-white uppercase">{product?.name}</DialogTitle>
          </DialogHeader>

          {product && (
            <div className="space-y-6 my-2">
              <ProductImage
                src={product.imageUrl}
                alt={product.name}
                className="w-full h-44 rounded-2xl border border-slate-800 bg-slate-950"
                imageClassName="max-h-full object-contain p-4"
                fallbackClassName="bg-slate-950 text-slate-500"
                iconClassName="w-12 h-12 text-slate-600"
              />

              {/* Big Price Display */}
              <div className="p-6 bg-gradient-to-br from-slate-950 to-slate-900 rounded-3xl border border-slate-800 flex justify-between items-center shadow-inner">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Item Retail Price</span>
                  <span className="text-4xl font-black text-emerald-400 tracking-tighter">
                    ₱{product.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-right">
                  <span className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-extrabold uppercase tracking-wider border block",
                    product.inStock ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                  )}>
                    {product.inStock ? `In Stock: ${product.quantity ?? 1}` : 'Out of Stock'}
                  </span>
                </div>
              </div>

              {product.description && (
                <p className="text-slate-400 text-xs leading-relaxed text-center px-2">{product.description}</p>
              )}
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button onClick={() => setShowProduct(false)} className="w-full h-14 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs">
              Scan Next Item ({countdown}s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Setup Dialog (Non-dismissible when unbound) */}
      <Dialog open={showSetupModal} onOpenChange={(open) => { if (boundTenantId) setShowSetupModal(open); }}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-100 rounded-[2.5rem] p-8 max-w-md z-[110]">
          <DialogHeader className="space-y-3">
            <div className="w-14 h-14 bg-[#BF953F]/10 rounded-2xl flex items-center justify-center border border-[#BF953F]/20 mx-auto mb-2">
              <Lock className="w-7 h-7 text-[#BF953F]" />
            </div>
            <DialogTitle className="text-2xl font-black text-center tracking-tight text-white uppercase">Configure Kiosk Terminal</DialogTitle>
            <DialogDescription className="text-slate-400 text-center text-xs">
              Enter Admin store credentials to lock this Price Checker terminal to your store's inventory catalog.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdminSetupSubmit} className="space-y-4 my-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Admin Username</label>
              <Input
                value={adminUsername}
                onChange={e => setAdminUsername(e.target.value)}
                placeholder="Enter Admin Username"
                className="h-12 bg-slate-950 border-slate-800 rounded-2xl font-bold text-sm text-white px-4"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Admin Password</label>
              <Input
                type="password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                placeholder="Enter Admin Password"
                className="h-12 bg-slate-950 border-slate-800 rounded-2xl font-bold text-sm text-white px-4"
              />
            </div>

            <Button type="submit" disabled={isVerifyingAdmin} className="w-full h-14 bg-gradient-to-r from-[#BF953F] to-[#B38728] text-white rounded-2xl font-black uppercase tracking-widest text-xs mt-4 shadow-lg shadow-[#BF953F]/20">
              {isVerifyingAdmin ? 'Verifying...' : 'Pair & Lock Kiosk'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Admin Reset Terminal Dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent className="bg-slate-900 border border-slate-800 text-slate-100 rounded-[2.5rem] p-8 max-w-md z-[120]">
          <AlertDialogHeader className="space-y-3">
            <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20 mx-auto">
              <Unlock className="w-6 h-6 text-rose-400" />
            </div>
            <AlertDialogTitle className="text-xl font-black text-center text-white uppercase">Reset Kiosk Terminal</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-center text-xs">
              Enter Admin password to unbind this price checker terminal from {boundStoreName}.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-2 space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Admin Password</label>
            <Input
              type="password"
              value={resetAdminPassword}
              onChange={e => setResetAdminPassword(e.target.value)}
              placeholder="Enter Admin Password"
              className="h-12 bg-slate-950 border-slate-800 rounded-2xl font-bold text-sm text-white px-4"
            />
          </div>

          <AlertDialogFooter className="mt-4 flex gap-3">
            <AlertDialogCancel onClick={() => setShowResetConfirm(false)} className="flex-1 bg-slate-800 text-slate-300 border-slate-700 rounded-xl text-xs font-bold py-2.5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleResetTerminal} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold py-2.5">
              Unbind Terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CustomerScan;
