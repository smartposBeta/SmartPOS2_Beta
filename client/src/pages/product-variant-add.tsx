import React, { useState, useEffect, useRef } from 'react';
import Layout from '@/components/Layout';
import ProductImage from '@/components/ProductImage';
import { useLocation, useRoute } from 'wouter';
import { 
  ArrowLeft, 
  Plus, 
  Image as ImageIcon, 
  Sparkles, 
  Package, 
  Barcode, 
  DollarSign, 
  Layers, 
  Search, 
  CheckCircle2, 
  X, 
  TrendingUp, 
  Boxes,
  UploadCloud,
  RefreshCw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ProductService, db } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Product } from '@shared/schema';

export default function ProductVariantAdd() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Route matches (supports both tenant-prefixed and direct routes)
  const [matchWithId, paramsWithId] = useRoute('/inventory/product/:id/variant/add');
  const [matchTenantWithId, paramsTenantWithId] = useRoute('/store/:tenant/inventory/product/:id/variant/add');
  
  const urlProductId = (matchWithId ? paramsWithId?.id : undefined) || 
                       (matchTenantWithId ? paramsTenantWithId?.id : undefined);

  // State
  const [selectedProductId, setSelectedProductId] = useState<string>(urlProductId || '');
  const [parentProduct, setParentProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);

  // Form Fields
  const [variantName, setVariantName] = useState('');
  const [price, setPrice] = useState<string>('');
  const [cost, setCost] = useState<string>('');
  const [stock, setStock] = useState<string>('0');
  const [barcode, setBarcode] = useState('');
  const [boxBarcode, setBoxBarcode] = useState('');
  const [unitsPerBox, setUnitsPerBox] = useState('1');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load all products for selection & parent product details
  useEffect(() => {
    ProductService.getAllProducts().then(prods => {
      setAllProducts(prods || []);
    });
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      db.products.get(selectedProductId).then(p => {
        if (p) {
          setParentProduct(p);
          // Set default cost/price based on parent if empty
          if (!price) setPrice(String(p.price || ''));
          if (!cost) setCost(String(p.cost || ''));
        }
      });
    } else {
      setParentProduct(null);
    }
  }, [selectedProductId]);

  // Image Upload Handlers
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast({ title: 'Image Too Large', description: 'Please select an image smaller than 2MB', variant: 'destructive' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateBarcode = () => {
    const randomCode = `VAR-${Date.now().toString().slice(-6)}`;
    setBarcode(randomCode);
    toast({ title: "Barcode Generated", description: `Assigned: ${randomCode}` });
  };

  // Profit Margin Calculation
  const numPrice = parseFloat(price) || 0;
  const numCost = parseFloat(cost) || 0;
  const profitMargin = numPrice > 0 ? (((numPrice - numCost) / numPrice) * 100).toFixed(1) : '0';

  const handleSave = async (stayOnPage = false) => {
    if (!selectedProductId) {
      toast({
        title: "Product Required",
        description: "Please select an existing master product for this variant.",
        variant: "destructive"
      });
      return;
    }

    if (!variantName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a variant name (e.g. 500g, Medium, Red).",
        variant: "destructive"
      });
      return;
    }

    if (numPrice <= 0) {
      toast({
        title: "Invalid Price",
        description: "Selling price must be greater than 0.",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      await ProductService.addVariant(selectedProductId, {
        name: variantName.trim(),
        price: numPrice,
        cost: numCost,
        quantity: Math.max(0, parseInt(stock) || 0),
        barcode: barcode.trim() || undefined,
        boxBarcode: boxBarcode.trim() || undefined,
        unitsPerBox: Math.max(1, parseInt(unitsPerBox) || 1),
        boxCost: numCost * Math.max(1, parseInt(unitsPerBox) || 1),
        image: imagePreview || undefined,
      });

      toast({
        title: "Variant Added",
        description: `Successfully added "${variantName}" to ${parentProduct?.name || 'product'}.`,
      });

      if (stayOnPage) {
        setVariantName('');
        setBarcode('');
        setStock('0');
        setImagePreview(null);
      } else {
        setLocation(`/inventory/product/${selectedProductId}`);
      }
    } catch (err: any) {
      console.error('Failed to add variant:', err);
      toast({
        title: "Save Failed",
        description: err?.message || "Failed to add product variant",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter products for dropdown/search
  const filteredProducts = allProducts.filter(p => {
    if (!productSearch.trim()) return true;
    const q = productSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.toLowerCase().includes(q));
  }).slice(0, 8);

  return (
    <Layout>
      {/* Top Sticky Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-4 sticky top-0 z-10 shadow-xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (selectedProductId) setLocation(`/inventory/product/${selectedProductId}`);
                else setLocation('/inventory');
              }}
              className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-xs"
              title="Back to Products"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Add Product Variant</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#FF8882]/10 text-[#FF8882] border border-[#FF8882]/20">
                  New Variant
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {parentProduct ? `Create a size, weight, flavor, or pack variant for ${parentProduct.name}` : "Link a new variant to an existing catalog item"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (selectedProductId) setLocation(`/inventory/product/${selectedProductId}`);
                else setLocation('/inventory');
              }}
              className="h-9 px-3.5 rounded-xl border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSaving}
              onClick={() => handleSave(false)}
              className="h-9 px-4 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white text-xs font-semibold shadow-sm transition-all"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Variant'
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Form Content */}
      <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-6">
        {/* Parent Product Selector (Only if not fixed by URL or allowed to change) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Package className="w-4 h-4 text-[#FF8882]" />
              Master Parent Product
            </Label>
            {parentProduct && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsSearchingProduct(!isSearchingProduct)}
                className="h-7 text-xs text-[#FF8882] hover:text-[#ff7770] hover:bg-[#FF8882]/10"
              >
                {isSearchingProduct ? 'Done Changing' : 'Change Parent Product'}
              </Button>
            )}
          </div>

          {parentProduct && !isSearchingProduct ? (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-slate-900 dark:text-white">{parentProduct.name}</h3>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  <span>Barcode: {parentProduct.barcode || 'N/A'}</span>
                  <span>•</span>
                  <span>Category: {parentProduct.category || 'general'}</span>
                  <span>•</span>
                  <span>Base Price: ₱{Number(parentProduct.price).toFixed(2)}</span>
                </div>
              </div>
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800/50">
                Parent Linked
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Search catalog product to attach this variant to..."
                  className="pl-9 h-10 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1 p-1 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/30">
                {filteredProducts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    No products found. Please add a product in Inventory first.
                  </div>
                ) : (
                  filteredProducts.map(p => (
                    <div
                      key={p.id}
                      onClick={() => {
                        setSelectedProductId(p.id);
                        setIsSearchingProduct(false);
                      }}
                      className={cn(
                        "p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between text-xs",
                        selectedProductId === p.id
                          ? "bg-[#FF8882]/10 border-[#FF8882] text-slate-900 dark:text-white font-medium"
                          : "bg-white dark:bg-slate-800 border-slate-200/80 dark:border-slate-700/60 hover:border-slate-300"
                      )}
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">{p.name}</span>
                        <span className="text-[10px] text-slate-500 ml-2 font-mono">{p.barcode || 'No barcode'}</span>
                      </div>
                      <span className="font-bold text-slate-800 dark:text-slate-200">₱{Number(p.price).toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* 2-Column Main Form Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Image Upload Card */}
          <div className="md:col-span-4 space-y-3">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col items-center text-center">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 self-start">
                Variant Image
              </Label>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-square max-w-[200px] rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-[#FF8882] bg-slate-50 dark:bg-slate-800/40 flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden relative group"
              >
                {imagePreview ? (
                  <>
                    <ProductImage
                      src={imagePreview}
                      alt="Variant preview"
                      className="h-full w-full"
                      fallbackLabel="Image unavailable"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-medium">
                      Click to Change
                    </div>
                  </>
                ) : (
                  <div className="p-4 flex flex-col items-center text-slate-400 group-hover:text-[#FF8882] transition-colors">
                    <UploadCloud className="w-8 h-8 mb-2" />
                    <span className="text-xs font-semibold">Upload Photo</span>
                    <span className="text-[10px] text-slate-400 mt-1">PNG, JPG up to 2MB</span>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />

              {imagePreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImagePreview(null);
                  }}
                  className="mt-2.5 h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  <X className="w-3 h-3 mr-1" />
                  Remove Image
                </Button>
              )}
            </div>

            {/* Profit Insight Card */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-[#FF8882]/10 to-rose-50/50 dark:from-slate-900 dark:to-slate-800/80 border border-[#FF8882]/20 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 font-medium flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-[#FF8882]" />
                  Profit Margin
                </span>
                <span className="font-bold text-slate-900 dark:text-white">{profitMargin}%</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Profit per unit: <strong className="text-slate-800 dark:text-slate-200">₱{(Math.max(0, numPrice - numCost)).toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {/* Right Column: Variant Fields */}
          <div className="md:col-span-8 space-y-4">
            <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Variant Option Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={variantName}
                  onChange={e => setVariantName(e.target.value)}
                  placeholder="e.g., 500g, 1 Liter, Small, Chocolate Flavor, Pack of 6"
                  className="h-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:border-[#FF8882]"
                />
              </div>

              {/* Price & Cost Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Retail Selling Price (₱) <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                      placeholder="0.00"
                      className="pl-9 h-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-[#FF8882]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Wholesale / Unit Cost (₱)
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="number"
                      step="0.01"
                      value={cost}
                      onChange={e => setCost(e.target.value)}
                      placeholder="0.00"
                      className="pl-9 h-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Stock & Barcode Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Initial Stock Quantity (Pieces)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={stock}
                    onChange={e => setStock(e.target.value)}
                    className="h-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Variant Barcode
                    </Label>
                    <button
                      type="button"
                      onClick={handleGenerateBarcode}
                      className="text-[10px] text-[#FF8882] hover:underline font-medium"
                    >
                      Generate Code
                    </button>
                  </div>
                  <div className="relative">
                    <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      value={barcode}
                      onChange={e => setBarcode(e.target.value)}
                      placeholder="Scan or type piece barcode"
                      className="pl-9 h-10 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Master Box Fields (Optional Pack Ratio) */}
              <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 space-y-2.5">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-amber-500" />
                  Master Box / Carton Link (Optional)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Outer Box Barcode</Label>
                    <Input
                      value={boxBarcode}
                      onChange={e => setBoxBarcode(e.target.value)}
                      placeholder="e.g. Master carton barcode"
                      className="h-8 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Pieces in 1 Box</Label>
                    <Input
                      type="number"
                      min="1"
                      value={unitsPerBox}
                      onChange={e => setUnitsPerBox(e.target.value)}
                      placeholder="1"
                      className="h-8 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => handleSave(true)}
                  className="h-9 px-3.5 rounded-xl border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Save & Add Another
                </Button>

                <Button
                  type="button"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => handleSave(false)}
                  className="h-9 px-5 rounded-xl bg-[#FF8882] hover:bg-[#ff7770] text-white text-xs font-semibold shadow-sm transition-all"
                >
                  {isSaving ? 'Saving...' : 'Save & View Product'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
