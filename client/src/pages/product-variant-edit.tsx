import React, { useState, useEffect, useRef } from 'react';
import Layout from '@/components/Layout';
import ProductImage from '@/components/ProductImage';
import { useLocation, useRoute } from 'wouter';
import { 
  ArrowLeft, 
  Image as ImageIcon, 
  Sparkles, 
  Package, 
  Barcode, 
  DollarSign, 
  Layers, 
  CheckCircle2, 
  X, 
  TrendingUp, 
  Boxes,
  UploadCloud,
  RefreshCw,
  Save
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ProductService, db } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Product, Variant } from '@shared/schema';

export default function ProductVariantEdit() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Route matches (supports both tenant-prefixed and direct routes)
  const [matchDirect, paramsDirect] = useRoute('/inventory/product/:id/variant/edit/:variantId');
  const [matchTenant, paramsTenant] = useRoute('/store/:tenant/inventory/product/:id/variant/edit/:variantId');
  
  const productId = (matchDirect ? paramsDirect?.id : undefined) || (matchTenant ? paramsTenant?.id : undefined);
  const variantId = (matchDirect ? paramsDirect?.variantId : undefined) || (matchTenant ? paramsTenant?.variantId : undefined);

  // Parent Product State
  const [parentProduct, setParentProduct] = useState<Product | null>(null);
  const [currentVariant, setCurrentVariant] = useState<Variant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  // Load variant & parent product
  useEffect(() => {
    (async () => {
      if (!variantId) {
        setIsLoading(false);
        return;
      }
      try {
        const v = await ProductService.getVariantById(variantId);
        if (v) {
          setCurrentVariant(v);
          setVariantName(v.name || '');
          setPrice(String(v.price ?? ''));
          setCost(String(v.cost ?? ''));
          setStock(String((v as any).quantity ?? 0));
          setBarcode(v.barcode || '');
          setBoxBarcode((v as any).boxBarcode || (v as any).box_barcode || '');
          setUnitsPerBox(String((v as any).unitsPerBox || (v as any).units_per_box || 1));
          setImagePreview(v.image || null);

          // Fetch parent
          const pId = productId || (v as any).productId || (v as any).product_id;
          if (pId) {
            const p = await db.products.get(pId);
            if (p) setParentProduct(p);
          }
        }
      } catch (error) {
        console.error('Failed to load variant', error);
        toast({ title: 'Error', description: 'Failed to load variant details', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [variantId, productId]);

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
    toast({ title: 'Barcode Generated', description: `Generated SKU: ${randomCode}` });
  };

  // Calculations
  const numPrice = parseFloat(price) || 0;
  const numCost = parseFloat(cost) || 0;
  const profit = numPrice - numCost;
  const marginPct = numPrice > 0 ? ((profit / numPrice) * 100).toFixed(1) : '0';

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!variantName.trim()) {
      toast({ title: 'Validation Error', description: 'Please enter a variant name', variant: 'destructive' });
      return;
    }
    if (!variantId) {
      toast({ title: 'Error', description: 'Variant ID missing', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      await ProductService.updateVariant(variantId, {
        name: variantName.trim(),
        price: numPrice,
        cost: numCost,
        quantity: Math.max(0, parseInt(stock) || 0),
        barcode: barcode.trim() || undefined,
        boxBarcode: boxBarcode.trim() || undefined,
        unitsPerBox: Math.max(1, parseInt(unitsPerBox) || 1),
        image: imagePreview || undefined,
      });

      toast({
        title: 'Variant Updated',
        description: `Successfully updated variant "${variantName}"`,
      });

      // Navigate back to product details or inventory
      const effectiveProductId = productId || (currentVariant as any)?.productId || (currentVariant as any)?.product_id;
      if (effectiveProductId) {
        setLocation(`/inventory/product/${effectiveProductId}`);
      } else {
        setLocation('/inventory');
      }
    } catch (error: any) {
      console.error('Failed to update variant:', error);
      toast({
        title: 'Save Failed',
        description: error?.message || 'Could not update variant. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <RefreshCw className="w-8 h-8 text-[#FF8882] animate-spin" />
          <p className="text-sm font-medium text-gray-500">Loading variant information...</p>
        </div>
      </Layout>
    );
  }

  const backUrl = productId ? `/inventory/product/${productId}` : '/inventory';

  return (
    <Layout>
      <div className="min-h-screen bg-slate-50/60 dark:bg-gray-950 pb-20">
        {/* Top Header Sticky Bar */}
        <div className="sticky top-0 z-20 backdrop-blur-md bg-white/90 dark:bg-gray-900/90 border-b border-gray-100 dark:border-gray-800 shadow-sm transition-all">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation(backUrl)}
                className="h-9 w-9 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                    Edit Variant
                  </h1>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/50">
                    ID: {variantId?.slice(0, 8)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {parentProduct ? `For base product: ${parentProduct.name}` : 'Update SKU specifications, pricing, and stock'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(backUrl)}
                className="h-9 rounded-xl text-xs font-medium border-gray-200 dark:border-gray-700"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => handleSave()}
                disabled={isSaving}
                className="h-9 px-4 rounded-xl text-xs font-semibold bg-[#FF8882] hover:bg-[#ff756f] text-white shadow-sm shadow-[#FF8882]/20 flex items-center gap-1.5"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save Changes</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Content Container */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
          <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Image & Profit Overview */}
            <div className="lg:col-span-4 space-y-5">
              {/* Photo Box */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
                <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center justify-between">
                  <span>Variant Image</span>
                  {imagePreview && (
                    <button
                      type="button"
                      onClick={() => setImagePreview(null)}
                      className="text-[11px] text-red-500 hover:text-red-600 font-medium flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Remove
                    </button>
                  )}
                </Label>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "group relative aspect-square rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden flex flex-col items-center justify-center text-center p-4",
                    imagePreview
                      ? "border-transparent bg-gray-50 dark:bg-gray-800/50"
                      : "border-gray-200 dark:border-gray-700 hover:border-[#FF8882] dark:hover:border-[#FF8882] bg-gray-50/50 dark:bg-gray-800/20"
                  )}
                >
                  {imagePreview ? (
                    <>
                      <ProductImage
                        src={imagePreview}
                        alt="Variant preview"
                        className="h-full w-full"
                        imageClassName="transition-transform duration-300 group-hover:scale-105"
                        fallbackLabel="Image unavailable"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-1.5 p-2">
                        <UploadCloud className="w-6 h-6" />
                        <span className="text-xs font-medium">Click to change photo</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-gray-400 group-hover:text-[#FF8882] transition-colors">
                      <div className="w-12 h-12 rounded-2xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Upload Photo</p>
                        <p className="text-[11px] text-gray-400">PNG, JPG up to 2MB</p>
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Profit & Margin Calculator Card */}
              <div className="bg-gradient-to-br from-[#FF8882]/5 via-white to-amber-50/30 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 rounded-2xl p-5 border border-[#FF8882]/20 dark:border-gray-800 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FF8882]/10 text-[#FF8882] flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                    Profit & Margin
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-white/80 dark:bg-gray-800/80 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                    <span className="text-[11px] text-gray-400 font-medium block">Est. Profit / Unit</span>
                    <span className={cn(
                      "text-base font-bold",
                      profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
                    )}>
                      ₱{profit.toFixed(2)}
                    </span>
                  </div>

                  <div className="bg-white/80 dark:bg-gray-800/80 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                    <span className="text-[11px] text-gray-400 font-medium block">Margin Ratio</span>
                    <span className={cn(
                      "text-base font-bold",
                      parseFloat(marginPct) > 0 ? "text-[#FF8882]" : "text-gray-400"
                    )}>
                      {marginPct}%
                    </span>
                  </div>
                </div>

                {parentProduct && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                    <span>Base product price:</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-200">₱{Number(parentProduct.price || 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Variant Form Inputs */}
            <div className="lg:col-span-8 space-y-5">
              
              {/* Parent Product Info Card */}
              {parentProduct && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200/50 dark:border-orange-800/50 flex items-center justify-center font-bold text-sm">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-medium">Base Product</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{parentProduct.name}</p>
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium">
                    Category: {parentProduct.category || 'General'}
                  </span>
                </div>
              )}

              {/* Primary Variant Details */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 shadow-sm space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
                  <Layers className="w-4 h-4 text-[#FF8882]" />
                  <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                    Variant Identity
                  </h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="variant-name" className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      Variant Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="variant-name"
                      value={variantName}
                      onChange={(e) => setVariantName(e.target.value)}
                      placeholder="e.g. 500ml, XL Size, Spicy Flavor, Red Pack"
                      className="mt-1.5 h-11 rounded-xl border-gray-200 dark:border-gray-700 focus:border-[#FF8882] focus:ring-[#FF8882] text-sm"
                      required
                    />
                  </div>

                  {/* Pricing and Stock Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="variant-price" className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Selling Price (₱) <span className="text-red-500">*</span>
                      </Label>
                      <div className="relative mt-1.5">
                        <DollarSign className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="variant-price"
                          type="number"
                          step="0.01"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder="0.00"
                          className="pl-9 h-11 rounded-xl border-gray-200 dark:border-gray-700 focus:border-[#FF8882] focus:ring-[#FF8882] text-sm font-medium"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="variant-cost" className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Cost Price (₱)
                      </Label>
                      <div className="relative mt-1.5">
                        <DollarSign className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="variant-cost"
                          type="number"
                          step="0.01"
                          value={cost}
                          onChange={(e) => setCost(e.target.value)}
                          placeholder="0.00"
                          className="pl-9 h-11 rounded-xl border-gray-200 dark:border-gray-700 focus:border-[#FF8882] focus:ring-[#FF8882] text-sm font-medium"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="variant-stock" className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Initial Stock (Units)
                      </Label>
                      <div className="relative mt-1.5">
                        <Package className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="variant-stock"
                          type="number"
                          step="1"
                          min="0"
                          value={stock}
                          onChange={(e) => setStock(e.target.value)}
                          placeholder="0"
                          className="pl-9 h-11 rounded-xl border-gray-200 dark:border-gray-700 focus:border-[#FF8882] focus:ring-[#FF8882] text-sm font-medium"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Barcode & Packaging Specification */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 shadow-sm space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
                  <Barcode className="w-4 h-4 text-[#FF8882]" />
                  <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                    Barcoding & Bulk Packaging
                  </h3>
                </div>

                <div className="space-y-4">
                  {/* Retail Barcode */}
                  <div>
                    <Label htmlFor="variant-barcode" className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center justify-between">
                      <span>Retail Barcode / SKU</span>
                      <button
                        type="button"
                        onClick={handleGenerateBarcode}
                        className="text-[11px] font-semibold text-[#FF8882] hover:text-[#ff756f] flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3" /> Auto-Generate SKU
                      </button>
                    </Label>
                    <div className="relative mt-1.5">
                      <Barcode className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        id="variant-barcode"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value)}
                        placeholder="Scan or enter barcode"
                        className="pl-9 h-11 rounded-xl border-gray-200 dark:border-gray-700 focus:border-[#FF8882] focus:ring-[#FF8882] text-sm font-mono"
                      />
                    </div>
                  </div>

                  {/* Master Box / Bulk Packaging */}
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-3">
                      <Boxes className="w-4 h-4 text-blue-500" />
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                        Box / Master Carton Packaging (Optional)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="box-barcode" className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Outer Box Barcode
                        </Label>
                        <Input
                          id="box-barcode"
                          value={boxBarcode}
                          onChange={(e) => setBoxBarcode(e.target.value)}
                          placeholder="Box barcode on delivery carton"
                          className="mt-1 h-10 rounded-xl border-gray-200 dark:border-gray-700 text-xs font-mono"
                        />
                      </div>

                      <div>
                        <Label htmlFor="units-per-box" className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Units inside 1 Box
                        </Label>
                        <Input
                          id="units-per-box"
                          type="number"
                          min="1"
                          value={unitsPerBox}
                          onChange={(e) => setUnitsPerBox(e.target.value)}
                          placeholder="1"
                          className="mt-1 h-10 rounded-xl border-gray-200 dark:border-gray-700 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Action Footer */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation(backUrl)}
                  className="h-11 px-5 rounded-xl text-xs font-semibold border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="h-11 px-6 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#FF8882] hover:bg-[#ff756f] text-white shadow-md shadow-[#FF8882]/20 flex items-center gap-2"
                >
                  {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>Save Variant</span>
                </Button>
              </div>

            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
