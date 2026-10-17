import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  History, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Eye, 
  FileText, 
  RefreshCw,
  Boxes,
  Calendar,
  Building2,
  Package,
  Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { BulkInventoryService } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { LocalizedContent } from '@/contexts/LanguageContext';

interface BulkInventoryHistoryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BulkInventoryHistory: React.FC<BulkInventoryHistoryProps> = ({
  isOpen,
  onClose,
}) => {
  const { toast } = useToast();

  // Filter States
  const [reference, setReference] = useState('');
  const [supplier, setSupplier] = useState('');
  const [productName, setProductName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Pagination & Data States
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Detail View State
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<{
    transaction: any;
    items: any[];
    createdByName?: string;
    summary?: any;
  } | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const loadHistory = async (targetPage = page) => {
    setIsLoading(true);
    try {
      const res = await BulkInventoryService.getBulkInventoryHistory({
        page: targetPage,
        size: pageSize,
        reference: reference.trim() || undefined,
        supplier: supplier.trim() || undefined,
        productName: productName.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined
      });

      setRows(res.rows || []);
      setTotalRecords(res.total || 0);
      setPage(res.page || targetPage);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      console.error('Failed to load bulk inventory history:', err);
      toast({
        title: "Load Failed",
        description: "Failed to fetch bulk inventory history records",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory(1);
    }
  }, [isOpen]);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadHistory(1);
  };

  const handleClearFilters = () => {
    setReference('');
    setSupplier('');
    setProductName('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
    setTimeout(() => {
      BulkInventoryService.getBulkInventoryHistory({ page: 1, size: pageSize }).then(res => {
        setRows(res.rows || []);
        setTotalRecords(res.total || 0);
        setPage(1);
        setTotalPages(res.totalPages || 1);
      });
    }, 50);
  };

  const handleOpenDetail = async (id: string) => {
    setSelectedTxId(id);
    setIsLoadingDetail(true);
    try {
      const data = await BulkInventoryService.getBulkInventoryById(id);
      setDetailData(data);
    } catch (err) {
      console.error('Failed to load detail:', err);
      toast({
        title: "Error",
        description: "Could not load transaction details",
        variant: "destructive"
      });
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Export Session Details to CSV
  const handleExportCSV = (txData: any, itemsList: any[]) => {
    if (!itemsList || itemsList.length === 0) {
      toast({ title: "No Data", description: "No items to export", variant: "destructive" });
      return;
    }

    const refNum = txData?.reference_number || txData?.referenceNumber || 'export';
    const supplierName = txData?.supplier_company || txData?.supplierCompany || 'N/A';
    const dateStr = format(new Date(txData?.createdAt || txData?.created_at || new Date()), 'yyyy-MM-dd HH:mm');

    const headers = [
      'Reference No.',
      'Date Received',
      'Supplier',
      'Product Name',
      'Box Barcode',
      'Piece Barcode',
      'Boxes Received',
      'Pieces Per Box',
      'Total Pieces Added',
      'Cost Per Box',
      'Unit Cost',
      'Retail Selling Price',
      'Line Subtotal Cost'
    ];

    const csvRows = itemsList.map(item => {
      const isBox = (item.box_count || item.boxCount || 0) > 0;
      const boxCount = item.box_count || item.boxCount || (isBox ? 1 : 0);
      const unitsPerBox = item.units_per_box || item.unitsPerBox || 1;
      const totalPieces = item.quantity || 0;
      const costPerBox = item.cost_per_box || item.costPerBox || 0;
      const unitCost = item.cost_snapshot || item.costSnapshot || 0;
      const sellingPrice = item.selling_price_snapshot || item.sellingPriceSnapshot || 0;
      const subtotal = totalPieces * unitCost;

      return [
        `"${refNum}"`,
        `"${dateStr}"`,
        `"${supplierName.replace(/"/g, '""')}"`,
        `"${(item.product_name_snapshot || item.productNameSnapshot || '').replace(/"/g, '""')}"`,
        `"${item.box_barcode || item.boxBarcode || ''}"`,
        `"${item.piece_barcode || item.pieceBarcode || item.barcode || ''}"`,
        boxCount,
        unitsPerBox,
        totalPieces,
        costPerBox.toFixed(2),
        unitCost.toFixed(2),
        sellingPrice.toFixed(2),
        subtotal.toFixed(2)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Bulk_Intake_${refNum}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export Successful",
      description: `Downloaded CSV report for ${refNum}`,
    });
  };

  if (!isOpen) return null;

  return (
    <LocalizedContent>
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        {/* Header */}
        <DialogHeader className="p-5 sm:p-6 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex-none">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300">
                <History className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  Bulk Inventory History
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Audit Log
                  </span>
                </DialogTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Audit records, master box breakdowns, and item snapshots for all delivery sessions
                </p>
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <form onSubmit={handleApplyFilter} className="mt-4 flex flex-col md:flex-row gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 flex-wrap items-stretch md:items-center">
            <div className="flex-1 min-w-[140px]">
              <Input
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="Reference No. (BI-...)"
                className="h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#FF8882]"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Input
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                placeholder="Filter by Supplier"
                className="h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#FF8882]"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Input
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="Filter by Product Name"
                className="h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#FF8882]"
              />
            </div>
            <div className="flex items-center gap-1.5 min-w-[220px]">
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white px-2 focus:border-[#FF8882] flex-1"
                title="From Date"
              />
              <span className="text-xs text-slate-400 px-0.5">-</span>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white px-2 focus:border-[#FF8882] flex-1"
                title="To Date"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-none">
              <Button
                type="submit"
                className="h-9 px-4 bg-[#FF8882] hover:bg-[#ff7770] text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
              >
                Filter
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleClearFilters}
                className="h-9 px-3 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-medium"
                title="Reset Filters"
              >
                Reset
              </Button>
            </div>
          </form>
        </DialogHeader>

        {/* History Table / Cards Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50 dark:bg-slate-950/30">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <RefreshCw className="w-6 h-6 text-slate-400 animate-spin mb-2" />
              <p className="text-xs text-slate-500 dark:text-slate-400">Loading history records...</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white/60 dark:bg-slate-900/40">
              <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3 text-slate-400">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No records found</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1">
                Completed bulk inventory intake sessions will appear here with full line snapshots and batch details.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((tx) => {
                const refNum = tx.reference_number || tx.referenceNumber || tx.id;
                const supp = tx.supplier_company || tx.supplierCompany || 'Unspecified Supplier';
                const itemsCount = tx.total_items || tx.totalItems || 0;
                const unitsCount = tx.total_units || tx.totalUnits || 0;
                const costTotal = Number(tx.total_cost || tx.totalCost || 0);
                const creator = tx.createdByName || tx.created_by || tx.createdBy || 'Admin';
                const dateStr = tx.createdAt || tx.created_at || new Date().toISOString();

                return (
                  <div
                    key={tx.id}
                    onClick={() => handleOpenDetail(tx.id)}
                    className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 shadow-sm hover:border-[#FF8882]/60 hover:shadow-md cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:text-[#FF8882] transition-colors flex-none">
                        <Boxes className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">{refNum}</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                            {tx.status || 'COMPLETED'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <span className="font-medium text-slate-700 dark:text-slate-300">{supp}</span>
                          <span>•</span>
                          <span>{format(new Date(dateStr), 'MMM dd, yyyy · hh:mm a')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-5 justify-between md:justify-end border-t md:border-t-0 border-slate-100 dark:border-slate-700/60 pt-2 md:pt-0">
                      <div className="text-right">
                        <span className="text-[10px] font-medium text-slate-400 block">Items / Units</span>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{itemsCount} items ({unitsCount} pcs)</span>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-medium text-slate-400 block">Total Value</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">₱{costTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>

                      <div className="text-right hidden sm:block">
                        <span className="text-[10px] font-medium text-slate-400 block">Recorded By</span>
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{creator}</span>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer & Pagination */}
        <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-none flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <strong className="text-slate-800 dark:text-slate-200">{rows.length}</strong> of <strong className="text-slate-800 dark:text-slate-200">{totalRecords}</strong> sessions
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => loadHistory(page - 1)}
              className="h-8 px-2.5 rounded-lg border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              <span>Prev</span>
            </Button>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => loadHistory(page + 1)}
              className="h-8 px-2.5 rounded-lg border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>

        {/* Detail View Modal */}
        <Dialog open={selectedTxId !== null} onOpenChange={(open) => { if (!open) { setSelectedTxId(null); setDetailData(null); } }}>
          <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
            <DialogHeader className="p-5 sm:p-6 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex-none">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      {detailData?.transaction?.reference_number || detailData?.transaction?.referenceNumber || selectedTxId}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                      {detailData?.transaction?.status || 'COMPLETED'}
                    </span>
                  </div>
                  <DialogTitle className="text-base font-semibold text-slate-900 dark:text-white">
                    Bulk Receiving Session Details
                  </DialogTitle>
                </div>

                {detailData && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExportCSV(detailData.transaction, detailData.items)}
                    className="h-8 px-3 rounded-lg border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </Button>
                )}
              </div>

              {/* Transaction Meta Card */}
              {detailData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <div>
                    <span className="text-[10px] font-medium text-slate-400 block">Supplier</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{detailData.transaction.supplier_company || detailData.transaction.supplierCompany || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-slate-400 block">Received At</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {format(new Date(detailData.transaction.createdAt || detailData.transaction.created_at || new Date()), 'MMM dd, yyyy · hh:mm a')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-slate-400 block">Retail Units Added</span>
                    <span className="font-semibold text-[#FF8882]">+{detailData.summary?.totalUnits || 0} pcs</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-medium text-slate-400 block">Total Value</span>
                    <span className="font-bold text-slate-900 dark:text-white">₱{Number(detailData.summary?.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </DialogHeader>

            {/* Item Details List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/30">
              {isLoadingDetail ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <RefreshCw className="w-6 h-6 text-slate-400 animate-spin mb-2" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Loading item snapshots...</p>
                </div>
              ) : !detailData || !detailData.items || detailData.items.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs font-medium">
                  No line items found for this transaction.
                </div>
              ) : (
                detailData.items.map((item, idx) => {
                  const lineCostSubtotal = Number(item.quantity || 0) * Number(item.cost_snapshot || item.costSnapshot || 0);
                  const isBox = Boolean((item.box_count || item.boxCount || 0) > 0 || item.box_barcode || item.boxBarcode);
                  const boxCount = item.box_count || item.boxCount || 0;
                  const packRatio = item.units_per_box || item.unitsPerBox || 1;

                  return (
                    <div
                      key={item.id || idx}
                      className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          {isBox && boxCount > 0 ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40 flex items-center gap-1">
                              <Boxes className="w-3 h-3" />
                              {boxCount} Box(es) @ {packRatio} pcs/box
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                              Piece Intake
                            </span>
                          )}

                          {(item.box_barcode || item.boxBarcode) && (
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">
                              Box: {item.box_barcode || item.boxBarcode}
                            </span>
                          )}

                          {(item.piece_barcode || item.pieceBarcode || item.barcode) && (
                            <span className="text-[10px] font-mono text-slate-400">
                              Piece: {item.piece_barcode || item.pieceBarcode || item.barcode}
                            </span>
                          )}
                        </div>

                        <h5 className="font-semibold text-slate-900 dark:text-white text-xs truncate">
                          {item.product_name_snapshot || item.productNameSnapshot || 'Product'}
                        </h5>
                      </div>

                      <div className="flex items-center gap-4 sm:gap-6 justify-between sm:justify-end border-t sm:border-t-0 pt-1.5 sm:pt-0 border-slate-100 dark:border-slate-700/60">
                        <div className="text-right">
                          <span className="text-[10px] font-medium text-slate-400 block">Retail Stock</span>
                          <span className="font-bold text-[#FF8882]">+{item.quantity} pcs</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-medium text-slate-400 block">Unit Cost</span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">₱{Number(item.cost_snapshot || item.costSnapshot || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-medium text-slate-400 block">Selling Price</span>
                          <span className="font-medium text-slate-700 dark:text-slate-300">₱{Number(item.selling_price_snapshot || item.sellingPriceSnapshot || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-right min-w-[64px]">
                          <span className="text-[10px] font-medium text-slate-400 block">Subtotal</span>
                          <span className="font-bold text-slate-900 dark:text-white">₱{lineCostSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <DialogFooter className="p-3.5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-none flex justify-between items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setSelectedTxId(null); setDetailData(null); }}
                className="w-full h-9 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                Close Details
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
    </LocalizedContent>
  );
};
