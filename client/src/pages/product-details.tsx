import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import ProductImage from '@/components/ProductImage';
import { useLocation, useRoute } from 'wouter';
import { ArrowLeft, Edit, Package, AlertTriangle, Barcode, Tag, Layers, DollarSign, Database, TrendingUp, ShoppingCart, BarChart3, Target, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { db, ProductService } from '@/lib/db';
import type { Product, Variant } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { getUnitMultiplier } from '@/lib/utils';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type SalesHistory = {
  hasSales: boolean;
  revenue: number;
  unitsSold: number;
  estimatedProfit: number | null;
  salesByItem: Array<{ id: string; name: string; revenue: number; unitsSold: number; estimatedProfit: number | null }>;
  trend: Array<{ date: string; label: string; revenue: number }>;
};

export default function ProductDetails() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute('/inventory/product/:id');
  const id = match ? params?.id : undefined;
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [invalidId, setInvalidId] = useState<boolean>(false);
  const [salesHistory, setSalesHistory] = useState<SalesHistory | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setNotFound(false);
      setInvalidId(false);
      setSalesHistory(null);

      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        setInvalidId(true);
        setLoading(false);
        return;
      }

      const p = await ProductService.getProductById(id);
      if (!p) {
        setProduct(undefined);
        setNotFound(true);
        setVariants([]);
      } else {
        setProduct(p);
        let loadedVariants: Variant[] = [];
        try {
          const vs = await ProductService.getVariants(id);
          loadedVariants = Array.isArray(vs) ? vs : [];
          setVariants(loadedVariants);
        } catch (err) {
          console.error('Failed to load variants:', err);
          setVariants([]);
        }

        try {
          const productIds = [id, ...loadedVariants.map(variant => variant.id)];
          const relatedItems = await db.saleItems.where('productId').anyOf(productIds).toArray();
          const saleItems = relatedItems.filter(item => !item.isNonInventory);
          const saleIds = Array.from(new Set(saleItems.map(item => item.saleId)));
          const sales = await db.sales.bulkGet(saleIds);
          const salesById = new Map(
            sales.filter((sale): sale is NonNullable<typeof sale> => Boolean(sale)).map(sale => [sale.id, sale])
          );
          const validItems = saleItems.filter(item => salesById.has(item.saleId));
          const dailyRevenue = new Map<string, number>();
          const productCostById = new Map<string, number | null>([
            [id, Number((p as any).cost || 0) > 0 ? Number((p as any).cost) : null],
            ...loadedVariants.map(variant => [
              variant.id,
              Number(variant.cost || 0) > 0 ? Number(variant.cost) : null
            ] as [string, number | null])
          ]);
          const salesByItem = new Map<string, { id: string; name: string; revenue: number; unitsSold: number; estimatedProfit: number | null }>();
          salesByItem.set(id, { id, name: p.name, revenue: 0, unitsSold: 0, estimatedProfit: productCostById.get(id) === null ? null : 0 });
          for (const variant of loadedVariants) {
            salesByItem.set(variant.id, {
              id: variant.id,
              name: `${p.name} · ${variant.name}`,
              revenue: 0,
              unitsSold: 0,
              estimatedProfit: productCostById.get(variant.id) === null ? null : 0
            });
          }
          let estimatedProfit = 0;
          let hasCompleteCostData = true;
          const revenue = validItems.reduce((sum, item) => {
            const sale = salesById.get(item.saleId);
            if (!sale) return sum;
            const multiplier = getUnitMultiplier(
              item.unit === 'dozen' || item.unit === 'carton' ? item.unit : 'pieces'
            );
            const unitsSold = Number(item.quantity || 0) * multiplier;
            const saleRevenue = Number(item.price || 0) * unitsSold;
            const itemSales = salesByItem.get(item.productId) || {
              id: item.productId,
              name: item.productName || 'Unknown item',
              revenue: 0,
              unitsSold: 0,
              estimatedProfit: null
            };
            const unitCost = productCostById.get(item.productId);
            itemSales.revenue += saleRevenue;
            itemSales.unitsSold += unitsSold;
            if (unitCost !== undefined && unitCost !== null) {
              itemSales.estimatedProfit = (itemSales.estimatedProfit || 0) + (Number(item.price || 0) - unitCost) * unitsSold;
              estimatedProfit += (Number(item.price || 0) - unitCost) * unitsSold;
            } else {
              itemSales.estimatedProfit = null;
              hasCompleteCostData = false;
            }
            salesByItem.set(item.productId, itemSales);
            const saleDate = sale.createdAt ? new Date(sale.createdAt) : null;
            if (saleDate && !Number.isNaN(saleDate.getTime())) {
              const key = `${saleDate.getFullYear()}-${saleDate.getMonth()}-${saleDate.getDate()}`;
              dailyRevenue.set(key, (dailyRevenue.get(key) || 0) + saleRevenue);
            }
            return sum + saleRevenue;
          }, 0);
          const endDate = new Date();
          endDate.setHours(0, 0, 0, 0);
          const trend = Array.from({ length: 7 }, (_, index) => {
            const date = new Date(endDate);
            date.setDate(endDate.getDate() - (6 - index));
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            return {
              date: key,
              label: date.toLocaleDateString(undefined, { weekday: 'short' }),
              revenue: dailyRevenue.get(key) || 0
            };
          });
          setSalesHistory({
            hasSales: validItems.length > 0,
            revenue,
            unitsSold: Array.from(salesByItem.values()).reduce((sum, item) => sum + item.unitsSold, 0),
            estimatedProfit: hasCompleteCostData && validItems.length > 0 ? estimatedProfit : null,
            salesByItem: Array.from(salesByItem.values()).filter(item => item.unitsSold > 0).sort((a, b) => b.revenue - a.revenue),
            trend
          });
        } catch (err) {
          console.error('Failed to load product sales history:', err);
          setSalesHistory({ hasSales: false, revenue: 0, unitsSold: 0, estimatedProfit: null, salesByItem: [], trend: [] });
        }
      }
      setLoading(false);
    })();
  }, [id]);

  if (!id || invalidId) {
    return (
      <Layout>
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <Card className="max-w-md w-full p-8 text-center shadow-xl rounded-2xl">
            <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-100">Invalid Product Reference</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              The product link is missing a valid product identifier. Please go back and try again.
            </p>
            <Button onClick={() => setLocation('/inventory')} className="w-full rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Inventory
            </Button>
          </Card>
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout>
        <div className="bg-white dark:bg-gray-800 p-4 shadow-sm">
          <div className="flex items-center">
            <button onClick={() => setLocation('/inventory')} className="mr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <Skeleton className="h-6 w-40 rounded-md" />
          </div>
        </div>
        <div className="p-4 space-y-4">
          <Card className="p-4 rounded-xl shadow-lg">
            <div className="flex items-center gap-4">
              <Skeleton className="w-16 h-16 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3 rounded-md" />
                <Skeleton className="h-4 w-1/3 rounded-md" />
                <Skeleton className="h-4 w-1/2 rounded-md" />
              </div>
            </div>
          </Card>
          <Card className="p-4 rounded-xl shadow">
            <Skeleton className="h-5 w-40 rounded-md mb-4" />
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
            </div>
          </Card>
        </div>
      </Layout>
    );
  }

  if (notFound || !product) {
    return (
      <Layout>
        <div className="bg-white dark:bg-gray-800 p-4 shadow-sm">
          <div className="flex items-center">
            <button onClick={() => setLocation('/inventory')} className="mr-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-200">Product Details</h1>
          </div>
        </div>
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <Card className="max-w-md w-full p-8 text-center shadow-xl rounded-2xl border-amber-200">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <Package className="w-8 h-8 text-amber-500" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-100">Product Not Found</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">We could not locate the product you are looking for.</p>
            <p className="text-xs text-gray-400 mb-6 font-mono break-all">ID: {String(id)}</p>
            <Button onClick={() => setLocation('/inventory')} className="w-full rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Inventory
            </Button>
          </Card>
        </div>
      </Layout>
    );
  }

  const totalVariantStock = variants.reduce((sum, v) => sum + Number(v.quantity || 0), 0);
  const variantStockLabel = product.quantity ? String(product.quantity) : String(totalVariantStock);
  const stockQty = Number(variantStockLabel);
  const isLowStock = stockQty > 0 && stockQty <= 20;
  const isOutOfStock = stockQty === 0;
  const unitMargin = Number((product as any).cost || 0) > 0
    ? Number(product.price || 0) - Number((product as any).cost || 0)
    : null;
  const marginPercent = unitMargin !== null && Number(product.price || 0) > 0
    ? (unitMargin / Number(product.price)) * 100
    : null;
  const profitPotential = unitMargin !== null
    ? unitMargin * Math.max(0, Number(product.quantity || 0))
    : null;
  const trendMaximum = Math.max(0, ...(salesHistory?.trend.map(point => point.revenue) || []));

  return (
    <Layout>
      {/* ── Sticky Header ── */}
      <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setLocation('/inventory')}
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-black text-gray-900 dark:text-white tracking-tight truncate">{product.name}</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Product Details</p>
          </div>
          <Button
            onClick={() => setLocation(`/inventory?edit=${encodeURIComponent(product.id)}`)}
            className="shrink-0 rounded-xl bg-gradient-to-r from-[#FF8882] to-[#f27670] hover:from-[#f27670] hover:to-[#e5665f] text-white shadow-md shadow-[#FF8882]/30 hover:shadow-lg hover:scale-[1.02] active:scale-95 transition-all h-10 px-4 font-black text-xs uppercase tracking-widest"
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit Product
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-5xl mx-auto pb-10">

        {/* ── Product Info Card ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden rounded-2xl shadow-lg border-0">
            <div className="flex flex-col sm:flex-row items-stretch">
              <div className="sm:w-48 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-750 p-6 flex items-center justify-center border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-gray-700">
                <ProductImage
                  src={product.image}
                  alt={product.name}
                  className="w-32 h-32 rounded-xl shadow-sm bg-gradient-to-br from-[#FF8882]/10 to-[#FF8882]/5"
                  fallbackClassName="bg-transparent"
                  iconClassName="w-12 h-12 text-[#FF8882]/50"
                  fallbackLabel="No image"
                />
              </div>
              <div className="flex-1 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter">{product.name}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {product.barcode && (
                        <Badge variant="outline" className="gap-1 bg-gray-50 dark:bg-gray-800 rounded-lg border-gray-200 dark:border-gray-700">
                          <Barcode className="w-3 h-3 text-gray-500" />
                          <span className="font-mono text-xs">{product.barcode}</span>
                        </Badge>
                      )}
                      {product.category && (
                        <Badge variant="secondary" className="gap-1 rounded-lg">
                          <Tag className="w-3 h-3" />
                          {product.category}
                        </Badge>
                      )}
                      <Badge className={`rounded-lg gap-1 ${
                        isOutOfStock ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        : isLowStock ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      }`}>
                        {isOutOfStock ? <XCircle className="w-3 h-3" /> : isLowStock ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                        {isOutOfStock ? 'Out of stock' : isLowStock ? `Low stock (${variantStockLabel})` : `${variantStockLabel} in stock`}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-widest">Selling Price</div>
                    <div className="text-3xl font-black text-[#FF8882] tracking-tighter">&#8369;{Number(product.price || 0).toFixed(2)}</div>
                    {unitMargin !== null && (
                      <div className={`text-xs font-bold mt-1 ${unitMargin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {unitMargin >= 0 ? '+' : ''}&#8369;{unitMargin.toFixed(2)} margin
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  {[
                    { label: 'Cost', value: `&#8369;${Number((product as any).cost || 0).toFixed(2)}` },
                    { label: 'Base Stock', value: String(Number(product.quantity || 0)) },
                    { label: 'Variants', value: String(variants.length) },
                    { label: 'Var. Stock', value: String(totalVariantStock) },
                  ].map(stat => (
                    <div key={stat.label} className="rounded-xl p-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                      <div className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mb-1">{stat.label}</div>
                      <div className="font-black text-gray-800 dark:text-gray-100" dangerouslySetInnerHTML={{ __html: stat.value }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ── Performance Report ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-1.5 rounded-lg bg-[#FF8882]/10">
              <BarChart3 className="w-4 h-4 text-[#FF8882]" />
            </div>
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">Performance Report</h2>
            <div className="h-px flex-1 bg-gray-100 dark:bg-gray-700" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Profit Potential */}
            <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-400" />
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                    <Target className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Profit Potential</span>
                </div>
                {unitMargin === null ? (
                  <p className="text-sm font-semibold text-gray-400">Add cost price to calculate</p>
                ) : (
                  <>
                    <p className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter">
                      &#8369;{profitPotential?.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span>&#8369;{unitMargin.toFixed(2)} per unit</span>
                      {marginPercent !== null && (
                        <span className={`font-bold px-1.5 py-0.5 rounded-md text-[10px] ${marginPercent >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                          {marginPercent.toFixed(1)}%
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">Estimated from current cost × {Number(product.quantity || 0)} units in stock</p>
                  </>
                )}
              </div>
            </Card>

            {/* Sales Generated */}
            <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-[#FF8882] to-[#f27670]" />
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-[#FF8882]/10 flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-[#FF8882]" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sales Generated · Product + Variants</span>
                </div>
                {salesHistory?.hasSales ? (
                  <>
                    <p className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter">
                      &#8369;{salesHistory.revenue.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      <span className="font-black text-gray-700">{salesHistory.unitsSold}</span> units sold
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">All-time recorded transactions</p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-gray-400">No sales history yet</p>
                )}
              </div>
            </Card>

            {/* 7-Day Trend */}
            <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-violet-400 to-purple-500" />
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">7-Day Trend</span>
                </div>
                {salesHistory?.hasSales && salesHistory.trend.some(p => p.revenue > 0) ? (
                  <div>
                    <div className="flex h-14 items-end gap-1" role="img" aria-label="Sales trend last 7 days">
                      {salesHistory.trend.map(point => (
                        <div key={point.date} className="flex h-full flex-1 flex-col justify-end items-center gap-0.5">
                          <div
                            className="w-full rounded-t-sm bg-gradient-to-t from-[#FF8882] to-[#FF8882]/50 transition-all duration-500"
                            style={{
                              height: `${trendMaximum > 0 ? Math.max(4, (point.revenue / trendMaximum) * 100) : 4}%`,
                              minHeight: point.revenue > 0 ? '6px' : '3px'
                            }}
                            title={`P${point.revenue.toFixed(2)}`}
                          />
                          <span className="text-[8px] text-gray-400 font-bold">{point.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-400">
                      Weekly: <span className="font-black text-gray-700">&#8369;{salesHistory.trend.reduce((s, p) => s + p.revenue, 0).toFixed(2)}</span>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-gray-400">No activity in last 7 days</p>
                )}
              </div>
            </Card>
          </div>
        </motion.div>

        {/* ── Revenue Breakdown (shown only if has sales) ── */}
        {salesHistory?.hasSales && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
            <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-50 dark:border-gray-700 flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#BF953F]" />
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">Revenue Breakdown</h3>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl p-3 bg-gradient-to-br from-amber-50 to-amber-50/30 border border-amber-100">
                  <div className="text-[9px] text-amber-600 font-black uppercase tracking-widest mb-1">Total Revenue</div>
                  <div className="text-lg font-black text-gray-900">&#8369;{salesHistory.revenue.toFixed(2)}</div>
                </div>
                <div className="rounded-xl p-3 bg-gradient-to-br from-blue-50 to-blue-50/30 border border-blue-100">
                  <div className="text-[9px] text-blue-600 font-black uppercase tracking-widest mb-1">Units Sold</div>
                  <div className="text-lg font-black text-gray-900">{salesHistory.unitsSold}</div>
                </div>
                <div className="rounded-xl p-3 bg-gradient-to-br from-emerald-50 to-emerald-50/30 border border-emerald-100">
                  <div className="text-[9px] text-emerald-600 font-black uppercase tracking-widest mb-1">Revenue / Piece</div>
                  <div className="text-lg font-black text-gray-900">
                    &#8369;{salesHistory.unitsSold > 0 ? (salesHistory.revenue / salesHistory.unitsSold).toFixed(2) : '0.00'}
                  </div>
                </div>
                <div className="rounded-xl p-3 bg-gradient-to-br from-purple-50 to-purple-50/30 border border-purple-100">
                  <div className="text-[9px] text-purple-600 font-black uppercase tracking-widest mb-1">Est. Gross Profit</div>
                  <div className="text-lg font-black text-gray-900">
                    {salesHistory.estimatedProfit !== null ? `₱${salesHistory.estimatedProfit.toFixed(2)}` : 'Unavailable'}
                  </div>
                  <p className="mt-1 text-[9px] text-purple-700/70">Uses current cost data; not realized profit</p>
                </div>
              </div>
              <div className="px-4 pb-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Sales by product / variant</h4>
                <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                  {salesHistory.salesByItem.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-semibold text-gray-700 dark:text-gray-300">{item.name}</span>
                      <span className="shrink-0 text-right text-gray-500">
                        {item.unitsSold} pcs · ₱{item.revenue.toFixed(2)}
                        <span className="block text-[10px] text-gray-400">
                          Est. profit: {item.estimatedProfit === null ? 'unavailable' : `₱${item.estimatedProfit.toFixed(2)}`}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-gray-400">Profit estimates use each item’s current cost, not cost recorded at the time of sale.</p>
              </div>
            </Card>
          </motion.div>
        )}

        {/* ── Variants ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <Card className="rounded-2xl shadow border-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                </div>
                <div>
                  <div className="text-base font-black text-gray-800 dark:text-gray-100">Product Variants</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {variants.length === 0 ? 'No variants configured yet' : `${variants.length} variant${variants.length === 1 ? '' : 's'} - Combined stock: ${totalVariantStock}`}
                  </div>
                </div>
              </div>
              <Button onClick={() => setLocation(`/inventory/product/${product.id}/variant/add`)} className="rounded-xl shadow-sm bg-[#FF8882] hover:bg-[#f27670] text-white">
                + Add Variant
              </Button>
            </div>

            <div className="p-5">
              {variants.length === 0 ? (
                <div className="text-center py-12">
                  <div className="mx-auto w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                    <Layers className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                  </div>
                  <h4 className="font-bold text-gray-700 dark:text-gray-200 mb-1">No variants yet</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-sm mx-auto">
                    Add variants to offer the same product in different sizes, colors, or packaging.
                  </p>
                  <Button onClick={() => setLocation(`/inventory/product/${product.id}/variant/add`)} variant="secondary" className="rounded-xl">
                    Create First Variant
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {variants.map((v, idx) => {
                    const qty = Number(v.quantity || 0);
                    const lowStock = qty > 0 && qty <= 20;
                    const outOfStock = qty === 0;
                    return (
                      <Card key={v.id} className="rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                        <div className="flex items-stretch">
                          <div className="w-20 sm:w-24 flex-shrink-0 bg-gray-50 dark:bg-gray-800 flex items-center justify-center border-r border-gray-100 dark:border-gray-700">
                            <ProductImage
                              src={v.image}
                              alt={v.name}
                              className="w-full h-full"
                              iconClassName="w-6 h-6"
                            />
                          </div>
                          <div className="flex-1 p-4 flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-bold text-gray-800 dark:text-gray-100 truncate">{v.name}</div>
                                <Badge variant="outline" className="rounded-md text-[10px] font-mono text-gray-500">#{idx + 1}</Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                {v.barcode && (
                                  <span className="inline-flex items-center gap-1 font-mono">
                                    <Barcode className="w-3 h-3" />{v.barcode}
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1">
                                  <DollarSign className="w-3 h-3" />
                                  Cost &#8369;{Number(v.cost || 0).toFixed(2)}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                              <div className="text-right">
                                <div className="text-xs text-gray-400 mb-0.5">Price</div>
                                <div className="font-black text-[#FF8882]">&#8369;{Number(v.price || 0).toFixed(2)}</div>
                              </div>
                              <div className={`px-3 py-1.5 rounded-lg text-center min-w-[80px] ${
                                outOfStock ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'
                                  : lowStock ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                                  : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                              }`}>
                                <div className="text-[10px] uppercase tracking-wide opacity-75">Stock</div>
                                <div className="font-black text-sm leading-tight">{qty}</div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setLocation(`/inventory/product/${product.id}/variant/edit/${v.id}`)}
                                className="rounded-lg h-10 w-10 sm:h-10 sm:w-auto px-2 sm:px-3 bg-gray-50 hover:bg-[#FF8882]/10 hover:text-[#FF8882] border border-gray-100"
                              >
                                <Edit className="w-4 h-4 sm:mr-1.5" />
                                <span className="hidden sm:inline font-bold">Edit</span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </Layout>
  );
}
