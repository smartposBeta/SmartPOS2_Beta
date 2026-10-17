import React, { useState, useEffect, useRef } from 'react';
import { motion, useDragControls, PanInfo, AnimatePresence } from 'framer-motion';
import { Home, Trash2, CreditCard, AlertTriangle, LogOut, Search, ArrowLeft, Edit, Usb, Bluetooth, Send, ShoppingCart, AlertCircle, Package, X, ChevronUp, ChevronDown, Plus, User, Cpu, RefreshCw, DollarSign, Info } from 'lucide-react';
import { useLocation } from 'wouter';
import Layout from '@/components/Layout';
import ProductImage from '@/components/ProductImage';
import Scanner from '@/components/Scanner';
import ExternalDeviceManager from '@/components/ExternalDeviceManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useApp } from '@/contexts/AppContext';
import { useDevices } from '@/contexts/DeviceContext';
import { useToast } from '@/hooks/use-toast';
import { ProductService, SalesService, AuthService, db, CreditorService, NonInventoryProductService, RemittanceService } from '@/lib/db';
import { databaseSyncService } from '@/lib/sync';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import type { Product, Variant, Sale, CartItem } from '@shared/schema';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

// UI-specific product type that combines inventory and non-inventory properties
interface UIProduct extends Omit<Product, 'createdAt' | 'updatedAt' | 'boxBarcode' | 'unitsPerBox' | 'boxCost'> {
  boxBarcode?: string | null;
  unitsPerBox?: number | null;
  boxCost?: number | null;
  isNonInventory?: boolean;
  inStock?: boolean;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

const ScannerSales: React.FC = () => {
  const [, setLocation] = useLocation();
  const { user, isAdmin, isStaff, logout, socket } = useAuth();
  const { cart, addToCart, removeFromCart, updateCartItem, clearCart, getCartTotal } = useApp();
  const { deviceMode, connectedDevices, printToThermalPrinter } = useDevices();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(!navigator.onLine);
  
  const [mode, setMode] = useState<'scanner' | 'manual'>('scanner');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState<'pieces' | 'dozen' | 'carton'>('pieces');
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentType, setPaymentType] = useState<'cash' | 'ewallet' | 'credits'>('cash');
  const [paymentError, setPaymentError] = useState(false);
  const [isCreditorDialogOpen, setIsCreditorDialogOpen] = useState(false);
  const [creditors, setCreditors] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCreditor, setSelectedCreditor] = useState<{ id: string; name: string } | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [isValidatingAdmin, setIsValidatingAdmin] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isCartCollapsed, setIsCartCollapsed] = useState(false);
  const [cartWidth, setCartWidth] = useState(400);
  const [cartHeight, setCartHeight] = useState(() =>
    typeof window === 'undefined' ? 520 : Math.round(window.innerHeight * 0.65)
  );
  
  // Non-Inventory State
  const [isNonInventoryOpen, setIsNonInventoryOpen] = useState(false);
  const [nonInvName, setNonInvName] = useState("");
  const [nonInvPrice, setNonInvPrice] = useState("");
  const [nonInvQty, setNonInvQty] = useState("1");
  const [nonInvUnit, setNonInvUnit] = useState<'pieces' | 'kilo' | 'gram' | 'liter'>("pieces");
  
  // Inline Creditor State
  const [isAddCreditorOpen, setIsAddCreditorOpen] = useState(false);
  const [newCreditorName, setNewCreditorName] = useState('');
  const [newCreditorPhone, setNewCreditorPhone] = useState('');
  const [newCreditorAddress, setNewCreditorAddress] = useState('');
  const [isSavingCreditor, setIsSavingCreditor] = useState(false);

  const loadCreditors = async () => {
    try {
      const list = await CreditorService.getAllCreditors();
      setCreditors(list.map(c => ({ id: c.id, name: c.name })));
    } catch (e) {
      console.warn('Failed to load creditors:', e);
    }
  };

  const handleCreateCreditorInline = async () => {
    if (!newCreditorName.trim()) {
      toast({ title: "Name Required", description: "Please enter creditor name", variant: "destructive" });
      return;
    }
    setIsSavingCreditor(true);
    try {
      const newCreditor = await CreditorService.addCreditor({
        tenantId: user?.tenantId || '',
        name: newCreditorName.trim(),
        phone: newCreditorPhone.trim() || undefined,
        address: newCreditorAddress.trim() || undefined,
        amount: 0,
        description: '',
        dueDate: new Date().toISOString(),
        reminderDate: new Date().toISOString(),
        isPaid: false
      } as any);
      toast({ title: "Creditor Profile Created", description: `Added ${newCreditorName} to creditors list` });
      setCreditors(prev => [...prev, { id: newCreditor.id, name: newCreditor.name }]);
      setSelectedCreditor({ id: newCreditor.id, name: newCreditor.name });
      setIsAddCreditorOpen(false);
      setNewCreditorName('');
      setNewCreditorPhone('');
      setNewCreditorAddress('');
    } catch (err) {
      toast({ title: "Error", description: "Failed to add creditor", variant: "destructive" });
    } finally {
      setIsSavingCreditor(false);
    }
  };

  const handleDeleteItem = async (productId: string) => {
    removeFromCart(productId);
  };

  const handleConfirmDeleteWithAdmin = async () => {
    if (!deleteItemId) return;
    if (!adminPassword.trim()) {
      toast({ title: 'Password Required', description: 'Please enter admin password to authorize item deletion', variant: 'destructive' });
      return;
    }

    setIsValidatingAdmin(true);
    try {
      const admins = await db.users.where('role').equals('admin').toArray();
      let isValid = false;

      for (const adminUser of admins) {
        if (adminUser.username) {
          try {
            const response = await AuthService.loginAdmin(adminUser.username, adminPassword.trim());
            if (response && response.user) {
              isValid = true;
              break;
            }
          } catch (e) {
            // Ignore single attempt failure
          }
        }
      }

      if (!isValid && user && user.role === 'admin' && user.username) {
        try {
          const response = await AuthService.loginAdmin(user.username, adminPassword.trim());
          if (response && response.user) {
            isValid = true;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (isValid) {
        removeFromCart(deleteItemId);
        toast({ title: 'Item Removed', description: 'Product removed from cart with admin authorization.' });
        setDeleteItemId(null);
        setAdminPassword('');
      } else {
        toast({ title: 'Authorization Failed', description: 'Invalid admin password.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Admin validation error:', error);
      toast({ title: 'Error', description: 'Failed to validate admin credentials.', variant: 'destructive' });
    } finally {
      setIsValidatingAdmin(false);
    }
  };  
  
  // Manual Mode State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [products, setProducts] = useState<UIProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<UIProduct[]>([]);
  const [isVariantSelectionOpen, setIsVariantSelectionOpen] = useState(false);
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<UIProduct | null>(null);
  const [productVariants, setProductVariants] = useState<Variant[]>([]);

  // Pop-up state for quantity input
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<any>(null);
  const [tempQuantity, setTempQuantity] = useState<number | ''>(1);
  const [tempUnit, setTempUnit] = useState<'pieces' | 'dozen' | 'carton'>('pieces');

  // Pay Modal State
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [editQuantityStr, setEditQuantityStr] = useState('');

  // Remittance State
  const [isRemitDialogOpen, setIsRemitDialogOpen] = useState(false);
  const [remitAmount, setRemitAmount] = useState(0);
  const [remitTxCount, setRemitTxCount] = useState(0);
  const [remitTransactions, setRemitTransactions] = useState<Sale[]>([]);
  const [isRemitting, setIsRemitting] = useState(false);
  const [todaysTotal, setTodaysTotal] = useState(0);
  const [showHardwareSetup, setShowHardwareSetup] = useState(false);

  const [scannerSettings, setScannerSettings] = useState<{ enabled: boolean; timeout: number }>({
    enabled: true,
    timeout: 150
  });

  const [receiptSettings, setReceiptSettings] = useState<{
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
  }>({
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
  });

  const scannerBufRef = useRef<string>('');
  const bufferTimerRef = useRef<any>(null);

  const loadSettings = async () => {
    try {
      const data = await api.get('/api/settings');
      if (data.externalScanner) {
        setScannerSettings({
          enabled: data.externalScanner.enabled !== false,
          timeout: data.externalScanner.timeout || 150
        });
      }
      if (data.receipt) {
        setReceiptSettings(prev => ({ ...prev, ...data.receipt }));
      }
    } catch (err) {
      console.error('Failed to load settings', err);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    // Reload settings when hardware setup dialog closes
    if (!showHardwareSetup) {
      loadSettings();
    }
  }, [showHardwareSetup]);

  useEffect(() => {
    if (deviceMode === 'pc') {
      setMode('manual');
    }
  }, [deviceMode]);

  const handleAddNonInventory = () => {
    if (!nonInvName || !nonInvPrice) return;
    const price = parseFloat(nonInvPrice);
    const qty = parseFloat(nonInvQty) || 1;
    if (isNaN(price) || price <= 0) return;

    const formattedUnit = nonInvUnit === 'kilo' ? 'KILO' : (nonInvUnit === 'gram' ? 'GRAM' : (nonInvUnit === 'liter' ? 'LITER' : 'pieces'));
    const isWeight = nonInvUnit === 'kilo' || nonInvUnit === 'gram' || nonInvUnit === 'liter';

    const newItem: CartItem = {
      productId: 'NON_INVENTORY_' + Math.random().toString(36).substr(2, 9),
      name: nonInvName + (isWeight ? ` (${qty} ${formattedUnit})` : ''),
      price: price,
      quantity: isWeight ? 1 : qty,
      unit: formattedUnit as any,
      subtotal: price * (isWeight ? 1 : qty),
      isNonInventory: true
    };
    
    addToCart(newItem);
    
    setNonInvName("");
    setNonInvPrice("");
    setNonInvQty("1");
    setNonInvUnit("pieces");
    setIsNonInventoryOpen(false);
  };

  const handleRemitClick = async () => {
    try {
      const tenantId = user?.tenantId || (user as any)?.tenant_id || 'default-tenant-id';
      try {
        await databaseSyncService.pullAllFromServerIntoDexie(tenantId);
      } catch (syncErr) {
        console.warn('Pre-remit sync warning:', syncErr);
      }
      const allSales = await SalesService.getAllSales();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Filter sales made by this staff today that haven't been remitted
      const staffSales = allSales.filter((s: Sale) => {
        const saleDate = s.createdAt ? new Date(s.createdAt) : new Date();
        const isToday = saleDate >= today;
        const isUser = s.staffId === user?.id || s.staffId === user?.staffId;
        const isNotRemitted = !s.remitted;
        return isUser && isToday && isNotRemitted;
      });

      const totalAmount = staffSales.reduce((sum: number, s: Sale) => sum + s.total, 0);
      setRemitAmount(totalAmount);
      setRemitTxCount(staffSales.length);
      setRemitTransactions(staffSales);
      setIsRemitDialogOpen(true);
    } catch (err) {
      console.error('Failed to calculate remittance', err);
      toast({
        title: "Error",
        description: "Failed to calculate daily total",
        variant: "destructive"
      });
    }
  };

  const syncRemittedSales = async () => {
    if (!user) return;
    try {
      // Check both ID types
      const userId = user.id || user.staffId;
      const res = await api.get<Array<{ id: string }>>(`/api/sales/remitted/${userId}`);
      if (res && Array.isArray(res)) {
        const remittedIds = res.map(s => s.id);
        if (remittedIds.length > 0) {
          const localSales = await SalesService.getAllSales();
          const toUpdate = localSales.filter(s => remittedIds.includes(s.id) && !s.remitted);
          
          if (toUpdate.length > 0) {
            for (const s of toUpdate) {
              await db.sales.update(s.id, { remitted: true });
            }
            loadTodaysTotal();
          }
        }
      }
    } catch (err) {
      console.warn('Failed to sync remitted sales status', err);
    }
  };

  const loadTodaysTotal = async () => {
    try {
      const allSales = await SalesService.getAllSales();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const total = allSales
        .filter((s: Sale) => {
          const saleDate = s.createdAt ? new Date(s.createdAt) : new Date();
          const isUser = s.staffId === user?.id || s.staffId === user?.staffId;
          const isNotRemitted = !s.remitted;
          return isUser && saleDate >= today && isNotRemitted;
        })
        .reduce((sum: number, s: Sale) => sum + s.total, 0);
      
      setTodaysTotal(total);
    } catch (err) {
      console.warn('Failed to load today\'s total', err);
    }
  };

  useEffect(() => {
    if (user) {
      loadTodaysTotal();
      syncRemittedSales();
    }
  }, [user, cart]); // Reload when user changes or cart is cleared (after sale)

  useEffect(() => {
    if (socket && user) {
      const handleRemittanceConfirmed = (data: any) => {
        // Check both ID formats for compatibility
        const isTargetStaff = data.staff_id === user.id || data.staff_id === user.staffId || 
                             data.staffId === user.id || data.staffId === user.staffId;
        
        if (isTargetStaff) {
          toast({
            title: "Remittance Confirmed",
            description: "Admin has confirmed your remittance. Your daily total has been reset.",
          });
          syncRemittedSales();
        }
      };

      socket.on('remittance-confirmed', handleRemittanceConfirmed);
      return () => {
        socket.off('remittance-confirmed', handleRemittanceConfirmed);
      };
    }
  }, [socket, user]);

  useEffect(() => {
    if (mode === 'manual') {
      loadProducts();
    }
  }, [mode]);

  const loadProducts = async () => {
    try {
      // Load both inventory and non-inventory products
      const [allInventory, allNonInventory] = await Promise.all([
        ProductService.getAllProducts(),
        NonInventoryProductService.getAllNonInventoryProducts()
      ]);

      const adaptedInventory = (allInventory as unknown as Product[]).map(p => ({ 
        ...p, 
        isNonInventory: false, 
        inStock: (p.quantity ?? 0) > 0 
      }));
      const adaptedNonInventory: UIProduct[] = (allNonInventory as unknown as any[]).map(p => ({
        id: p.id,
        tenantId: p.tenantId || p.tenant_id || '',
        name: p.name,
        barcode: (p.barcode ?? null) as string | null,
        price: p.price,
        quantity: 999999,
        category: p.category || 'Non-Inventory',
        image: p.image,
        isNonInventory: true,
        inStock: true, // Non-inventory items are always "in stock"
        createdAt: p.createdAt || new Date().toISOString(), 
        cost: null,
        description: p.description || null,
        updatedAt: p.updatedAt || new Date().toISOString(),
      }));

      const combined: UIProduct[] = [...adaptedInventory, ...adaptedNonInventory];
      setProducts(combined);
      const cats = Array.from(new Set(combined.map(p => p.category || 'Uncategorized')));
      setCategories(['all', ...cats]);
      return combined;
    } catch (error) {
      console.error('Failed to load products', error);
      return [];
    }
  };

  const [isFetching, setIsFetching] = useState(false);

  const handleFetchData = async () => {
    setIsFetching(true);
    try {
      const tenantId = user?.tenantId || (user as any)?.tenant_id || 'default-tenant-id';
      toast({ title: 'Syncing Catalog...', description: 'Fetching products and credentials from cloud' });
      await databaseSyncService.pullAllFromServerIntoDexie(tenantId);
      await loadProducts();
      toast({ title: 'Catalog Synced', description: 'All products and inventory successfully updated' });
    } catch (err: any) {
      console.error('Fetch error:', err);
      toast({ title: 'Fetch Failed', description: err?.message || 'Could not fetch catalog from cloud', variant: 'destructive' });
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    const tenantId = user?.tenantId || (user as any)?.tenant_id || localStorage.getItem('smartpos_tenant') || localStorage.getItem('smartpos_tenant_id') || '';
    if (tenantId) {
      localStorage.setItem('smartpos_tenant', tenantId);
      localStorage.setItem('smartpos_tenant_id', tenantId);
    }
    loadProducts().then(async (prods) => {
      if (!prods || prods.length === 0) {
        await handleFetchData();
      }
    });
  }, [user]);

  useEffect(() => {
    let result = products;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(lower) || (p.barcode && p.barcode.includes(searchTerm)));
    }
    if (selectedCategory !== 'all') {
      result = result.filter(p => (p.category || 'Uncategorized') === selectedCategory);
    }
    setFilteredProducts(result);
  }, [searchTerm, selectedCategory, products]);

  // Handle product click in manual mode
  const handleProductClick = async (product: UIProduct) => {
    try {
      if (product.isNonInventory) {
        setScannedProduct(product);
        setTempQuantity(1);
        setTempUnit('pieces');
        setShowQuantityDialog(true);
        return;
      }

      const variants = (await ProductService.getVariants(product.id)) as Variant[];
      if (variants && variants.length > 0) {
        setSelectedProductForVariant(product);
        setProductVariants(variants);
        setIsVariantSelectionOpen(true);
      } else {
        setScannedProduct(product);
        setTempQuantity(1);
        setTempUnit('pieces');
        setShowQuantityDialog(true);
      }
    } catch (e) {
      console.error("Error fetching variants", e);
      // Fallback to simple add if variant fetch fails
      setScannedProduct(product);
      setTempQuantity(1);
      setTempUnit('pieces');
      setShowQuantityDialog(true);
    }
  };

  const handleVariantSelect = (variant: Variant) => {
    setIsVariantSelectionOpen(false);
    
    // Create a product-like object for the cart
    const variantProduct: UIProduct = {
      id: variant.id, 
      tenantId: (variant as any).tenantId || (variant as any).tenant_id || '',
      name: `${selectedProductForVariant?.name} (${variant.name})`,
      price: variant.price,
      quantity: variant.quantity ?? 0,
      barcode: (variant.barcode as string | null) ?? null,
      cost: variant.cost,
      category: selectedProductForVariant?.category ?? null,
      image: variant.image ?? null,
      description: selectedProductForVariant?.description ?? null,
      isNonInventory: false,
      inStock: (variant.quantity ?? 0) > 0,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt
    };
    
    setScannedProduct(variantProduct);
    setTempQuantity(1);
    setTempUnit('pieces');
    setShowQuantityDialog(true);
  };

  const handleSelectBaseProduct = (product: UIProduct) => {
    setIsVariantSelectionOpen(false);
    setScannedProduct(product);
    setTempQuantity(1);
    setTempUnit('pieces');
    setShowQuantityDialog(true);
  };

  useEffect(() => {
    if (!scannerSettings.enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Enter') {
        const code = scannerBufRef.current.trim();
        if (code) {
          handleBarcodeScan(code);
          scannerBufRef.current = '';
        }
        return;
      }
      if (e.key.length === 1) {
        scannerBufRef.current += e.key;
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = setTimeout(() => {
          const code = scannerBufRef.current.trim();
          if (code) handleBarcodeScan(code);
          scannerBufRef.current = '';
        }, scannerSettings.timeout);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    };
  }, [scannerSettings]);

  const getUnitMultiplier = (unit: 'pieces' | 'dozen' | 'carton') => {
    switch (unit) {
      case 'dozen': return 12;
      case 'carton': return 24;
      case 'pieces': return 1;
    }
  };

  const handleBarcodeScan = async (barcode: string) => {
    try {
      setManualBarcode(barcode);
      if (!barcode || barcode.trim().length === 0) {
        toast({ title: 'Invalid Barcode', description: 'Scanned barcode is empty or invalid', variant: 'destructive' });
        return;
      }

      let product: UIProduct | undefined = (await ProductService.getProductByBarcode(barcode.trim())) as UIProduct | undefined;
      let isNonInventory = false;
      
      if (!product) {
        const niProduct = await NonInventoryProductService.getNonInventoryProductByBarcode(barcode.trim());
        if (niProduct) {
          product = {
            id: niProduct.id,
            tenantId: (niProduct as any).tenantId || (niProduct as any).tenant_id || '',
            name: niProduct.name,
            barcode: (niProduct.barcode as string | null) ?? null,
            price: niProduct.price,
            quantity: 999999,
            category: niProduct.category || null,
            image: niProduct.image,
            createdAt: niProduct.createdAt ? new Date(niProduct.createdAt) : new Date(),
            updatedAt: niProduct.updatedAt ? new Date(niProduct.updatedAt) : new Date(),
            cost: null,
            description: niProduct.description || null,
          };
          isNonInventory = true;
        }
      }
      
      if (!product) {
        toast({ title: 'Product Not Found', description: `No product found with barcode: ${barcode}`, variant: 'destructive' });
        return;
      }

      setScannedProduct({ ...product, isNonInventory });
      setTempQuantity(1);
      setTempUnit('pieces');
      setShowQuantityDialog(true);
    } catch (error) {
      console.error('Error processing barcode scan:', error);
      toast({ title: 'Scan Error', description: 'Failed to process barcode scan', variant: 'destructive' });
    }
  };

  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);

  const handleCancelQuantity = () => {
    setShowQuantityDialog(false);
    setScannedProduct(null);
    setEditingCartItem(null);
  };

  const handleEditItem = (item: CartItem) => {
    const matchedProduct = products.find(p => p.id === item.productId) || ({
      id: item.productId,
      name: item.name,
      price: item.price,
      quantity: 999999,
      isNonInventory: item.isNonInventory
    } as UIProduct);

    setEditingCartItem(item);
    setScannedProduct(matchedProduct);
    setTempQuantity(item.quantity);
    setTempUnit(item.unit);
    setShowQuantityDialog(true);
  };

  const handleConfirmQuantity = () => {
    if (!scannedProduct) return;
    const currentTempQuantity = tempQuantity === '' ? 1 : tempQuantity;
    if (currentTempQuantity < 1) {
      toast({ title: 'Invalid Quantity', description: 'Quantity must be at least 1', variant: 'destructive' });
      return;
    }

    const unitMultiplier = getUnitMultiplier(tempUnit);
    const actualQuantity = currentTempQuantity * unitMultiplier;

    if (!scannedProduct.isNonInventory) {
      if (scannedProduct.quantity < actualQuantity) {
        toast({ title: 'Insufficient Stock', description: `Only ${scannedProduct.quantity} pieces available`, variant: 'destructive' });
        return;
      }
      if (!editingCartItem) {
        const existingCartItem = cart.find(item => item.productId === scannedProduct.id);
        const currentCartQuantity = existingCartItem ? existingCartItem.quantity : 0;
        if (currentCartQuantity + actualQuantity > scannedProduct.quantity) {
          toast({ title: 'Insufficient Stock', description: `Cannot add ${actualQuantity} more. Only ${scannedProduct.quantity - currentCartQuantity} pieces available`, variant: 'destructive' });
          return;
        }
      }
    }

    if (editingCartItem) {
      updateCartItem(scannedProduct.id, currentTempQuantity);
      toast({ title: 'Item Updated', description: `${scannedProduct.name} updated to ${currentTempQuantity} ${tempUnit}` });
      setEditingCartItem(null);
      setShowQuantityDialog(false);
      setScannedProduct(null);
      return;
    }

    const cartItem: CartItem = {
      productId: scannedProduct.id,
      name: scannedProduct.name,
      price: scannedProduct.price,
      quantity: currentTempQuantity,
      unit: tempUnit,
      subtotal: Math.round(scannedProduct.price * actualQuantity * 100) / 100,
      isNonInventory: !!scannedProduct.isNonInventory
    };

    addToCart(cartItem);
    toast({ title: 'Product Added', description: `${scannedProduct.name} (${currentTempQuantity} ${tempUnit}) added to cart` });
    setShowQuantityDialog(false);
    setScannedProduct(null);
  };

  const handlePayClick = () => {
    if (cart.length === 0) {
      toast({ title: 'Empty Cart', description: 'Add products to cart before processing sale', variant: 'destructive' });
      return;
    }
    setIsPayModalOpen(true);
  };

  const saveEditedQuantity = () => {
    if (!editingItem) return;
    const qty = parseInt(editQuantityStr);
    if (isNaN(qty) || qty < 1) {
       toast({ title: 'Invalid Quantity', description: 'Quantity must be at least 1', variant: 'destructive' });
       return;
    }
    updateCartItem(editingItem.productId, qty);
    setEditingItem(null);
  };

  const processingRef = useRef(false);

  const handleProcessSale = async () => {
    if (processingRef.current || isProcessing) return;
    if (cart.length === 0) return;

    processingRef.current = true;
    setIsProcessing(true);

    try {
      // Load latest receipt settings before printing
      await loadSettings();
      
      const total = getCartTotal();
      const effectivePaymentAmount = paymentType === 'cash' ? (paymentAmount ?? 0) : paymentType === 'ewallet' ? total : 0;

      if (paymentType === 'cash' && paymentAmount === null) {
        setPaymentError(true);
        toast({ title: 'Payment Required', description: 'Please input the Total Amount', variant: 'destructive' });
        return;
      }
      if (paymentType === 'cash' && effectivePaymentAmount < total) {
        toast({ title: 'Insufficient Payment', description: `Payment amount must be at least ₱${total.toFixed(2)}`, variant: 'destructive' });
        return;
      }
      if (paymentType === 'credits' && !selectedCreditor) {
        toast({ title: 'Select Creditor', description: 'Please select a creditor for credit (utang) payment', variant: 'destructive' });
        setIsCreditorDialogOpen(true);
        return;
      }

      const sale = await SalesService.processSale({
        items: cart,
        total,
        paymentType,
        paymentAmount: effectivePaymentAmount,
        staffId: user?.id || undefined,
      });
      if (paymentType === 'credits' && selectedCreditor) {
        await CreditorService.applyCredit(selectedCreditor.id, cart, total);
      }

      const change = paymentType === 'cash' && effectivePaymentAmount > total ? effectivePaymentAmount - total : 0;
      if (paymentType !== 'credits') {
        const receiptItems = cart.map(item => {
          const safePrice = Number(item.price) || 0;
          const safeSubtotal = Number(item.subtotal) || 0;
          return `${item.name}\n${item.quantity} ${item.unit} x ₱${safePrice.toFixed(2)}   ₱${safeSubtotal.toFixed(2)}`;
        }).join('\n');
        let receiptContent = `${receiptSettings.storeName || 'SMARTPOS+ STORE'}\n`;
        if (receiptSettings.storeAddress) receiptContent += `${receiptSettings.storeAddress}\n`;
        if (receiptSettings.storePhone) receiptContent += `${receiptSettings.storePhone}\n`;
        if (receiptSettings.headerNote) receiptContent += `${receiptSettings.headerNote}\n`;
        if (receiptSettings.showDateTime) receiptContent += `${new Date(sale?.createdAt || new Date()).toLocaleString()}\n`;
        if (receiptSettings.showStaffName && user) receiptContent += `Staff: ${user.username || user.ownerName || 'Staff'}\n`;
        
        receiptContent += `--------------------------------\n`;
        receiptContent += `${receiptItems}\n`;
        receiptContent += `--------------------------------\n`;
        receiptContent += `TOTAL                 ₱${total.toFixed(2)}\n`;
        receiptContent += `${paymentType.toUpperCase().padEnd(9)}        ₱${effectivePaymentAmount.toFixed(2)}\n`;
        if (paymentType === 'cash') receiptContent += `CHANGE                ₱${change.toFixed(2)}\n`;
        receiptContent += `--------------------------------\n`;
        receiptContent += `${receiptSettings.footerNote || 'Thank you for your purchase!'}\n`;
        
        const printer = connectedDevices.find(d => d.type === 'printer');
        if (printer) {
          try { await printToThermalPrinter(receiptContent); } catch (e) { console.error('Printing failed:', e); }
        }
      }

      toast({ title: 'Sale Completed', description: paymentType === 'credits' ? `Credits applied to ${selectedCreditor?.name}` : `Sale processed successfully!` });
      clearCart();
      setPaymentAmount(0);
      setSelectedCreditor(null);
      setIsPayModalOpen(false);
    } catch (error) {
      toast({ title: 'Sale Failed', description: 'Failed to process sale', variant: 'destructive' });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const confirmRemit = async () => {
    if (!user) return;
    setIsRemitting(true);
    try {
      const res = await RemittanceService.remit({
        staffId: user.id,
        staffName: user.ownerName || user.username || 'Staff',
        amount: remitAmount,
        transactionCount: remitTxCount
      });
      if (res.success) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const localSales = await SalesService.getAllSales();
        const toMarkRemitted = localSales.filter(s => {
          const saleDate = s.createdAt ? new Date(s.createdAt) : new Date();
          return s.staffId === user.id && saleDate >= today && !s.remitted;
        });
        for (const s of toMarkRemitted) { await db.sales.update(s.id, { remitted: true }); }
        toast({ title: "Remittance Sent", description: `Successfully remitted ₱${remitAmount.toLocaleString()}.` });
        setTodaysTotal(0);
        setIsRemitDialogOpen(false);
      }
    } catch (err) {
      toast({ title: "Remittance Failed", description: "Connection error", variant: "destructive" });
    } finally {
      setIsRemitting(false);
    }
  };

  const isDesktop = deviceMode === 'pc' || deviceMode === 'tablet';
  const handleCartResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const initialWidth = cartWidth;
    const initialHeight = cartHeight;
    const resize = (moveEvent: PointerEvent) => {
      if (isDesktop) {
        const maxWidth = Math.max(320, window.innerWidth - 280);
        setCartWidth(Math.min(maxWidth, Math.max(320, initialWidth + startX - moveEvent.clientX)));
      } else {
        const maxHeight = Math.max(190, window.innerHeight - 100);
        setCartHeight(Math.min(maxHeight, Math.max(190, initialHeight + startY - moveEvent.clientY)));
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  return (
    <Layout showNavigation={false}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="h-screen overflow-hidden bg-background flex flex-col"
      >
        <div className={cn(
          "flex-1 min-h-0 flex",
          isDesktop ? "flex-row overflow-hidden h-full" : "flex-col relative"
        )}>
          {/* Main Area */}
          <div className={cn(
            "text-gray-800 p-4 flex flex-col min-h-0",
            isDesktop ? "flex-1 border-r border-gray-200 overflow-y-auto h-full" : "flex-1 pb-[80px]"
          )}>
            <div className="flex justify-between items-center mb-6 flex-none px-1">
              <div className="flex flex-col">
                <h2 className="text-xl font-black tracking-tighter uppercase text-slate-900">Sales Terminal</h2>
                <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-blue-500" />
                  <span>Logged Staff: <strong className="text-slate-900">{user?.ownerName || user?.username || user?.staffId || 'Staff Member'}</strong></span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className={cn("w-2 h-2 rounded-full animate-pulse", isOnline ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className={cn("text-[10px] font-black uppercase tracking-widest", isOnline ? "text-slate-400" : "text-rose-500 font-extrabold")}>
                    {isOnline ? 'Online' : 'Offline Mode (Local DB)'}
                  </span>
                  {isStaff && (
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-200 pl-2">
                      Rev: ₱{todaysTotal.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={isFetching}
                  onClick={handleFetchData}
                  className="h-11 px-3.5 rounded-2xl border-slate-200 shadow-sm bg-white hover:bg-slate-50 text-slate-700 active:scale-95 transition-all text-xs font-bold flex items-center gap-2"
                  title="Fetch latest products & data from cloud"
                >
                  <RefreshCw className={cn("w-4 h-4 text-emerald-600", isFetching && "animate-spin")} />
                  <span className="hidden sm:inline">Fetch Data</span>
                </Button>

                {isStaff ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-11 px-4 rounded-2xl border-slate-100 shadow-sm bg-white active:scale-95 transition-all">
                        <User className="w-5 h-5 text-slate-600 mr-2" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">MENU</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="bottom" align="end" className="w-56 bg-white border border-gray-100 shadow-2xl rounded-2xl p-2 z-[60]">
                      <DropdownMenuItem
                        onClick={() => {
                          if (!isOnline) {
                            toast({ title: "Remittance Disabled", description: "Remittance is disabled in offline mode until internet is restored.", variant: "destructive" });
                            return;
                          }
                          handleRemitClick();
                        }}
                        className={cn(
                          "h-12 px-4 rounded-xl text-sm font-semibold cursor-pointer flex items-center group",
                          !isOnline ? "opacity-60 text-slate-400 hover:bg-transparent" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                        )}
                      >
                        <Send className="w-4 h-4 mr-3 text-gray-400 group-hover:text-blue-500" />
                        <div className="flex flex-col">
                          <span>Remit Funds</span>
                          {!isOnline && <span className="text-[9px] text-rose-500 font-normal">Offline (Disabled)</span>}
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowHardwareSetup(true)}
                        className="h-12 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-orange-50 hover:text-orange-600 cursor-pointer flex items-center group"
                      >
                        <Cpu className="w-4 h-4 mr-3 text-gray-400 group-hover:text-orange-500" />
                        <span>Hardware Setup</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowLogoutConfirm(true)}
                        className="h-12 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-red-50 hover:text-red-600 cursor-pointer flex items-center group"
                      >
                        <LogOut className="w-4 h-4 mr-3 text-gray-400 group-hover:text-red-500" />
                        <span>Logout</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button variant="outline" className="h-11 w-11 p-0 rounded-2xl border-slate-100 shadow-sm bg-white active:scale-95 transition-all" onClick={() => setLocation('/admin-main')}>
                    <Home className="w-5 h-5 text-slate-600" />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex bg-slate-100/50 p-1.5 rounded-[1.25rem] mb-6 flex-none border border-slate-200/50">
              {deviceMode !== 'pc' && (
                <button 
                  className={cn(
                    "flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all",
                    mode === 'scanner' ? "bg-white text-slate-900 shadow-md shadow-slate-200/50 border border-slate-100" : "text-slate-400"
                  )} 
                  onClick={() => setMode('scanner')}
                >
                  Scanner
                </button>
              )}
              <button 
                className={cn(
                  "flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all",
                  (mode === 'manual' || deviceMode === 'pc') ? "bg-white text-slate-900 shadow-md shadow-slate-200/50 border border-slate-100" : "text-slate-400"
                )} 
                onClick={() => setMode('manual')}
              >
                Catalog
              </button>
            </div>

            {mode === 'scanner' ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-[2rem] border border-slate-100 bg-slate-900 shadow-inner">
                <div className="flex-1 relative overflow-hidden">
                  <Scanner onResult={handleBarcodeScan} onError={() => {}} />
                  <div className="absolute inset-0 border-[3px] border-white/20 rounded-[2rem] pointer-events-none" />
                </div>
                <div className="p-4 bg-white/95 backdrop-blur-md border-t border-slate-100 flex gap-3">
                  <div className="relative flex-1">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"><Usb className="w-4 h-4" /></div>
                    <Input 
                      id="manual-barcode"
                      name="manualBarcode"
                      value={manualBarcode} 
                      onChange={(e) => setManualBarcode(e.target.value)} 
                      placeholder="Manual Barcode" 
                      className="pl-11 h-14 bg-slate-50 border-none rounded-2xl font-bold text-sm" 
                    />
                  </div>
                  <Button 
                    onClick={() => { handleBarcodeScan(manualBarcode); setManualBarcode(''); }}
                    className="h-14 w-14 p-0 bg-slate-900 rounded-2xl shadow-xl shadow-slate-900/20 active:scale-90 transition-all"
                  >
                    <Plus className="w-6 h-6 text-white" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex gap-3 mb-6 flex-none px-1">
                  <div className="relative flex-1 group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
                    <Input 
                      id="search-term"
                      name="searchTerm"
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                      placeholder="Search catalog..." 
                      className="pl-11 h-12 bg-white border-slate-100 rounded-2xl shadow-sm focus:ring-4 focus:ring-slate-100 font-bold text-xs" 
                    />
                  </div>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-[110px] h-12 rounded-2xl border-slate-100 bg-white shadow-sm font-black text-[9px] uppercase tracking-widest"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100">{categories.map(c => <SelectItem key={c} value={c} className="text-[10px] font-bold uppercase tracking-widest">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 p-1 pb-10">
                    {filteredProducts.map(p => (
                      <motion.div 
                        key={p.id} 
                        whileTap={{ scale: 0.96 }}
                        onClick={() => handleProductClick(p)} 
                        className="bg-white border border-slate-100 rounded-[1.75rem] p-2.5 cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group"
                      >
                        <div className="aspect-square bg-slate-50 rounded-[1.25rem] mb-2.5 flex items-center justify-center overflow-hidden relative border border-slate-50">
                          <ProductImage
                            src={p.image}
                            alt={p.name}
                            className="absolute inset-0 h-full w-full bg-gradient-to-br from-slate-50 to-slate-100"
                            imageClassName="group-hover:scale-110 transition-transform duration-500"
                            iconClassName="w-8 h-8 text-slate-300"
                          />
                          {!p.isNonInventory && (p.quantity ?? 0) <= 20 && (
                            <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-red-500 text-white text-[7px] font-black uppercase rounded-lg shadow-sm">Low</div>
                          )}
                        </div>
                        <div className="px-1">
                          <h3 className="font-bold text-[10px] uppercase tracking-tight text-slate-800 line-clamp-1 group-hover:text-slate-900 transition-colors">{p.name}</h3>
                          <p className="font-black text-[#FF8882] text-xs mt-0.5">₱{p.price.toLocaleString()}</p>
                          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                            <span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">
                              {p.isNonInventory ? 'Quantity' : <>{p.quantity ?? 0} <span>in stock</span></>}
                            </span>
                            <span className="rounded-md bg-slate-50 px-1.5 py-1 text-[8px] font-black uppercase tracking-wide text-[#9a7427]">
                              Select qty & unit
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Cart - Mobile Optimized */}
          <motion.div
            animate={{ 
              width: isDesktop ? (isCartCollapsed ? '72px' : `${cartWidth}px`) : '100%',
              height: isDesktop ? '100%' : (isCartCollapsed ? '65px' : `${cartHeight}px`),
              y: isDesktop ? 0 : 0
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={cn(
              "relative bg-white flex flex-col z-30 overflow-hidden",
              isDesktop 
                ? "h-full border-l border-gray-100 shadow-[-10px_0_30px_rgba(0,0,0,0.03)]" 
                : "fixed bottom-0 left-0 right-0 rounded-t-[2rem] shadow-[0_-20px_50px_rgba(0,0,0,0.15)] border-t border-gray-100"
            )}
            style={{ maxHeight: isDesktop ? undefined : 'calc(100dvh - 80px)', flexShrink: 0 }}
          >
            {isDesktop && !isCartCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize customer cart"
                title="Drag to resize cart"
                className="absolute left-0 top-0 z-40 h-full w-2 cursor-ew-resize touch-none group"
                onPointerDown={handleCartResizeStart}
              >
                <span className="absolute left-0 top-1/2 h-14 w-1 -translate-y-1/2 rounded-r bg-slate-200 transition-colors group-hover:bg-[#BF953F]" />
              </div>
            )}
            {isDesktop && isCartCollapsed && (
              <div className="flex h-full flex-col items-center gap-3 py-4">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Expand customer cart"
                  title="Expand customer cart"
                  onClick={() => setIsCartCollapsed(false)}
                  className="h-10 w-10 rounded-xl text-[#BF953F]"
                >
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                <span className="text-xs font-black text-slate-700">{cart.length}</span>
                <span className="text-[10px] font-black text-[#FF8882] [writing-mode:vertical-rl]">
                  ₱{getCartTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {/* Mobile Drag Handle / Header */}
            {!isDesktop && (
              <div 
                className="w-full py-2 flex flex-col items-center cursor-pointer active:bg-gray-50 transition-colors rounded-t-[2rem]" 
                onClick={() => setIsCartCollapsed(!isCartCollapsed)}
              >
                <div
                  className="flex h-5 w-16 cursor-ns-resize items-center justify-center touch-none"
                  onPointerDown={handleCartResizeStart}
                  onClick={event => event.stopPropagation()}
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize customer cart"
                  title="Drag to resize cart"
                >
                  <span className="h-1.5 w-12 rounded-full bg-gray-200" />
                </div>
                {!isCartCollapsed && (
                  <div className="flex items-center gap-2 py-1">
                    <ShoppingCart className="w-3.5 h-3.5 text-[#BF953F]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BF953F]">CUSTOMER CART</span>
                  </div>
                )}
                {isCartCollapsed && (
                  <div className="flex items-center justify-between w-full px-6 py-1">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center relative shadow-lg shadow-slate-900/20">
                        <ShoppingCart className="w-4 h-4 text-white" />
                        {cart.length > 0 && (
                          <span className="absolute -top-1 -right-1 w-4.5 h-4.5 bg-[#FF8882] text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white">
                            {cart.length}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-tight text-slate-900">CUSTOMER CART</div>
                        <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{cart.length} products</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-black text-[#FF8882] tracking-tighter">₱{getCartTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center">
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div className={cn(
              "flex flex-col flex-1 min-h-0",
              isDesktop ? "p-6" : "px-6 pb-6 pt-0",
              isDesktop && isCartCollapsed && "hidden"
            )}>
              {/* Desktop Header */}
              {isDesktop && (
                <div className="flex justify-between items-center mb-6 flex-none">
                  {isPayModalOpen ? (
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsPayModalOpen(false)}
                        className="w-10 h-10 p-0 rounded-2xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-all border border-gray-200 cursor-pointer shadow-xs"
                        title="Back to Customer Cart"
                      >
                        <ArrowLeft className="w-5 h-5 text-gray-700" />
                      </Button>
                      <div>
                        <h3 className="font-black text-lg tracking-tighter uppercase text-slate-900">FINALIZE SALE</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{cart.length} Items • Checkout</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#BF953F]/10 rounded-2xl flex items-center justify-center">
                          <ShoppingCart className="w-5 h-5 text-[#BF953F]" />
                        </div>
                        <div>
                          <h3 className="font-black text-lg tracking-tighter uppercase text-slate-900">CUSTOMER CART</h3>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{cart.length} Items</p>
                        </div>
                      </div>
                      <Button 
                        className="h-9 px-4 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#B38728] text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-md"
                        onClick={() => setIsNonInventoryOpen(true)}
                      >
                        + Non-Inv
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Collapse cart"
                        aria-label="Collapse cart"
                        onClick={() => setIsCartCollapsed(true)}
                        className="h-9 w-9 rounded-xl text-slate-500 hover:text-[#BF953F]"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              )}

              {isPayModalOpen && isDesktop ? (
                <AnimatePresence mode="wait">
                  <motion.div 
                    key="checkout"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col h-full"
                  >
                    
                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1 mb-6">
                      {cart.map(item => (
                        <div key={item.productId} className="p-4 bg-gray-50/50 rounded-2xl border border-gray-100 flex justify-between items-center group hover:bg-white hover:shadow-md transition-all">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-xs uppercase tracking-tight text-gray-800 line-clamp-1">{item.name}</div>
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">₱{item.price.toFixed(2)} × {item.quantity}</div>
                            <div className="text-[11px] font-black text-[#FF8882] mt-1">₱{item.subtotal.toFixed(2)}</div>
                          </div>
                          <div className="flex items-center gap-1 transition-opacity">
                            <Button variant="ghost" size="icon" onClick={() => handleEditItem(item)} className="h-8 w-8 rounded-lg hover:bg-gray-100"><Edit className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteItem(item.productId)} className="h-8 w-8 rounded-lg bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 hover:border-red-400"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4 bg-white border-t border-gray-100 pt-6 pb-4 flex-none sticky bottom-0">
                      {/* Payment Type Selection */}
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">Payment Method</Label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => { setPaymentType('cash'); setPaymentAmount(null); }}
                            className={cn(
                              "py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all border flex items-center justify-center gap-1.5",
                              paymentType === 'cash' ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                            )}
                          >
                            <DollarSign className="w-4 h-4" /> Cash
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPaymentType('ewallet'); setPaymentAmount(getCartTotal()); }}
                            className={cn(
                              "py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all border flex items-center justify-center gap-1.5",
                              paymentType === 'ewallet' ? "bg-blue-600 text-white border-blue-600 shadow-md" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                            )}
                          >
                            <CreditCard className="w-4 h-4" /> Cashless
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPaymentType('credits'); setPaymentAmount(0); loadCreditors(); }}
                            className={cn(
                              "py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition-all border flex items-center justify-center gap-1.5",
                              paymentType === 'credits' ? "bg-[#BF953F] text-white border-[#BF953F] shadow-md" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                            )}
                          >
                            <User className="w-4 h-4" /> Credits
                          </button>
                        </div>
                      </div>

                      {paymentType === 'ewallet' && (
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-2xl text-[10px] text-blue-700 font-bold flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          <span>Cashless payment is verified out-of-system by staff (GCash, Maya, QR Ph, etc.).</span>
                        </div>
                      )}

                      {paymentType === 'credits' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">Select Creditor Account</Label>
                            <button
                              type="button"
                              onClick={() => setIsAddCreditorOpen(true)}
                              className="text-[10px] font-black uppercase tracking-wider text-[#BF953F] hover:underline flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Add New Creditor
                            </button>
                          </div>
                          <Select
                            value={selectedCreditor?.id || ''}
                            onValueChange={(val) => {
                              const found = creditors.find(c => c.id === val);
                              setSelectedCreditor(found ? { id: found.id, name: found.name } : null);
                            }}
                          >
                            <SelectTrigger className="h-12 bg-gray-50 border-gray-200 rounded-2xl font-bold text-sm">
                              <SelectValue placeholder="-- Select Creditor Account --" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-gray-100">
                              {creditors.map(c => (
                                <SelectItem key={c.id} value={c.id} className="font-bold text-xs">
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {paymentType === 'cash' && (
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">Received Amount (₱)</Label>
                          <Input 
                            type="number" 
                            value={paymentAmount ?? ''} 
                            onChange={e => {
                              const val = parseFloat(e.target.value);
                              setPaymentAmount(isNaN(val) ? null : val);
                              setPaymentError(false);
                            }} 
                            placeholder="0.00" 
                            className={cn(
                              "h-14 bg-gray-50 border border-gray-200 rounded-2xl font-black text-xl px-6 focus:ring-2 focus:ring-[#BF953F]/30 focus:border-[#BF953F]",
                              paymentError && "ring-2 ring-red-500/30 bg-red-50 border-red-300"
                            )} 
                          />
                          {/* Quick Cash Selection Chips */}
                          <div className="flex items-center gap-1.5 flex-wrap pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentAmount(getCartTotal());
                                setPaymentError(false);
                              }}
                              className={cn(
                                "px-2.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border",
                                paymentAmount === getCartTotal()
                                  ? "bg-[#BF953F] text-white border-[#BF953F] shadow-sm"
                                  : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                              )}
                            >
                              Exact
                            </button>
                            {[50, 100, 200, 500, 1000].map((denom) => (
                              <button
                                key={denom}
                                type="button"
                                onClick={() => {
                                  setPaymentAmount(denom);
                                  setPaymentError(false);
                                }}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-xl text-xs font-black transition-all border",
                                  paymentAmount === denom
                                    ? "bg-[#BF953F] text-white border-[#BF953F] shadow-sm"
                                    : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                                )}
                              >
                                ₱{denom}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="p-4 bg-gray-50/50 rounded-2xl border border-gray-100">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Transaction Total</span>
                          <span className="text-2xl font-black text-[#FF8882] tracking-tighter">₱{getCartTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        {paymentType === 'cash' && paymentAmount !== null && (
                          <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-200/50">
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Expected Change</span>
                            <span className="text-xl font-black text-emerald-500 tracking-tighter">
                              ₱{Math.max(0, paymentAmount - getCartTotal()).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                      </div>

                      <Button 
                        onClick={handleProcessSale} 
                        disabled={isProcessing || cart.length === 0} 
                        className="w-full h-16 bg-gradient-to-r from-[#BF953F] to-[#B38728] rounded-[1.25rem] font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-[#BF953F]/20 hover:shadow-2xl hover:shadow-[#BF953F]/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
                      >
                        {isProcessing ? 'Processing...' : 'Complete Sale'}
                      </Button>
                    </div>
                  </motion.div>
                </AnimatePresence>
              ) : (
                <div className="flex flex-col h-full">
                  <AnimatePresence mode="popLayout">
                    {cart.length > 0 ? (
                      <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                      {cart.map(item => (
                        <motion.div 
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          key={item.productId} 
                          className="flex justify-between items-center p-3.5 bg-slate-50/50 rounded-2xl border border-slate-100 hover:bg-white hover:shadow-md transition-all group"
                        >
                          <div className="flex-1 min-w-0 mr-4">
                            <div className="font-bold text-[11px] uppercase tracking-tight text-slate-800 line-clamp-1">{item.name}</div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">₱{item.price.toFixed(2)} × {item.quantity} {item.unit}</div>
                          </div>
                          <div className="text-right flex items-center gap-2">
                            <div className="font-black text-slate-900 text-[11px]">₱{item.subtotal.toFixed(2)}</div>
                            <button 
                              onClick={() => handleEditItem(item)} 
                              className="text-slate-600 transition-colors p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => handleDeleteItem(item.productId)} 
                              className="text-red-500 transition-colors p-1.5 bg-red-50 rounded-lg shadow-sm border border-red-200 hover:border-red-400 hover:bg-red-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                        <div className="w-20 h-20 bg-gray-100 rounded-[2rem] flex items-center justify-center mb-4">
                          <ShoppingCart className="w-8 h-8 text-gray-400" />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em]">Empty Cart</p>
                        <p className="text-[8px] font-bold uppercase mt-1">Scan or search items to start</p>
                      </div>
                    )}
                  </AnimatePresence>
                  
                  <div className={cn(
                    "border-t border-slate-100 pt-4 mt-auto",
                    !isDesktop && isCartCollapsed && "hidden"
                  )}>
                    <div className="flex justify-between items-end mb-6 px-1">
                      <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Payment Total</span>
                        <span className="text-3xl font-black text-slate-900 tracking-tighter leading-none">
                          ₱{getCartTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-black text-[#BF953F] bg-[#BF953F]/10 px-3 py-1.5 rounded-xl uppercase tracking-widest">Checkout Ready</span>
                      </div>
                    </div>
                    <Button 
                      onClick={handlePayClick} 
                      disabled={cart.length === 0}
                      className="w-full h-16 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-[0.3em] shadow-2xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all relative overflow-hidden group"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-[#BF953F] to-[#B38728] opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <CreditCard className="w-5 h-5" />
                        Finalize Payment
                      </span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Dialogs - Consistent Styling */}
        <Dialog open={showQuantityDialog} onOpenChange={setShowQuantityDialog}>
          <DialogContent className="rounded-[2.5rem] p-8 sm:max-w-[400px]">
            <DialogHeader className="mb-6">
              <div className="w-14 h-14 bg-[#BF953F]/10 rounded-2xl flex items-center justify-center mb-4">
                <Package className="w-7 h-7 text-[#BF953F]" />
              </div>
              <DialogTitle className="text-2xl font-black tracking-tighter uppercase">{scannedProduct?.name}</DialogTitle>
              <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-gray-400">Adjust quantity & unit</DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-2">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Enter Quantity</Label>
                <Input
                  min={1}
                  step={1}
                  inputMode="numeric"
                  type="number" 
                  value={tempQuantity} 
                  onChange={e => setTempQuantity(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="h-14 bg-gray-50 border-none rounded-2xl font-black text-xl px-6 focus:ring-2 focus:ring-[#BF953F]/20"
                  autoFocus 
                />
                <p className="text-[11px] text-gray-500 px-1">
                  {tempQuantity === '' ? 'Enter a whole-number quantity.' : `${tempQuantity} ${tempUnit} = ${tempQuantity * getUnitMultiplier(tempUnit)} pieces`}
                  {!scannedProduct?.isNonInventory && scannedProduct && (
                    <span> · {scannedProduct.quantity} pieces available</span>
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Select Unit</Label>
                <Select value={tempUnit} onValueChange={(v: any) => setTempUnit(v)}>
                  <SelectTrigger className="h-14 bg-gray-50 border-none rounded-2xl font-black px-6 focus:ring-2 focus:ring-[#BF953F]/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border-gray-100">
                    <SelectItem value="pieces" className="font-bold uppercase text-[10px]">Pieces</SelectItem>
                    <SelectItem value="dozen" className="font-bold uppercase text-[10px]">Dozen (12)</SelectItem>
                    <SelectItem value="carton" className="font-bold uppercase text-[10px]">Carton (24)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="mt-8 flex gap-3 sm:gap-0">
              <Button onClick={handleConfirmQuantity} className="flex-1 h-14 bg-[#BF953F] rounded-2xl font-black uppercase tracking-widest text-white shadow-lg shadow-[#BF953F]/20">Update Cart</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Logout Confirmation Dialog */}
        <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
          <AlertDialogContent className="rounded-[2rem] p-8 border-none shadow-2xl">
            <AlertDialogHeader>
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-4 mx-auto">
                <LogOut className="w-8 h-8 text-red-500" />
              </div>
              <AlertDialogTitle className="text-2xl font-black text-center tracking-tighter uppercase text-slate-900">Confirm Logout</AlertDialogTitle>
              <AlertDialogDescription className="text-center text-slate-500 font-medium">
                Are you sure you want to end your shift and logout?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-8 flex gap-3">
              <AlertDialogCancel className="flex-1 h-14 rounded-2xl border-slate-100 font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => {
                  logout();
                  setLocation('/role-selection');
                }}
                className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all"
              >
                Logout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Variant & Base Product Selection Dialog */}
        <Dialog open={isVariantSelectionOpen} onOpenChange={setIsVariantSelectionOpen}>
          <DialogContent className="rounded-[2.5rem] p-8 sm:max-w-[520px]">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-black tracking-tighter uppercase">{selectedProductForVariant?.name}</DialogTitle>
              <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-gray-400">Select original product or variant</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1 custom-scrollbar">
              {/* Original Base Product Option */}
              {selectedProductForVariant && (
                <div className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#BF953F]">Original Product</span>
                  <button
                    onClick={() => handleSelectBaseProduct(selectedProductForVariant)}
                    disabled={(selectedProductForVariant.quantity ?? 0) < 1}
                    className={cn(
                      "w-full p-4 rounded-[1.5rem] border text-left transition-all group relative overflow-hidden flex justify-between items-center",
                      (selectedProductForVariant.quantity ?? 0) < 1
                        ? "bg-gray-50 border-gray-100 opacity-50 grayscale"
                        : "bg-amber-50/40 border-amber-200/60 hover:border-[#BF953F] hover:shadow-md active:scale-[0.98]"
                    )}
                  >
                    <div>
                      <div className="font-black text-xs uppercase tracking-tight text-gray-900 group-hover:text-[#BF953F]">
                        {selectedProductForVariant.name} <span className="text-[9px] font-bold text-[#BF953F] bg-[#BF953F]/10 px-2 py-0.5 rounded-full ml-1">(Base Item)</span>
                      </div>
                      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                        {selectedProductForVariant.quantity ?? 0} In Stock
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-[#BF953F] text-base">₱{selectedProductForVariant.price.toFixed(2)}</div>
                    </div>
                    {(selectedProductForVariant.quantity ?? 0) < 1 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                        <span className="bg-red-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-full shadow-sm">Out of Stock</span>
                      </div>
                    )}
                  </button>
                </div>
              )}

              {/* Variants Section */}
              {productVariants.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Available Variants</span>
                  <div className="grid grid-cols-2 gap-3">
                    {productVariants.map(variant => (
                      <button 
                        key={variant.id}
                        onClick={() => handleVariantSelect(variant)}
                        disabled={(variant.quantity ?? 0) < 1}
                        className={cn(
                          "p-4 rounded-[1.5rem] border text-left transition-all group relative overflow-hidden",
                          (variant.quantity ?? 0) < 1 
                            ? "bg-gray-50 border-gray-100 opacity-50 grayscale" 
                            : "bg-white border-gray-100 hover:border-[#BF953F]/30 hover:shadow-md active:scale-[0.98]"
                        )}
                      >
                        <div className="font-black text-[11px] uppercase tracking-tight text-gray-800 mb-1 group-hover:text-[#BF953F]">{variant.name}</div>
                        <div className="font-black text-[#FF8882] text-sm">₱{variant.price.toFixed(2)}</div>
                        <div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mt-2">{variant.quantity} In Stock</div>
                        {(variant.quantity ?? 0) < 1 && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                            <span className="bg-red-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-full shadow-sm">Out of Stock</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="mt-6">
               <Button variant="outline" onClick={() => setIsVariantSelectionOpen(false)} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest border-gray-100">Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Non-Inventory Item Dialog */}
        <Dialog open={isNonInventoryOpen} onOpenChange={setIsNonInventoryOpen}>
          <DialogContent className="rounded-[2.5rem] p-8 sm:max-w-[400px]">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-2xl font-black tracking-tighter uppercase">Non-Inventory Item</DialogTitle>
              <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-gray-400">Add a custom or weighted product (e.g., Oil in KILO)</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">Item Name</Label>
                <Input
                  value={nonInvName}
                  onChange={e => setNonInvName(e.target.value)}
                  placeholder="e.g., Cooking Oil"
                  className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm placeholder:text-gray-300 focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F]"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">Unit / Category</Label>
                <Select value={nonInvUnit} onValueChange={(val: any) => setNonInvUnit(val)}>
                  <SelectTrigger className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pieces">Pieces (pcs)</SelectItem>
                    <SelectItem value="kilo">Kilo (kg)</SelectItem>
                    <SelectItem value="gram">Gram (g)</SelectItem>
                    <SelectItem value="liter">Liter (L)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">
                    {nonInvUnit === 'kilo' ? 'Kilos / Qty' : (nonInvUnit === 'gram' ? 'Grams / Qty' : (nonInvUnit === 'liter' ? 'Liters / Qty' : 'Quantity'))}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={nonInvQty}
                    onChange={e => setNonInvQty(e.target.value)}
                    placeholder="1"
                    className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm placeholder:text-gray-300 focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">
                    {nonInvUnit === 'pieces' ? 'Price (₱)' : 'Actual Total (₱)'}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={nonInvPrice}
                    onChange={e => setNonInvPrice(e.target.value)}
                    placeholder="0.00"
                    className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm placeholder:text-gray-300 focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F]"
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-8 flex gap-3">
              <Button variant="outline" onClick={() => setIsNonInventoryOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase tracking-widest border-gray-100">Cancel</Button>
              <Button onClick={handleAddNonInventory} className="flex-1 h-12 bg-[#BF953F] rounded-2xl font-black uppercase tracking-widest text-white shadow-lg shadow-[#BF953F]/20">Add to Cart</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Mobile Pay Modal */}
        <Dialog open={isPayModalOpen && !isDesktop} onOpenChange={setIsPayModalOpen}>
          <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0 overflow-hidden rounded-t-[3rem] border-none">
            <DialogHeader className="p-6 border-b border-gray-50 flex-none relative">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsPayModalOpen(false)}
                  className="w-10 h-10 p-0 rounded-2xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-all border border-gray-200 cursor-pointer shadow-xs"
                  title="Back to Cart"
                >
                  <ArrowLeft className="w-5 h-5 text-gray-700" />
                </Button>
                <div>
                  <DialogTitle className="text-xl font-black tracking-tighter uppercase text-slate-900">FINALIZE SALE</DialogTitle>
                  <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-gray-400">{cart.length} Items to Process</DialogDescription>
                </div>
              </div>
            </DialogHeader>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-4 bg-gray-50/30 custom-scrollbar">
              {cart.map(item => (
                <div key={item.productId} className="p-5 bg-white rounded-[1.5rem] shadow-sm border border-gray-100/50 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-xs uppercase tracking-tight text-gray-800">{item.name}</h3>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">₱{item.price.toFixed(2)} × {item.quantity}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-[#FF8882]">₱{item.subtotal.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-8 bg-white border-t border-gray-100 space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 ml-1">Received Amount (₱)</Label>
                <Input 
                  type="number" 
                  value={paymentAmount ?? ''} 
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setPaymentAmount(isNaN(val) ? null : val);
                    setPaymentError(false);
                  }} 
                  placeholder="0.00" 
                  className={cn(
                    "h-16 bg-gray-50 border-none rounded-2xl font-black text-2xl px-6 focus:ring-2 focus:ring-[#BF953F]/20 text-center",
                    paymentError && "ring-2 ring-red-500/20 bg-red-50"
                  )} 
                />
                {/* Quick Cash Selection Chips */}
                <div className="flex items-center justify-center gap-1.5 flex-wrap pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentAmount(getCartTotal());
                      setPaymentError(false);
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border",
                      paymentAmount === getCartTotal()
                        ? "bg-[#BF953F] text-white border-[#BF953F] shadow-sm"
                        : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    Exact
                  </button>
                  {[50, 100, 200, 500, 1000].map((denom) => (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => {
                        setPaymentAmount(denom);
                        setPaymentError(false);
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-black transition-all border",
                        paymentAmount === denom
                          ? "bg-[#BF953F] text-white border-[#BF953F] shadow-sm"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      ₱{denom}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-end">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Total Due</span>
                  <span className="text-3xl font-black text-gray-900 tracking-tighter">₱{getCartTotal().toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {paymentAmount !== null && paymentAmount > 0 && (
                  <div className="text-right">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Change</span>
                    <span className="text-2xl font-black text-emerald-500 tracking-tighter">₱{Math.max(0, paymentAmount - getCartTotal()).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
              </div>

              <Button 
                onClick={handleProcessSale} 
                disabled={isProcessing || cart.length === 0}
                className="w-full h-16 bg-gradient-to-r from-[#FF8882] to-[#D89D9D] text-white rounded-[1.5rem] font-black uppercase tracking-[0.2em] shadow-xl shadow-[#FF8882]/20 active:scale-[0.98] transition-all"
              >
                {isProcessing ? 'Finalizing...' : 'Complete Transaction'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Remittance Dialog */}
        <Dialog open={isRemitDialogOpen} onOpenChange={setIsRemitDialogOpen}>
          <DialogContent className="rounded-[2.5rem] p-0 sm:max-w-[600px] overflow-hidden border-none shadow-2xl">
            <div className="bg-slate-900 p-8 text-white relative">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-3xl font-black tracking-tighter uppercase mb-1">Daily Remittance</h2>
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">Shift Summary & Revenue</p>
                </div>
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center">
                  <Send className="w-6 h-6 text-[#BF953F]" />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest mb-1">Total Revenue</p>
                  <p className="text-2xl font-black text-[#BF953F]">₱{remitAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <p className="text-slate-400 text-[9px] font-black uppercase tracking-widest mb-1">Transactions</p>
                  <p className="text-2xl font-black text-white">{remitTxCount}</p>
                </div>
              </div>
            </div>

            <div className="p-8 bg-white">
              <div className="mb-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-4">Transaction History</h3>
                <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-2 custom-scrollbar">
                  {remitTransactions.length > 0 ? (
                    remitTransactions.map((sale) => (
                      <div key={sale.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:bg-white hover:shadow-md transition-all">
                        <div>
                          <p className="font-bold text-[11px] text-slate-900 uppercase tracking-tight">
                            {new Date(sale.createdAt || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                            {sale.paymentType}
                          </p>
                        </div>
                        <p className="font-black text-slate-900 text-sm">₱{sale.total.toLocaleString()}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 opacity-40">
                      <p className="text-[10px] font-black uppercase tracking-widest">No transactions yet</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4">
                <Button 
                  variant="outline" 
                  onClick={() => setIsRemitDialogOpen(false)}
                  className="flex-1 h-14 rounded-2xl border-slate-100 font-black uppercase tracking-widest text-slate-400"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={confirmRemit}
                  disabled={isRemitting || remitAmount === 0}
                  className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  {isRemitting ? 'Processing...' : 'Submit Remit'}
                </Button>
              </div>
              
              <p className="text-center text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-6">
                Once submitted, your daily total will reset and await admin confirmation.
              </p>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hardware Setup Dialog */}
        <Dialog open={showHardwareSetup} onOpenChange={setShowHardwareSetup}>
          <DialogContent className="rounded-[2.5rem] p-6 sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
            <DialogHeader className="mb-4">
              <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mb-4">
                <Cpu className="w-7 h-7 text-orange-500" />
              </div>
              <DialogTitle className="text-2xl font-black tracking-tighter uppercase">Hardware Setup</DialogTitle>
              <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-gray-400">Printer & Scanner Configuration</DialogDescription>
            </DialogHeader>
            <ExternalDeviceManager />
          </DialogContent>
        </Dialog>

        {/* Admin Authorization Modal for Staff Product Deletion */}
        <Dialog open={!!deleteItemId} onOpenChange={(open) => {
          if (!open) {
            setDeleteItemId(null);
            setAdminPassword('');
          }
        }}>
          <DialogContent className="rounded-[2.5rem] p-8 sm:max-w-[420px] border-none shadow-2xl">
            <DialogHeader className="mb-4">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4 mx-auto">
                <AlertTriangle className="w-7 h-7 text-red-500" />
              </div>
              <DialogTitle className="text-2xl font-black tracking-tighter uppercase text-center">Admin Verification Required</DialogTitle>
              <DialogDescription className="text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Staff requires admin authorization to delete a product from cart.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Admin Password</Label>
                <Input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmDeleteWithAdmin();
                    }
                  }}
                  placeholder="Enter admin password"
                  className="h-14 bg-gray-50 border-gray-100 rounded-2xl font-black text-sm px-6 focus:ring-2 focus:ring-red-500/20"
                  autoFocus
                />
              </div>
            </div>

            <DialogFooter className="mt-6 flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteItemId(null);
                  setAdminPassword('');
                }}
                className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest border-gray-100"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDeleteWithAdmin}
                disabled={isValidatingAdmin || !adminPassword.trim()}
                className="flex-1 h-14 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-red-500/20"
              >
                {isValidatingAdmin ? 'Verifying...' : 'Authorize Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showOfflinePrompt} onOpenChange={setShowOfflinePrompt}>
          <AlertDialogContent className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl p-6 max-w-md z-[100]">
            <AlertDialogHeader className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-amber-400" />
              </div>
              <AlertDialogTitle className="text-xl font-bold text-white">
                No Internet Connection Detected
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300 text-xs leading-relaxed">
                You don't have internet connection. All your sales data will store in local DB and remittance cannot be processed until the internet is back. Would you like to proceed to sales terminal to process sales?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-6 flex items-center gap-3">
              <AlertDialogCancel
                onClick={() => setLocation('/')}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 rounded-xl text-xs font-semibold py-2.5"
              >
                No, Go Back
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => setShowOfflinePrompt(false)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold py-2.5 shadow-lg shadow-blue-600/30"
              >
                Yes, Proceed
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={isAddCreditorOpen} onOpenChange={setIsAddCreditorOpen}>
          <DialogContent className="rounded-[2.5rem] p-6 sm:max-w-[420px] z-[110]">
            <DialogHeader className="mb-4">
              <div className="w-12 h-12 bg-[#BF953F]/10 rounded-2xl flex items-center justify-center mb-2">
                <User className="w-6 h-6 text-[#BF953F]" />
              </div>
              <DialogTitle className="text-xl font-black tracking-tighter uppercase">Add New Creditor Profile</DialogTitle>
              <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Create a customer profile for credit purchases</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Customer Full Name *</Label>
                <Input
                  value={newCreditorName}
                  onChange={e => setNewCreditorName(e.target.value)}
                  placeholder="e.g., Juan Dela Cruz"
                  className="h-12 bg-slate-50 border-slate-200 rounded-2xl font-bold text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Mobile / Phone Number</Label>
                <Input
                  value={newCreditorPhone}
                  onChange={e => setNewCreditorPhone(e.target.value)}
                  placeholder="0917 000 0000"
                  className="h-12 bg-slate-50 border-slate-200 rounded-2xl font-bold text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Address / Note</Label>
                <Input
                  value={newCreditorAddress}
                  onChange={e => setNewCreditorAddress(e.target.value)}
                  placeholder="Brgy, City / Customer Note"
                  className="h-12 bg-slate-50 border-slate-200 rounded-2xl font-bold text-sm"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 flex gap-3">
              <Button variant="outline" onClick={() => setIsAddCreditorOpen(false)} className="flex-1 h-12 rounded-2xl font-black uppercase tracking-widest border-slate-200">Cancel</Button>
              <Button onClick={handleCreateCreditorInline} disabled={isSavingCreditor || !newCreditorName.trim()} className="flex-1 h-12 bg-[#BF953F] text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-[#BF953F]/20">
                {isSavingCreditor ? 'Saving...' : 'Save & Select'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </motion.div>
    </Layout>
  );
};

export default ScannerSales;
