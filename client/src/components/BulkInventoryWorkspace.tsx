import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Barcode, 
  Plus, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  Building2, 
  PackageCheck, 
  Boxes, 
  AlertCircle,
  ScanLine,
  Minus,
  FileText,
  Search,
  Package,
  Layers,
  ArrowRight,
  Sparkles,
  Link as LinkIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { db, BulkInventoryService } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type { BulkLineInput, Product, Variant } from '@shared/schema';
import { LocalizedContent } from '@/contexts/LanguageContext';

interface BulkInventoryWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const BulkInventoryWorkspace: React.FC<BulkInventoryWorkspaceProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Session Header State
  const [supplierCompany, setSupplierCompany] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  
  // Scanned Lines
  const [items, setItems] = useState<BulkLineInput[]>([]);
  
  // Scanner Input State
  const [scanValue, setScanValue] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);
  
  // Box Breakdown & Product Linker Modal State
  const [showLinkerModal, setShowLinkerModal] = useState(false);
  const [linkerBoxBarcode, setLinkerBoxBarcode] = useState('');
  const [linkerMode, setLinkerMode] = useState<'link_existing' | 'create_new' | 'single_unit'>('link_existing');
  const [linkerBoxCount, setLinkerBoxCount] = useState<number>(1);
  const [linkerUnitsPerBox, setLinkerUnitsPerBox] = useState<number>(12);
  const [linkerCostPerBox, setLinkerCostPerBox] = useState<number>(0);
  const [linkerUnitCost, setLinkerUnitCost] = useState<number>(0);
  const [linkerSellingPrice, setLinkerSellingPrice] = useState<number>(0);
  const [linkerPieceBarcode, setLinkerPieceBarcode] = useState('');
  const [linkerProductName, setLinkerProductName] = useState('');
  const [linkerCategory, setLinkerCategory] = useState('general');
  const [linkerDescription, setLinkerDescription] = useState('');
  const [linkerUpdateMaster, setLinkerUpdateMaster] = useState(true);
  
  // Linker search & selection state
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Line Editing Modal State
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editLine, setEditLine] = useState<BulkLineInput | null>(null);
  
  // Confirmations
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load catalog on mount/open
  useEffect(() => {
    if (isOpen) {
      db.products.toArray().then(prods => {
        setCatalogProducts(prods || []);
      });
      setTimeout(() => {
        scanInputRef.current?.focus();
      }, 150);
    }
  }, [isOpen]);

  // Recalculate unit cost when cost per box or units per box change
  useEffect(() => {
    if (linkerUnitsPerBox > 0 && linkerCostPerBox >= 0) {
      const computedUnitCost = parseFloat((linkerCostPerBox / linkerUnitsPerBox).toFixed(2));
      setLinkerUnitCost(computedUnitCost);
    }
  }, [linkerCostPerBox, linkerUnitsPerBox]);

  // Handle Barcode Scan / Enter
  const handleScanSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const barcodeTrimmed = scanValue.trim();
    if (!barcodeTrimmed) return;

    try {
      // 1. Check if barcode matches master BOX barcode of an existing product
      const matchingBoxProd = await db.products.where('boxBarcode').equals(barcodeTrimmed).first();
      
      if (matchingBoxProd) {
        // Recognized Master Box!
        const packRatio = Number((matchingBoxProd as any).unitsPerBox || (matchingBoxProd as any).units_per_box || 1);
        const boxWholesaleCost = Number((matchingBoxProd as any).boxCost || (matchingBoxProd as any).box_cost || ((matchingBoxProd.cost ?? 0) * packRatio));
        const unitPieceCost = Number((matchingBoxProd.cost ?? 0) || (packRatio > 0 ? boxWholesaleCost / packRatio : 0));

        // Check if already in current list
        const existingIdx = items.findIndex(i => i.productId === matchingBoxProd.id && i.isIntakeByBox);
        if (existingIdx >= 0) {
          setItems(prev => {
            const next = [...prev];
            const currentBoxCount = Number(next[existingIdx].boxCount || 1) + 1;
            const newTotalPieces = currentBoxCount * packRatio;
            next[existingIdx] = {
              ...next[existingIdx],
              boxCount: currentBoxCount,
              quantity: newTotalPieces
            };
            return next;
          });
          toast({
            title: "📦 Box Incremented",
            description: `+1 Box (+${packRatio} pcs) for ${matchingBoxProd.name}`,
          });
        } else {
          // Add new box line
          const newLine: BulkLineInput = {
            productId: matchingBoxProd.id,
            variantId: null,
            barcode: matchingBoxProd.barcode || barcodeTrimmed,
            boxBarcode: barcodeTrimmed,
            pieceBarcode: matchingBoxProd.barcode || null,
            boxCount: 1,
            unitsPerBox: packRatio,
            costPerBox: boxWholesaleCost,
            isIntakeByBox: true,
            productName: matchingBoxProd.name,
            description: matchingBoxProd.description || null,
            sellingPrice: matchingBoxProd.price,
            cost: unitPieceCost,
            quantity: packRatio, // total pieces added
            supplierCompanyOverride: supplierCompany.trim() || null,
            notes: null,
            isVariant: false,
            isNewProduct: false,
            updateProductPriceCost: false
          };
          setItems(prev => [newLine, ...prev]);
          toast({
            title: "📦 Master Box Recognized",
            description: `${matchingBoxProd.name} (1 Box = ${packRatio} pcs added)`,
          });
        }
        setScanValue('');
        setTimeout(() => scanInputRef.current?.focus(), 50);
        return;
      }

      // 2. Check if barcode matches standard PIECE barcode of an existing product or variant
      const matchingProd = await db.products.where('barcode').equals(barcodeTrimmed).first();
      let matchingVar: Variant | undefined;
      
      if (!matchingProd) {
        matchingVar = await db.variants.where('barcode').equals(barcodeTrimmed).first();
      }

      if (matchingProd) {
        // Standard piece scan for existing product
        const existingIdx = items.findIndex(i => i.productId === matchingProd.id && !i.isVariant && !i.isIntakeByBox);
        if (existingIdx >= 0) {
          setItems(prev => {
            const next = [...prev];
            next[existingIdx] = {
              ...next[existingIdx],
              quantity: next[existingIdx].quantity + 1
            };
            return next;
          });
          toast({
            title: "Stock Incremented",
            description: `Increased quantity for ${matchingProd.name} (+1 pc)`,
          });
        } else {
          const newLine: BulkLineInput = {
            productId: matchingProd.id,
            variantId: null,
            barcode: matchingProd.barcode || barcodeTrimmed,
            boxBarcode: (matchingProd as any).boxBarcode || null,
            pieceBarcode: matchingProd.barcode || barcodeTrimmed,
            boxCount: 0,
            unitsPerBox: 1,
            costPerBox: 0,
            isIntakeByBox: false,
            productName: matchingProd.name,
            description: matchingProd.description || null,
            sellingPrice: matchingProd.price,
            cost: (matchingProd as any).cost ?? 0,
            quantity: 1,
            supplierCompanyOverride: supplierCompany.trim() || null,
            notes: null,
            isVariant: false,
            isNewProduct: false,
            updateProductPriceCost: false
          };
          setItems(prev => [newLine, ...prev]);
          toast({
            title: "Product Added",
            description: `${matchingProd.name} (1 piece added)`,
          });
        }
        setScanValue('');
        setTimeout(() => scanInputRef.current?.focus(), 50);
        return;
      }

      if (matchingVar) {
        // Standard piece scan for existing variant
        const existingIdx = items.findIndex(i => i.variantId === matchingVar!.id);
        if (existingIdx >= 0) {
          setItems(prev => {
            const next = [...prev];
            next[existingIdx] = {
              ...next[existingIdx],
              quantity: next[existingIdx].quantity + 1
            };
            return next;
          });
        } else {
          const parentProd = await db.products.get(matchingVar.productId);
          const newLine: BulkLineInput = {
            productId: matchingVar.productId,
            variantId: matchingVar.id,
            barcode: matchingVar.barcode || barcodeTrimmed,
            boxBarcode: (matchingVar as any).boxBarcode || null,
            pieceBarcode: matchingVar.barcode || barcodeTrimmed,
            boxCount: 0,
            unitsPerBox: 1,
            costPerBox: 0,
            isIntakeByBox: false,
            productName: `${parentProd?.name || 'Product'} (${matchingVar.name})`,
            description: null,
            sellingPrice: matchingVar.price,
            cost: matchingVar.cost,
            quantity: 1,
            supplierCompanyOverride: supplierCompany.trim() || null,
            notes: null,
            isVariant: true,
            isNewProduct: false,
            updateProductPriceCost: false
          };
          setItems(prev => [newLine, ...prev]);
        }
        setScanValue('');
        setTimeout(() => scanInputRef.current?.focus(), 50);
        return;
      }

      // 3. Barcode is UNRECOGNIZED: Open the Box Breakdown & Product Linker Modal!
      setLinkerBoxBarcode(barcodeTrimmed);
      setLinkerMode('link_existing');
      setLinkerBoxCount(1);
      setLinkerUnitsPerBox(12);
      setLinkerCostPerBox(0);
      setLinkerUnitCost(0);
      setLinkerSellingPrice(0);
      setLinkerPieceBarcode('');
      setLinkerProductName('');
      setLinkerCategory('general');
      setLinkerDescription('');
      setLinkerUpdateMaster(true);
      setSelectedProduct(null);
      setSearchFilter('');
      setShowLinkerModal(true);
      
    } catch (err) {
      console.error('Scan handling error:', err);
    } finally {
      setScanValue('');
    }
  };

  // Confirm and Add item from Linker Modal
  const handleConfirmLinker = () => {
    const isBox = linkerMode !== 'single_unit';
    const boxCount = isBox ? Math.max(1, linkerBoxCount) : 0;
    const unitsPerBox = isBox ? Math.max(1, linkerUnitsPerBox) : 1;
    const totalPieces = isBox ? boxCount * unitsPerBox : Math.max(1, linkerBoxCount || 1);
    const boxCost = isBox ? Number(linkerCostPerBox || 0) : 0;
    const pieceCost = Number(linkerUnitCost || (unitsPerBox > 0 ? boxCost / unitsPerBox : 0));
    const sellingPrice = Number(linkerSellingPrice || 0);

    if (linkerMode === 'link_existing') {
      if (!selectedProduct) {
        toast({
          title: "Select Product",
          description: "Please select an existing catalog product to link with this master box barcode.",
          variant: "destructive"
        });
        return;
      }

      // Check if item already exists in current intake batch
      const existingIdx = items.findIndex(i => i.productId === selectedProduct.id);
      if (existingIdx >= 0) {
        setItems(prev => {
          const next = [...prev];
          const prevBoxCount = Number(next[existingIdx].boxCount || 0);
          const newBoxCount = isBox ? prevBoxCount + boxCount : prevBoxCount;
          const newTotalPieces = next[existingIdx].quantity + totalPieces;
          next[existingIdx] = {
            ...next[existingIdx],
            boxBarcode: linkerBoxBarcode.trim() || next[existingIdx].boxBarcode,
            pieceBarcode: selectedProduct.barcode || next[existingIdx].pieceBarcode,
            boxCount: newBoxCount,
            unitsPerBox,
            costPerBox: boxCost > 0 ? boxCost : next[existingIdx].costPerBox,
            cost: pieceCost > 0 ? pieceCost : next[existingIdx].cost,
            sellingPrice: sellingPrice > 0 ? sellingPrice : next[existingIdx].sellingPrice,
            quantity: newTotalPieces,
            isIntakeByBox: isBox || next[existingIdx].isIntakeByBox,
            updateProductPriceCost: linkerUpdateMaster
          };
          return next;
        });
        toast({
          title: "Line Updated",
          description: `Added ${boxCount} box(es) (+${totalPieces} pcs) to ${selectedProduct.name}`,
        });
      } else {
        const newLine: BulkLineInput = {
          productId: selectedProduct.id,
          variantId: null,
          barcode: selectedProduct.barcode || linkerPieceBarcode.trim() || linkerBoxBarcode.trim(),
          boxBarcode: isBox ? linkerBoxBarcode.trim() : null,
          pieceBarcode: selectedProduct.barcode || linkerPieceBarcode.trim() || null,
          boxCount,
          unitsPerBox,
          costPerBox: boxCost,
          isIntakeByBox: isBox,
          productName: selectedProduct.name,
          description: selectedProduct.description || null,
          sellingPrice: sellingPrice > 0 ? sellingPrice : selectedProduct.price,
          cost: pieceCost > 0 ? pieceCost : (selectedProduct.cost ?? 0),
          quantity: totalPieces,
          supplierCompanyOverride: supplierCompany.trim() || null,
          notes: null,
          isVariant: false,
          isNewProduct: false,
          updateProductPriceCost: linkerUpdateMaster
        };
        setItems(prev => [newLine, ...prev]);
        toast({
          title: "Box Linked Successfully",
          description: `Linked ${linkerBoxBarcode} to ${selectedProduct.name} (+${totalPieces} pcs)`,
        });
      }
    } else if (linkerMode === 'create_new') {
      if (!linkerProductName.trim()) {
        toast({
          title: "Product Name Required",
          description: "Please enter a product name for this new inventory item.",
          variant: "destructive"
        });
        return;
      }

      const newLine: BulkLineInput = {
        productId: null,
        variantId: null,
        barcode: linkerPieceBarcode.trim() || `PIECE-${linkerBoxBarcode.trim()}`,
        boxBarcode: isBox ? linkerBoxBarcode.trim() : null,
        pieceBarcode: linkerPieceBarcode.trim() || null,
        boxCount,
        unitsPerBox,
        costPerBox: boxCost,
        isIntakeByBox: isBox,
        productName: linkerProductName.trim(),
        description: linkerDescription.trim() || null,
        sellingPrice,
        cost: pieceCost,
        quantity: totalPieces,
        supplierCompanyOverride: supplierCompany.trim() || null,
        notes: null,
        isVariant: false,
        isNewProduct: true,
        updateProductPriceCost: true
      };
      setItems(prev => [newLine, ...prev]);
      toast({
        title: "New Product Registered",
        description: `Created ${linkerProductName} with ${boxCount} box(es) (${totalPieces} pcs).`,
      });
    } else {
      // Single unit intake (Not a box)
      const isExisting = Boolean(selectedProduct);
      const name = selectedProduct ? selectedProduct.name : linkerProductName.trim();
      if (!name) {
        toast({
          title: "Name Required",
          description: "Please specify a product name.",
          variant: "destructive"
        });
        return;
      }

      const newLine: BulkLineInput = {
        productId: selectedProduct ? selectedProduct.id : null,
        variantId: null,
        barcode: linkerBoxBarcode.trim(),
        boxBarcode: null,
        pieceBarcode: linkerBoxBarcode.trim(),
        boxCount: 0,
        unitsPerBox: 1,
        costPerBox: 0,
        isIntakeByBox: false,
        productName: name,
        description: selectedProduct?.description || linkerDescription.trim() || null,
        sellingPrice: sellingPrice > 0 ? sellingPrice : (selectedProduct?.price || 0),
        cost: pieceCost > 0 ? pieceCost : (selectedProduct?.cost || 0),
        quantity: totalPieces,
        supplierCompanyOverride: supplierCompany.trim() || null,
        notes: null,
        isVariant: false,
        isNewProduct: !isExisting,
        updateProductPriceCost: linkerUpdateMaster
      };
      setItems(prev => [newLine, ...prev]);
      toast({
        title: "Unit Added",
        description: `Added ${name} (+${totalPieces} pc(s))`,
      });
    }

    setShowLinkerModal(false);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  // Add Manual Blank Line (defaults to opening Linker)
  const handleAddManualLine = () => {
    setLinkerBoxBarcode(`BOX-${Date.now().toString().slice(-6)}`);
    setLinkerMode('create_new');
    setLinkerBoxCount(1);
    setLinkerUnitsPerBox(12);
    setLinkerCostPerBox(0);
    setLinkerUnitCost(0);
    setLinkerSellingPrice(0);
    setLinkerPieceBarcode('');
    setLinkerProductName('');
    setLinkerCategory('general');
    setLinkerDescription('');
    setLinkerUpdateMaster(true);
    setSelectedProduct(null);
    setSearchFilter('');
    setShowLinkerModal(true);
  };

  // Line Actions
  const handleRemoveLine = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAdjustBoxOrQty = (index: number, delta: number) => {
    setItems(prev => {
      const next = [...prev];
      const target = next[index];
      if (target.isIntakeByBox) {
        const newBoxCount = Math.max(1, Number(target.boxCount || 1) + delta);
        const packRatio = Number(target.unitsPerBox || 1);
        next[index] = {
          ...target,
          boxCount: newBoxCount,
          quantity: newBoxCount * packRatio
        };
      } else {
        const newQty = Math.max(1, target.quantity + delta);
        next[index] = { ...target, quantity: newQty };
      }
      return next;
    });
  };

  const handleOpenEdit = (index: number) => {
    setEditingIndex(index);
    setEditLine({ ...items[index] });
  };

  const handleSaveEdit = () => {
    if (editingIndex === null || !editLine) return;
    if (!editLine.productName.trim()) {
      toast({ title: "Name Required", description: "Product name cannot be empty", variant: "destructive" });
      return;
    }
    if (editLine.quantity <= 0) {
      toast({ title: "Invalid Quantity", description: "Quantity must be at least 1", variant: "destructive" });
      return;
    }

    setItems(prev => {
      const next = [...prev];
      next[editingIndex] = editLine;
      return next;
    });
    setEditingIndex(null);
    setEditLine(null);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditLine(null);
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  // Final Commit
  const handleConfirmSubmit = async () => {
    if (items.length === 0) {
      toast({ title: "Empty Batch", description: "Please scan or add at least one item", variant: "destructive" });
      return;
    }

    // Validation check across all items
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productName.trim()) {
        toast({ title: "Missing Name", description: `Item #${items.length - i} is missing a product name`, variant: "destructive" });
        return;
      }
      if (it.quantity <= 0) {
        toast({ title: "Invalid Quantity", description: `Item #${items.length - i} quantity must be > 0`, variant: "destructive" });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `idemp-${Date.now()}`;
      const payload = {
        idempotencyKey,
        tenantId: user?.tenantId || '',
        supplierCompany: supplierCompany.trim() || undefined,
        notes: sessionNotes.trim() || undefined,
        items
      };

      await BulkInventoryService.submitBulkInventory(payload);

      toast({
        title: "Inventory Updated",
        description: `Successfully received ${items.length} product(s) (${totalUnits} total units added to retail stock).`,
      });

      // Reset and close
      setItems([]);
      setSupplierCompany('');
      setSessionNotes('');
      setShowSubmitConfirm(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Bulk submission error:', err);
      toast({
        title: "Submission Failed",
        description: err?.message || "Failed to commit bulk inventory",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Totals Calculation
  const totalItemsCount = items.length;
  const totalBoxesCount = items.reduce((sum, item) => sum + (item.isIntakeByBox ? Number(item.boxCount || 0) : 0), 0);
  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalCost = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.cost || 0)), 0);

  // Filtered catalog search for linker modal
  const filteredCatalog = catalogProducts.filter(p => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q));
  }).slice(0, 10);

  if (!isOpen) return null;

  return (
    <LocalizedContent>
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        if (items.length > 0) setShowCancelConfirm(true);
        else onClose();
      }
    }}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        {/* Top Header */}
        <DialogHeader className="p-5 sm:p-6 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex-none">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF8882]/10 dark:bg-[#FF8882]/20 flex items-center justify-center text-[#FF8882]">
                <Boxes className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  Bulk Inventory Intake
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-[#FF8882] border border-[#FF8882]/30">
                    Box & Piece Intake
                  </span>
                </DialogTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Scan outer delivery boxes or piece barcodes to automatically calculate and store retail stock
                </p>
              </div>
            </div>
          </div>

          {/* Supplier & Delivery Info Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={supplierCompany}
                onChange={e => setSupplierCompany(e.target.value)}
                placeholder="Supplier Name / Distributor (Optional)"
                className="pl-9 h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#FF8882]"
              />
            </div>
            <div className="relative">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={sessionNotes}
                onChange={e => setSessionNotes(e.target.value)}
                placeholder="Invoice No. / PO Reference / Remarks (Optional)"
                className="pl-9 h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#FF8882]"
              />
            </div>
          </div>
        </DialogHeader>

        {/* Scanner Bar */}
        <div className="p-3.5 sm:px-6 bg-slate-50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <form onSubmit={handleScanSubmit} className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <ScanLine className={cn(
                "absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400",
                editingIndex === null && "text-[#FF8882]"
              )} />
              <Input
                ref={scanInputRef}
                value={scanValue}
                onChange={e => setScanValue(e.target.value)}
                disabled={editingIndex !== null}
                placeholder="Scan Master Box Barcode or Piece Barcode, then press Enter..."
                className="h-10 pl-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#FF8882] focus:ring-1 focus:ring-[#FF8882]"
              />
            </div>
            <Button
              type="submit"
              disabled={editingIndex !== null || !scanValue.trim()}
              className="h-10 px-4 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white font-medium text-xs shadow-sm transition-all"
            >
              Scan / Enter
            </Button>
          </form>
          <Button
            type="button"
            variant="outline"
            onClick={handleAddManualLine}
            disabled={editingIndex !== null}
            className="h-10 px-3 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-xs flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Manual Box Entry</span>
          </Button>
        </div>

        {/* Continuous Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/30">
          {items.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white/60 dark:bg-slate-900/40">
              <div className="w-12 h-12 rounded-xl bg-[#FF8882]/10 dark:bg-[#FF8882]/20 flex items-center justify-center mb-3 text-[#FF8882]">
                <Package className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No items scanned yet</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mt-1">
                Scan a delivery box barcode to enter its pack size and box count, or scan an individual piece barcode. Added stock is always summarized in retail pieces.
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {items.map((item, idx) => {
                const lineNumber = items.length - idx;
                const lineTotalCost = Number(item.quantity || 0) * Number(item.cost || 0);

                return (
                  <motion.div
                    key={`${item.barcode}-${idx}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    {/* Item Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                          #{lineNumber}
                        </span>

                        {item.isIntakeByBox ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40 flex items-center gap-1">
                            <Boxes className="w-3 h-3" />
                            {item.boxCount} Box(es) @ {item.unitsPerBox} pcs/box
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40">
                            Piece Intake
                          </span>
                        )}

                        {item.isNewProduct && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                            New Item
                          </span>
                        )}

                        {item.boxBarcode && (
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">
                            Box: {item.boxBarcode}
                          </span>
                        )}
                        {item.pieceBarcode && (
                          <span className="text-[11px] font-mono text-slate-400">
                            Piece: {item.pieceBarcode}
                          </span>
                        )}
                      </div>

                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                        {item.productName || 'Untitled Item'}
                      </h4>

                      {item.supplierCompanyOverride && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Supplier: <span className="font-medium text-slate-700 dark:text-slate-300">{item.supplierCompanyOverride}</span>
                        </p>
                      )}
                    </div>

                    {/* Numeric Controls & Values */}
                    <div className="flex items-center gap-4 sm:gap-6 justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-slate-700/60">
                      {/* Quantity Stepper (Increments by Box if Box Intake, or Piece if Piece Intake) */}
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-medium text-slate-400 block mb-0.5">
                          {item.isIntakeByBox ? "Boxes Received" : "Pieces"}
                        </span>
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900/60 p-1 rounded-lg border border-slate-200/80 dark:border-slate-700/60">
                          <button
                            type="button"
                            onClick={() => handleAdjustBoxOrQty(idx, -1)}
                            aria-label={`Decrease ${item.isIntakeByBox ? 'box' : 'piece'} quantity for ${item.productName}`}
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-bold text-slate-900 dark:text-white min-w-[28px] text-center">
                            {item.isIntakeByBox ? item.boxCount : item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAdjustBoxOrQty(idx, 1)}
                            aria-label={`Increase ${item.isIntakeByBox ? 'box' : 'piece'} quantity for ${item.productName}`}
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Total Pieces Added */}
                      <div className="text-right">
                        <span className="text-[10px] font-medium text-slate-400 block">Stock Added</span>
                        <span className="text-xs font-bold text-[#FF8882]">+{item.quantity} pcs</span>
                      </div>

                      {/* Cost */}
                      <div className="text-right">
                        <span className="text-[10px] font-medium text-slate-400 block">Cost / Piece</span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">₱{Number(item.cost).toFixed(2)}</span>
                      </div>

                      {/* Selling Price */}
                      <div className="text-right">
                        <span className="text-[10px] font-medium text-slate-400 block">Retail / Piece</span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">₱{Number(item.sellingPrice).toFixed(2)}</span>
                      </div>

                      {/* Subtotal */}
                      <div className="text-right min-w-[64px]">
                        <span className="text-[10px] font-medium text-slate-400 block">Line Cost</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">₱{lineTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 pl-1 border-l border-slate-200/80 dark:border-slate-700/60">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(idx)}
                          className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveLine(idx)}
                          className="h-8 w-8 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Bottom Summary Bar & Commit Action */}
        <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-none flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-around sm:justify-start">
            <div>
              <span className="text-[10px] font-medium text-slate-400 block">Total Items</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{totalItemsCount}</span>
            </div>
            {totalBoxesCount > 0 && (
              <>
                <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
                <div>
                  <span className="text-[10px] font-medium text-slate-400 block">Total Boxes</span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{totalBoxesCount} boxes</span>
                </div>
              </>
            )}
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div>
              <span className="text-[10px] font-medium text-slate-400 block">Total Retail Pieces</span>
              <span className="text-sm font-bold text-[#FF8882]">+{totalUnits} pcs</span>
            </div>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div>
              <span className="text-[10px] font-medium text-slate-400 block">Estimated Batch Cost</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">₱{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (items.length > 0) setShowCancelConfirm(true);
                else onClose();
              }}
              className="flex-1 sm:flex-none h-10 px-4 rounded-xl border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
            >
              Clear Session
            </Button>
            <Button
              type="button"
              disabled={items.length === 0 || isSubmitting}
              onClick={() => setShowSubmitConfirm(true)}
              className="flex-1 sm:flex-none h-10 px-5 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white font-medium text-xs shadow-sm transition-all"
            >
              {isSubmitting ? 'Saving...' : 'Save to Inventory'}
            </Button>
          </div>
        </div>

        {/* Master Box Breakdown & Product Linker Modal */}
        <Dialog open={showLinkerModal} onOpenChange={setShowLinkerModal}>
          <DialogContent className="rounded-2xl p-6 max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader className="flex-none">
              <div className="flex items-center gap-2 mb-1">
                <span className="p-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600">
                  <Boxes className="w-4 h-4" />
                </span>
                <DialogTitle className="text-base font-semibold">
                  Box Breakdown & Barcode Linker
                </DialogTitle>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Barcode <strong className="font-mono text-slate-800 dark:text-slate-200">{linkerBoxBarcode}</strong> was scanned. Specify the pieces inside the box and link to your retail item.
              </p>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-4 py-3 pr-1">
              {/* Intake Mode Switcher */}
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setLinkerMode('link_existing')}
                  className={cn(
                    "py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5",
                    linkerMode === 'link_existing'
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-semibold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  )}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Link Existing Item</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLinkerMode('create_new')}
                  className={cn(
                    "py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5",
                    linkerMode === 'create_new'
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-semibold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Register New Item</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLinkerMode('single_unit')}
                  className={cn(
                    "py-2 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5",
                    linkerMode === 'single_unit'
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-semibold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  )}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Single Piece (Not a Box)</span>
                </button>
              </div>

              {/* Box Breakdown Math Card (Only for Box Intakes) */}
              {linkerMode !== 'single_unit' && (
                <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                      <Boxes className="w-4 h-4 text-amber-600" />
                      Box Pack Ratio & Delivery Breakdown
                    </span>
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                      Total Added: {linkerBoxCount * linkerUnitsPerBox} pcs
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Boxes Received</Label>
                      <Input
                        type="number"
                        min="1"
                        value={linkerBoxCount}
                        onChange={e => setLinkerBoxCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-xs font-bold"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Pieces in 1 Box</Label>
                      <Input
                        type="number"
                        min="1"
                        value={linkerUnitsPerBox}
                        onChange={e => setLinkerUnitsPerBox(Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-xs font-bold"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Cost per Box (₱)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={linkerCostPerBox}
                        onChange={e => setLinkerCostPerBox(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="h-8 bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Calculated Unit Cost</Label>
                      <div className="h-8 px-2.5 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-md flex items-center text-xs font-semibold text-slate-800 dark:text-slate-200">
                        ₱{linkerUnitCost.toFixed(2)}/pc
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Mode A: Link to Existing Product */}
              {linkerMode === 'link_existing' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Search inside item by Name or Scan Inner Piece Barcode:
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        value={searchFilter}
                        onChange={e => setSearchFilter(e.target.value)}
                        placeholder="Search product name or piece barcode (e.g. Downy)..."
                        className="pl-9 h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                      />
                    </div>
                  </div>

                  {/* Search / Selection Result List */}
                  <div className="max-h-40 overflow-y-auto space-y-1.5 p-1 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/30">
                    {filteredCatalog.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        No matching catalog products found. Try registering as a new item.
                      </div>
                    ) : (
                      filteredCatalog.map(prod => {
                        const isSelected = selectedProduct?.id === prod.id;
                        return (
                          <div
                            key={prod.id}
                            onClick={() => {
                              setSelectedProduct(prod);
                              setLinkerSellingPrice(prod.price);
                              if (prod.cost && prod.cost > 0 && linkerCostPerBox === 0) {
                                setLinkerCostPerBox(prod.cost * linkerUnitsPerBox);
                              }
                            }}
                            className={cn(
                              "p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between text-xs",
                              isSelected 
                                ? "bg-[#FF8882]/10 border-[#FF8882] text-slate-900 dark:text-white font-medium" 
                                : "bg-white dark:bg-slate-800 border-slate-200/80 dark:border-slate-700/60 hover:border-slate-300"
                            )}
                          >
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-white">{prod.name}</div>
                              <div className="text-[10px] text-slate-500 font-mono">Barcode: {prod.barcode || 'N/A'} • Current Stock: {prod.quantity} pcs</div>
                            </div>
                            <div className="text-right flex items-center gap-2">
                              <span className="font-bold text-slate-800 dark:text-slate-200">₱{Number(prod.price).toFixed(2)}</span>
                              {isSelected && <CheckCircle2 className="w-4 h-4 text-[#FF8882]" />}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {selectedProduct && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Retail Selling Price per Piece (₱)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={linkerSellingPrice}
                          onChange={e => setLinkerSellingPrice(parseFloat(e.target.value) || 0)}
                          className="h-9 bg-white dark:bg-slate-800 text-xs font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Piece Cost Override (₱)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={linkerUnitCost}
                          onChange={e => setLinkerUnitCost(parseFloat(e.target.value) || 0)}
                          className="h-9 bg-white dark:bg-slate-800 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mode B: Register New Item */}
              {linkerMode === 'create_new' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Product Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={linkerProductName}
                      onChange={e => setLinkerProductName(e.target.value)}
                      placeholder="e.g. Downy Sunrise Fresh 20ml Sachet"
                      className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Inner Piece Barcode (Optional)</Label>
                      <Input
                        value={linkerPieceBarcode}
                        onChange={e => setLinkerPieceBarcode(e.target.value)}
                        placeholder="Scan piece barcode inside box"
                        className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Retail Selling Price per Piece (₱)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={linkerSellingPrice}
                        onChange={e => setLinkerSellingPrice(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-[#FF8882]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Mode C: Single Unit Intake */}
              {linkerMode === 'single_unit' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Product Name</Label>
                    <Input
                      value={linkerProductName}
                      onChange={e => setLinkerProductName(e.target.value)}
                      placeholder="e.g. Coca-Cola 1.5L"
                      className="h-9 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={linkerBoxCount}
                        onChange={e => setLinkerBoxCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-9 bg-white dark:bg-slate-800 text-xs font-semibold"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Cost Price (₱)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={linkerUnitCost}
                        onChange={e => setLinkerUnitCost(parseFloat(e.target.value) || 0)}
                        className="h-9 bg-white dark:bg-slate-800 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Selling Price (₱)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={linkerSellingPrice}
                        onChange={e => setLinkerSellingPrice(parseFloat(e.target.value) || 0)}
                        className="h-9 bg-white dark:bg-slate-800 text-xs font-bold text-[#FF8882]"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="linkerMasterPriceCheck"
                  checked={linkerUpdateMaster}
                  onChange={e => setLinkerUpdateMaster(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-[#FF8882] focus:ring-0"
                />
                <label htmlFor="linkerMasterPriceCheck" className="text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                  Remember box mapping & update catalog price/cost for future scans
                </label>
              </div>
            </div>

            <DialogFooter className="mt-3 flex gap-2 flex-none border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowLinkerModal(false)}
                className="flex-1 h-9 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmLinker}
                className="flex-1 h-9 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white text-xs font-medium"
              >
                Confirm & Add to Session
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Line Dialog */}
        <Dialog open={editingIndex !== null} onOpenChange={(open) => { if (!open) handleCancelEdit(); }}>
          <DialogContent className="rounded-2xl p-6 max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-xl">
            <DialogHeader className="mb-3">
              <DialogTitle className="text-base font-semibold">
                Edit Item Details
              </DialogTitle>
            </DialogHeader>

            {editLine && (
              <div className="space-y-3.5">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Product Name</Label>
                  <Input
                    value={editLine.productName}
                    onChange={e => setEditLine({ ...editLine, productName: e.target.value })}
                    className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {editLine.isIntakeByBox ? "Box Count" : "Quantity"}
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={editLine.isIntakeByBox ? editLine.boxCount : editLine.quantity}
                      onChange={e => {
                        const val = Math.max(1, parseInt(e.target.value) || 1);
                        if (editLine.isIntakeByBox) {
                          const pack = Number(editLine.unitsPerBox || 1);
                          setEditLine({ ...editLine, boxCount: val, quantity: val * pack });
                        } else {
                          setEditLine({ ...editLine, quantity: val });
                        }
                      }}
                      className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-[#FF8882]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Total Pieces Added</Label>
                    <div className="h-9 px-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center text-xs font-bold text-slate-800 dark:text-slate-200">
                      +{editLine.quantity} pcs
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Unit Cost (₱)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editLine.cost}
                      onChange={e => setEditLine({ ...editLine, cost: parseFloat(e.target.value) || 0 })}
                      className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Selling Price (₱)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editLine.sellingPrice}
                      onChange={e => setEditLine({ ...editLine, sellingPrice: parseFloat(e.target.value) || 0 })}
                      className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">Supplier Override (Optional)</Label>
                  <Input
                    value={editLine.supplierCompanyOverride || ''}
                    onChange={e => setEditLine({ ...editLine, supplierCompanyOverride: e.target.value })}
                    placeholder="Defaults to session supplier"
                    className="h-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                  />
                </div>

                <div className="pt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="updatePriceCostCheck"
                    checked={editLine.updateProductPriceCost}
                    onChange={e => setEditLine({ ...editLine, updateProductPriceCost: e.target.checked })}
                    className="w-3.5 h-3.5 rounded text-[#FF8882] focus:ring-0"
                  />
                  <label htmlFor="updatePriceCostCheck" className="text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                    Update master catalog price and cost with these values
                  </label>
                </div>
              </div>
            )}

            <DialogFooter className="mt-5 flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelEdit}
                className="flex-1 h-9 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 h-9 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white text-xs font-medium"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Discard Confirmation Dialog */}
        <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
          <AlertDialogContent className="rounded-2xl p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base font-semibold">Discard Bulk Inventory Session?</AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                You have {items.length} pending items in this session. Discarding will clear the list without making changes to the database.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 flex gap-2">
              <AlertDialogCancel className="flex-1 h-9 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-medium">
                Keep Editing
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setItems([]);
                  setShowCancelConfirm(false);
                  onClose();
                }}
                className="flex-1 h-9 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
              >
                Discard Session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Submit Confirmation Dialog */}
        <AlertDialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
          <AlertDialogContent className="rounded-2xl p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl">
            <AlertDialogHeader>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-2 mx-auto">
                <PackageCheck className="w-5 h-5" />
              </div>
              <AlertDialogTitle className="text-base font-semibold text-center">
                Confirm Inventory Update
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Are you ready to commit <strong className="text-slate-800 dark:text-slate-200">{totalItemsCount} product(s)</strong> {totalBoxesCount > 0 ? `(${totalBoxesCount} boxes · ${totalUnits} total pcs)` : `(${totalUnits} units)`} totaling <strong className="text-slate-900 dark:text-white">₱{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong> to your retail inventory?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 flex gap-2">
              <AlertDialogCancel className="flex-1 h-9 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-medium">
                Review Items
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
                className="flex-1 h-9 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white text-xs font-medium"
              >
                {isSubmitting ? 'Saving...' : 'Confirm & Commit'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
    </LocalizedContent>
  );
};
