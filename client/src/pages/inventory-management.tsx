import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Search, Filter, Plus, Edit, Trash2, Package, Image as ImageIcon, PlusCircle, Tag, X, AlertTriangle, Upload, Download, FileSpreadsheet, Boxes, History } from 'lucide-react';
import { useLocation } from 'wouter';
import Layout from '@/components/Layout';
import ProductImage from '@/components/ProductImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ProductService, NotificationService } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NonInventoryProducts from '@/components/NonInventoryProducts';
import { BulkInventoryWorkspace } from '@/components/BulkInventoryWorkspace';
import { BulkInventoryHistory } from '@/components/BulkInventoryHistory';
import type { Product } from '@shared/schema';

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  barcode: z.string().min(1, 'Barcode is required'),
  price: z.coerce.number().min(0.01, 'Price must be greater than 0'),
  cost: z.coerce.number().min(0, 'Cost must be 0 or greater'),
  quantity: z.coerce.number().min(0, 'Quantity must be 0 or greater'),
  category: z.string().optional(),
  image: z.string().optional(),
});

// Schema for stock addition
const stockAdditionSchema = z.object({
  addQuantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
});

const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
});

// Enhanced product schema with unit selection
const enhancedProductSchema = productSchema.extend({
  unit: z.string().default('pcs'),
});

type ProductFormData = z.infer<typeof enhancedProductSchema>;
type StockAdditionFormData = z.infer<typeof stockAdditionSchema>;
type CategoryFormData = z.infer<typeof categorySchema>;

const InventoryManagement: React.FC = () => {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddStockDialogOpen, setIsAddStockDialogOpen] = useState(false);
  const [productLookup, setProductLookup] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [productImage, setProductImage] = useState<string | null>(null);
  const [isAddingStock, setIsAddingStock] = useState(false);
  
  // Category management state
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [isFabExpanded, setIsFabExpanded] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [editModeTimerId, setEditModeTimerId] = useState<number | null>(null);
  const [pcsPerBox, setPcsPerBox] = useState(1);
  const [isBulkInventoryOpen, setIsBulkInventoryOpen] = useState(false);
  const [isBulkHistoryOpen, setIsBulkHistoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('tab') === 'non-inventory' ? 'non-inventory' : 'inventory';
    }
    return 'inventory';
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(enhancedProductSchema),
    defaultValues: {
      name: '',
      barcode: '',
      price: '' as unknown as number,
      cost: '' as unknown as number,
      quantity: '' as unknown as number,
      category: 'general',
      image: '',
      unit: 'pcs',
    },
  });

  const selectedUnit = form.watch('unit');
  
  // Form for adding stock
  const stockForm = useForm<StockAdditionFormData>({
    resolver: zodResolver(stockAdditionSchema),
    defaultValues: {
      addQuantity: 1,
    },
  });
  
  // Form for category management
  const categoryForm = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: '',
    },
  });

  // Initial sync to server so customer module can access inventory
  useEffect(() => {
    (async () => {
      try {
        await ProductService.syncAllProductsToServer();
      } catch (e) {
        console.error('Initial product sync failed:', e);
      }
    })();
  }, []);

  // Auto-revert Edit mode if no selection within 30 seconds
  useEffect(() => {
    if (!isEditMode) {
      if (editModeTimerId) {
        clearTimeout(editModeTimerId);
        setEditModeTimerId(null);
      }
      return;
    }

    if (selectedProductIds.size === 0) {
      const id = window.setTimeout(() => {
        if (selectedProductIds.size === 0) {
          setIsEditMode(false);
        }
      }, 30000);
      setEditModeTimerId(id);
    }

    return () => {
      if (editModeTimerId) {
        clearTimeout(editModeTimerId);
        setEditModeTimerId(null);
      }
    };
  }, [isEditMode, selectedProductIds.size]);

  const loadProducts = async () => {
    try {
      const allProducts = await ProductService.getAllProducts();
      setProducts(allProducts);
      // Asynchronously evaluate low stock levels and update notifications
      NotificationService.checkAndGenerateLowStockAlerts().catch(() => {});
    } catch (error) {
      console.error('Error loading products:', error);
      toast({
        title: 'Error',
        description: 'Failed to load products',
        variant: 'destructive',
      });
    }
  };

  // Load categories from localStorage
  const loadCategories = () => {
    try {
      const savedCategories = localStorage.getItem('customCategories');
      if (savedCategories) {
        setCustomCategories(JSON.parse(savedCategories));
      }
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  // Save categories to localStorage
  const saveCategories = (categories: string[]) => {
    try {
      localStorage.setItem('customCategories', JSON.stringify(categories));
    } catch (error) {
      console.error('Error saving categories:', error);
    }
  };

  // Add new category or update existing one
  const handleAddCategory = (data: CategoryFormData) => {
    if (editingCategory) {
      // Editing mode: update existing category
      if (data.name !== editingCategory && customCategories.includes(data.name)) {
        toast({
          title: 'Error',
          description: 'Category name already exists',
          variant: 'destructive',
        });
        return;
      }

      const newCategories = customCategories.map(c => c === editingCategory ? data.name : c);
      setCustomCategories(newCategories);
      saveCategories(newCategories);
      
      toast({
        title: 'Category Updated',
        description: `Category has been updated to "${data.name}"`,
      });
      
      setEditingCategory(null);
    } else {
      // Adding mode: add new category
      if (customCategories.includes(data.name)) {
        toast({
          title: 'Error',
          description: 'Category already exists',
          variant: 'destructive',
        });
        return;
      }

      const newCategories = [...customCategories, data.name];
      setCustomCategories(newCategories);
      saveCategories(newCategories);
      
      toast({
        title: 'Category Added',
        description: `${data.name} has been added to categories`,
      });
    }
    
    setIsCategoryDialogOpen(false);
    categoryForm.reset();
  };

  // Edit category - load existing category name into form
  const handleEditCategory = (category: string) => {
    setEditingCategory(category);
    categoryForm.reset({ name: category });
    setIsCategoryDialogOpen(true);
  };

  // Delete category
  const handleDeleteCategory = (category: string) => {
    const newCategories = customCategories.filter(c => c !== category);
    setCustomCategories(newCategories);
    saveCategories(newCategories);
    
    toast({
      title: 'Category Deleted',
      description: `${category} has been removed from categories`,
    });
    
    setDeletingCategory(null);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExportCSV = () => {
    if (products.length === 0) {
      toast({
        title: 'Export Empty',
        description: 'No products available to export.',
        variant: 'destructive',
      });
      return;
    }

    const headers = ['ID', 'Name', 'Barcode', 'Price', 'Cost', 'Quantity', 'Category', 'Created At'];
    const rows = products.map((p) => [
      `"${(p.id || '').replace(/"/g, '""')}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${(p.barcode || '').replace(/"/g, '""')}"`,
      p.price ?? 0,
      (p as any).cost ?? 0,
      p.quantity ?? 0,
      `"${(p.category || 'general').replace(/"/g, '""')}"`,
      `"${(p.createdAt ? new Date(p.createdAt).toISOString() : '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    link.href = url;
    link.setAttribute('download', `inventory_export_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Export Successful',
      description: `Exported ${products.length} product(s) to CSV file.`,
    });
  };

  const parseCSV = (text: string) => {
    const lines = text.split(/\r\n|\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) return [];

    const parseLine = (line: string) => {
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(cur.trim().replace(/^"|"$/g, ''));
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur.trim().replace(/^"|"$/g, ''));
      return result;
    };

    const rawHeaders = parseLine(lines[0]);
    const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    const items: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      if (values.length === 0 || values.every((v) => v === '')) continue;
      const rowObj: any = {};
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx] || '';
      });
      items.push(rowObj);
    }
    return items;
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const text = await file.text();
      let importedRows: any[] = [];

      if (file.name.endsWith('.json')) {
        importedRows = JSON.parse(text);
      } else {
        importedRows = parseCSV(text);
      }

      if (!Array.isArray(importedRows) || importedRows.length === 0) {
        throw new Error('No valid product records found in file.');
      }

      let count = 0;
      for (const row of importedRows) {
        const name = row.name || row.productname || row.title || row.product;
        if (!name) continue;

        const price = parseFloat(row.price || row.unitprice || '0');
        const cost = parseFloat(row.cost || row.unitcost || '0');
        const quantity = parseInt(row.quantity || row.qty || row.stock || '0', 10);
        const category = row.category || row.cat || 'general';
        const barcode = row.barcode || row.code || `IMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        await ProductService.addProduct({
          name: String(name),
          barcode: String(barcode),
          price: isNaN(price) ? 0 : price,
          cost: isNaN(cost) ? 0 : cost,
          quantity: isNaN(quantity) ? 0 : quantity,
          category: String(category),
        });
        count++;
      }

      await loadProducts();
      await ProductService.syncAllProductsToServer();

      toast({
        title: 'Import Successful',
        description: `Successfully imported ${count} product(s) into inventory.`,
      });
    } catch (err: any) {
      console.error('Import error:', err);
      toast({
        title: 'Import Failed',
        description: err.message || 'Failed to import products from file.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, []);

  // Get unique categories for filter chips
  const allProductCategories = Array.from(new Set(products.map(p => p.category || 'general')));
  const categories = ['All', ...allProductCategories, ...customCategories.filter(c => !allProductCategories.includes(c))];

  // Filter products based on search and category
  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (product.barcode && product.barcode.includes(searchTerm));
    const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
    const matchesLowStock = !lowStockOnly || (product.quantity <= 20);
    return matchesSearch && matchesCategory && matchesLowStock;
  });

  const lowStockCount = products.filter(p => p.quantity <= 20).length;

  const toggleSelectProduct = (id: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedProductIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      for (const id of selectedProductIds) {
        await ProductService.deleteProduct(id);
      }
      setSelectedProductIds(new Set());
      setIsEditMode(false);
      await loadProducts();
      toast({ title: 'Deleted', description: 'Selected products were deleted.' });
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast({ title: 'Error', description: 'Failed to delete selected products', variant: 'destructive' });
    } finally {
      setIsBulkDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target?.result as string;
        setProductImage(imageData);
        form.setValue('image', imageData);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (data: ProductFormData) => {
    setIsLoading(true);
    try {
      if (editingProduct) {
        // Preserve the original quantity when updating
        const updatedData = {
          ...data,
          quantity: editingProduct.quantity
        };
        await ProductService.updateProduct(editingProduct.id, updatedData);
        toast({
          title: 'Product Updated',
          description: `${data.name} has been updated`,
        });
      } else {
        let finalQuantity = data.quantity ?? 0;
        
        // Handle unit conversion
        if (data.unit === 'dozen') {
          finalQuantity = finalQuantity * 12;
        } else if (data.unit === 'box') {
          finalQuantity = finalQuantity * pcsPerBox;
        }

        const registerData = { ...data, quantity: finalQuantity };
        await ProductService.addProduct(registerData);
        toast({
          title: 'Product Registered',
          description: `${data.name} has been registered in the system (Total: ${finalQuantity} pcs)`,
        });
      }
      
      await loadProducts();
      // Sync local inventory to server for customer module
      await ProductService.syncAllProductsToServer();
      setIsAddDialogOpen(false);
      setEditingProduct(null);
      setProductImage(null);
      form.reset();
    } catch (error) {
      console.error('Error saving product:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save product',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle stock addition
  const handleAddStock = async (data: StockAdditionFormData) => {
    if (!editingProduct) return;

    setIsAddingStock(true);
    try {
      // Account for units in stock addition
      let quantityToAdd = data.addQuantity;
      const currentUnit = form.getValues('unit');

      if (currentUnit === 'dozen') {
        quantityToAdd *= 12;
      } else if (currentUnit === 'box') {
        quantityToAdd *= pcsPerBox;
      }

      const updatedQuantity = editingProduct.quantity + quantityToAdd;
      await ProductService.updateProduct(editingProduct.id, {
        ...editingProduct,
        quantity: updatedQuantity
      });

      // Update the editing product with new quantity
      setEditingProduct({
        ...editingProduct,
        quantity: updatedQuantity
      });

      toast({
        title: 'Stock Updated',
        description: `Added ${quantityToAdd} pieces to ${editingProduct.name}`,
      });

      stockForm.reset();
      await loadProducts();
      // Sync after stock changes
      await ProductService.syncAllProductsToServer();
    } catch (error) {
      console.error('Error adding stock:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update stock',
        variant: 'destructive',
      });
    } finally {
      setIsAddingStock(false);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setProductImage(product.image || null);
    form.reset({
      name: product.name,
      barcode: product.barcode || '',
      price: product.price,
      cost: (product as any).cost ?? 0,
      quantity: product.quantity,
      category: product.category || undefined,
      image: product.image || undefined,
    });
    setIsAddDialogOpen(true);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || products.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (!editId) return;

    const product = products.find(candidate => candidate.id === editId);
    if (!product) return;

    handleEdit(product);
    params.delete('edit');
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
  }, [products]);

  const handleDelete = async () => {
    if (!deletingProduct) return;

    try {
      await ProductService.deleteProduct(deletingProduct.id);
      toast({
        title: 'Product Deleted',
        description: `${deletingProduct.name} has been removed from inventory`,
      });
      await loadProducts();
      // Sync after deletion
      await ProductService.syncAllProductsToServer();
      setDeletingProduct(null);
    } catch (error) {
      console.error('Error deleting product:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete product',
        variant: 'destructive',
      });
    }
  };

  const getStockStatus = (quantity: number) => {
    if (quantity === 0) return { label: 'out of stock', color: 'text-red-500' };
    if (quantity <= 20) return { label: 'low stock', color: 'text-orange-500' };
    return { label: 'in stock', color: 'text-green-500' };
  };

  return (
    <Layout>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen bg-gray-50 dark:bg-gray-900"
      >
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 shadow-lg border-b dark:border-gray-700">
          <div className="flex items-center justify-between p-4">
            <button
              onClick={() => setLocation('/admin-main')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 dark:text-gray-300" />
            </button>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Inventory Management</h1>
            <div className="w-10" />
          </div>
        </div>

        <div className="p-4 space-y-4 pb-20">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="relative bg-white dark:bg-gray-800 p-1 rounded-xl border dark:border-gray-700 shadow-sm mb-4">
              <TabsList className="grid w-full grid-cols-2 bg-transparent relative h-10">
                <motion.div
                  className="absolute top-0 bottom-0 bg-[#FF8882] rounded-lg shadow-sm"
                  initial={false}
                  animate={{
                    x: activeTab === 'inventory' ? '0%' : '100%',
                    width: '50%'
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
                <TabsTrigger 
                  value="inventory" 
                  className="relative z-10 data-[state=active]:text-white data-[state=inactive]:text-gray-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors duration-200 h-full font-bold uppercase tracking-widest text-[10px]"
                >
                  Inventory Products
                </TabsTrigger>
                <TabsTrigger 
                  value="non-inventory" 
                  className="relative z-10 data-[state=active]:text-white data-[state=inactive]:text-gray-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors duration-200 h-full font-bold uppercase tracking-widest text-[10px]"
                >
                  Non-Inventory
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="inventory" className="space-y-4 mt-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600"
                />
              </div>

              {/* Toolbar: Dropdown (left) + Low Stock (right of dropdown) + Edit (far right) */}
              <div className="flex items-center gap-2 sm:gap-3 flex-nowrap w-full">
                {/* Left: Category Dropdown + Low Stock Indicator */}
                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                  {/* Category Dropdown */}
                  <div aria-label="Filter by category" className="w-[140px] sm:w-[160px]">
                    <Select onValueChange={setSelectedCategory} defaultValue={selectedCategory}>
                      <SelectTrigger className="h-9 text-sm border-gray-300 dark:border-gray-600 focus:border-[#FF8882]" aria-label="Category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category} value={category}>{category}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Low Stock Indicator/Filter */}
                  <Button
                    aria-label="Toggle low stock filter"
                    variant={lowStockOnly ? 'default' : 'outline'}
                    className={`${lowStockOnly ? 'bg-red-500 hover:bg-red-600 text-white' : ''} whitespace-nowrap text-xs sm:text-sm px-2 sm:px-3 flex-shrink-0`}
                    onClick={() => setLowStockOnly((v) => !v)}
                  >
                    Low Stock
                    <span
                      className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] sm:text-xs ${lowStockOnly ? 'bg-white text-red-600' : 'bg-red-100 text-red-600'}`}
                      aria-label={`Total low stock items: ${lowStockCount}`}
                    >
                      {lowStockCount}
                    </span>
                  </Button>
                </div>

                {/* Bulk Inventory Management Action Buttons */}
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap text-xs px-2.5 sm:px-3 bg-[#FF8882]/10 border-[#FF8882]/30 hover:bg-[#FF8882] hover:text-white text-[#FF8882] font-semibold transition-all flex items-center gap-1.5 rounded-lg"
                  onClick={() => setIsBulkInventoryOpen(true)}
                  title="Open Continuous Bulk Inventory Workspace"
                >
                  <Boxes className="w-3.5 h-3.5" />
                  <span>Bulk Intake</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap text-xs px-2.5 sm:px-3 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 font-medium transition-all flex items-center gap-1.5 rounded-lg"
                  onClick={() => setIsBulkHistoryOpen(true)}
                  title="View Bulk Inventory History and Delivery Logs"
                >
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  <span>Bulk History</span>
                </Button>

                {/* Import & Export Action Buttons */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,.json"
                  className="hidden"
                  onChange={handleImportFile}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap text-xs px-2.5 sm:px-3 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 text-gray-700 dark:text-gray-200 transition-all flex items-center gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                  title="Import products from CSV or JSON file"
                >
                  <Upload className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Import</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap text-xs px-2.5 sm:px-3 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 text-gray-700 dark:text-gray-200 transition-all flex items-center gap-1.5"
                  onClick={handleExportCSV}
                  title="Export current inventory products to CSV"
                >
                  <Download className="w-3.5 h-3.5 text-blue-500" />
                  <span>Export</span>
                </Button>

                {/* Far Right: Edit/Delete Toggle Button */}
                <Button
                  aria-label={selectedProductIds.size > 0 ? 'Delete selected products' : (isEditMode ? 'Cancel edit mode' : 'Enter edit mode')}
                  className="ml-auto bg-pink-500 hover:bg-pink-600 text-white transition-all duration-200 flex-shrink-0 px-3 text-xs sm:text-sm"
                  onClick={() => {
                    if (selectedProductIds.size > 0) {
                      setBulkDeleteConfirmOpen(true);
                    } else {
                      setIsEditMode(prev => !prev);
                      if (!isEditMode) setSelectedProductIds(new Set());
                    }
                  }}
                >
                  {selectedProductIds.size > 0 ? (
                    <span className="inline-flex items-center"><Trash2 className="w-4 h-4 mr-2" /> Delete</span>
                  ) : (
                    <span className="inline-flex items-center"><Edit className="w-4 h-4 mr-2" /> Edit</span>
                  )}
                </Button>
              </div>

              {/* Products Grid */}
              <div className="space-y-3">
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <Package className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                    <p>No products found</p>
                    <p className="text-sm">Add your first product to get started</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {filteredProducts.map((product, index) => {
                      const stockStatus = getStockStatus(product.quantity);
                      return (
                        <motion.div
                          key={product.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className={`bg-white dark:bg-gray-800 p-4 rounded-xl shadow-lg flex items-center space-x-4 ${isEditMode && selectedProductIds.has(product.id) ? 'ring-2 ring-pink-400' : ''} cursor-pointer hover:shadow-xl`}
                          onClick={() => setLocation(`/inventory/product/${product.id}`)}
                        >
                          {isEditMode && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${product.name}`}
                              checked={selectedProductIds.has(product.id)}
                              onChange={() => toggleSelectProduct(product.id)}
                              className="h-5 w-5 accent-pink-500"
                            />
                          )}
                          {/* Product Image */}
                          <ProductImage
                            src={product.image}
                            alt={product.name}
                            className="h-16 w-16 flex-shrink-0 rounded-lg bg-gray-100 dark:bg-gray-700"
                            iconClassName="h-8 w-8"
                          />

                          {/* Product Details */}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-800 dark:text-gray-200 truncate">{product.name}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Barcode: {product.barcode}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Category: {product.category || 'general'}</p>
                            <p className="text-[#FF8882] font-medium">₱{product.price.toFixed(2)}</p>
                            {product.quantity <= 20 && (
                              <p className="text-xs text-red-500 inline-flex items-center"><AlertTriangle className="w-3 h-3 mr-1" />Low stock</p>
                            )}
                          </div>

                          {/* Stock and Actions */}
                          <div className="text-right">
                            <div className={`text-lg font-bold ${stockStatus.color}`}>
                              {product.quantity}
                            </div>
                            <div className={`text-xs ${stockStatus.color}`}>
                              {stockStatus.label}
                            </div>
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEdit(product); }}
                                className="text-primary-500 dark:text-primary-400 p-1 touch-feedback"
                                aria-label={`Edit ${product.name}`}
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeletingProduct(product); }}
                                  className="text-red-500 dark:text-red-400 p-1 touch-feedback"
                                  title="Delete product (Admin only)"
                                  aria-label={`Delete ${product.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="non-inventory" className="mt-4">
              <NonInventoryProducts />
            </TabsContent>
          </Tabs>
        </div>

        {/* Bulk Delete Confirmation */}
        <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete selected products?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. You are about to delete {selectedProductIds.size} product(s).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel aria-label="Cancel bulk delete">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleBulkDelete} disabled={isBulkDeleting} aria-label="Confirm bulk delete">
                {isBulkDeleting ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Floating Action Button - Only visible to admins on Inventory tab */}
        {isAdmin && activeTab === 'inventory' && (
          <div className="fixed bottom-28 right-6 z-50 flex flex-col items-end space-y-3">
            {/* FAB Menu - Only shown when expanded */}
            {isFabExpanded && (
              <>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 mb-2"
                >
                  <button
                    onClick={() => {
                      setEditingProduct(null);
                      setProductImage(null);
                      form.reset({
                        name: '',
                        barcode: '',
                        price: '' as unknown as number,
                        quantity: '' as unknown as number,
                        category: undefined,
                        image: undefined,
                      });
                      setIsAddDialogOpen(true);
                      setIsFabExpanded(false);
                    }}
                    className="flex items-center space-x-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg w-full text-left"
                  >
                    <PlusCircle className="w-5 h-5 text-pink-600" />
                    <span className="text-gray-700 dark:text-gray-200">Add Product</span>
                  </button>

                  <button
                    onClick={() => {
                      setEditingCategory(null);
                      categoryForm.reset();
                      setIsCategoryDialogOpen(true);
                      setIsFabExpanded(false);
                    }}
                    className="flex items-center space-x-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg w-full text-left"
                  >
                    <Tag className="w-5 h-5 text-pink-500" />
                    <span className="text-gray-700 dark:text-gray-200">Create Category</span>
                  </button>
                </motion.div>
              </>
            )}
            
            {/* Main FAB Button */}
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              onClick={() => setIsFabExpanded(!isFabExpanded)}
              className="w-14 h-14 bg-[#FF8882] text-white rounded-full shadow-lg hover:bg-[#D89D9D] transition-colors flex items-center justify-center"
              style={{
                boxShadow: '0 4px 12px rgba(255, 136, 130, 0.3)',
              }}
            >
              {isFabExpanded ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
            </motion.button>
          </div>
        )}

        {/* Add/Edit Product Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="w-[95vw] sm:w-auto sm:max-w-lg md:max-w-xl lg:max-w-2xl max-h-[85vh] overflow-y-auto p-4 dark:bg-gray-800 dark:text-gray-200">
            <DialogHeader>
              <DialogTitle className="dark:text-gray-200">
                {editingProduct ? 'Edit Product' : 'Add New product'}
              </DialogTitle>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-1 sm:p-0">
                {/* Product Image Upload */}
                <div className="space-y-2">
                  <label htmlFor="product-image-upload" className="text-sm font-medium text-gray-700 dark:text-gray-300">Product Image</label>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-3 sm:space-y-0">
                    <div className="relative">
                      <ProductImage
                        src={productImage}
                        alt="Product preview"
                        className="h-20 w-20 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600"
                        fallbackLabel={productImage ? 'Image unavailable' : 'Add photo'}
                        iconClassName="h-8 w-8"
                      />
                      <input
                        id="product-image-upload"
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Click to upload product image
                      </p>
                    </div>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="relative">
                      <FormLabel className="text-gray-700 dark:text-gray-300">Product Name</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882] pl-3 pt-2"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem className="relative">
                      <FormLabel className="text-gray-700 dark:text-gray-300">Category</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="general">General</SelectItem>
                          {customCategories.map((category) => (
                            <SelectItem key={category} value={category}>{category}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Current Stock Display - Read-only with enhanced styling */}
                {editingProduct && (
                  <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Current Stock</p>
                      <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                        {editingProduct.quantity}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 dark:text-gray-300">Price (₱)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value)}
                            className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 dark:text-gray-300">Cost (₱)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value)}
                            className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {!editingProduct && (
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-700 dark:text-gray-300">Quantity</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              {...field}
                              onChange={(e) => field.onChange(e.target.value)}
                              className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {editingProduct && (
                    <input type="hidden" name="quantity" value={editingProduct?.quantity || 0} />
                  )}
                  
                  <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-700 dark:text-gray-300">Unit</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]">
                              <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pcs">pcs</SelectItem>
                            <SelectItem value="dozen">dozen</SelectItem>
                            <SelectItem value="box">box</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="liter">liter</SelectItem>
                            <SelectItem value="pack">pack</SelectItem>
                          </SelectContent>
                        </Select>
                        {selectedUnit === 'dozen' && !editingProduct && (
                          <p className="text-xs text-gray-500 mt-1">
                             Total: {(form.watch('quantity') || 0) * 12} pcs
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedUnit === 'box' && !editingProduct && (
                    <FormItem>
                      <FormLabel className="text-gray-700 dark:text-gray-300">Pcs per Box</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          value={pcsPerBox}
                          onChange={(e) => setPcsPerBox(parseInt(e.target.value) || 0)}
                          className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]"
                        />
                      </FormControl>
                      <p className="text-xs text-gray-500">
                         Total: {(form.watch('quantity') || 0) * pcsPerBox} pcs
                      </p>
                    </FormItem>
                  )}
                  
                  {/* Add to Stock Input - Only shown when editing */}
                  {editingProduct && (
                    <FormItem>
                      <FormLabel className="text-gray-700 dark:text-gray-300">Add to Stock</FormLabel>
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-2">
                        <Input
                          type="number"
                          min="1"
                          placeholder="Enter quantity"
                          value={stockForm.watch('addQuantity')}
                          onChange={(e) => stockForm.setValue('addQuantity', parseInt(e.target.value) || 0)}
                          className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]"
                        />
                        <Button 
                          type="button"
                          onClick={stockForm.handleSubmit(handleAddStock)}
                          disabled={isAddingStock}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <PlusCircle className="w-4 h-4 mr-1" />
                          Add
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Enter the quantity to add to current stock</p>
                      {stockForm.formState.errors.addQuantity && (
                        <p className="text-xs text-red-500 mt-1">{stockForm.formState.errors.addQuantity.message}</p>
                      )}
                    </FormItem>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="barcode"
                  render={({ field }) => (
                    <FormItem className="relative">
                      <FormLabel className="text-gray-700 dark:text-gray-300">Barcode</FormLabel>
                      <FormControl>
                        <Input 
                        {...field} 
                        className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882] pl-3 pt-2"
                      />
                      </FormControl>
                      <FormMessage />
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setLocation(editingProduct ? `/inventory/product/${editingProduct.id}/variant/add` : '/inventory/variant/add')}
                          className="px-3 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-sm"
                        >
                          Add Variant
                        </button>
                      </div>
                    </FormItem>
                  )}
                />
                


                <div className="flex space-x-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 bg-[#FF8882] hover:bg-[#D89D9D]"
                  >
                    {isLoading ? 'Saving...' : (editingProduct ? 'Update' : 'Add Product')}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Add to Inventory Dialog */}
        <Dialog open={isAddStockDialogOpen} onOpenChange={setIsAddStockDialogOpen}>
          <DialogContent className="sm:max-w-md dark:bg-gray-800 dark:text-gray-200">
            <DialogHeader>
              <DialogTitle>Add to Inventory</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search by Product ID or Name"
                  value={productLookup}
                  onChange={(e) => setProductLookup(e.target.value)}
                  className="pl-10 bg-white dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600"
                />
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-md dark:border-gray-700">
                {products
                  .filter(p => p.id.toLowerCase().includes(productLookup.toLowerCase()) || p.name.toLowerCase().includes(productLookup.toLowerCase()))
                  .map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${selectedProductId === p.id ? 'bg-gray-50 dark:bg-gray-700' : ''}`}
                    >
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">ID: {p.id} • Barcode: {p.barcode}</div>
                    </button>
                  ))}
                {products.length === 0 && (
                  <div className="p-3 text-sm text-gray-500 dark:text-gray-400">No registered products found.</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  placeholder="Quantity to add"
                  value={stockForm.watch('addQuantity') || ''}
                  onChange={(e) => stockForm.setValue('addQuantity', e.target.value as any)}
                  className="border-gray-300 dark:border-gray-600 focus:border-[#FF8882]"
                />
                <Button
                  type="button"
                  onClick={async () => {
                    if (!selectedProductId) {
                      toast({ title: 'Select a product', description: 'Choose a registered product first', variant: 'destructive' });
                      return;
                    }
                    try {
                      await ProductService.updateStock(selectedProductId, stockForm.getValues('addQuantity'));
                      await loadProducts();
                      await ProductService.syncAllProductsToServer();
                      toast({ title: 'Inventory Updated', description: 'Stock added successfully' });
                      setIsAddStockDialogOpen(false);
                      setSelectedProductId(null);
                      stockForm.reset({ addQuantity: 1 });
                    } catch (error) {
                      toast({ title: 'Error', description: 'Failed to add stock', variant: 'destructive' });
                    }
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  Add
                </Button>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddStockDialogOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deletingProduct} onOpenChange={() => setDeletingProduct(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Product</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deletingProduct?.name}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-500 hover:bg-red-600"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Category Delete Confirmation */}
        <AlertDialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Category</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the category "{deletingCategory}"? This won't affect products already using this category.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deletingCategory && handleDeleteCategory(deletingCategory)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Category Creation Dialog */}
        <Dialog 
          open={isCategoryDialogOpen} 
          onOpenChange={(open) => {
            setIsCategoryDialogOpen(open);
            if (!open) {
              setEditingCategory(null);
              categoryForm.reset();
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingCategory ? 'Edit Category' : 'Create New Category'}</DialogTitle>
            </DialogHeader>
            <Form {...categoryForm}>
              <form onSubmit={categoryForm.handleSubmit(handleAddCategory)} className="space-y-4">
                <FormField
                  control={categoryForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Enter category name" 
                          {...field} 
                          className="bg-white dark:bg-gray-800"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* List of existing categories */}
                {customCategories.length > 0 && (
                  <div className="mt-4 border rounded-md overflow-hidden flex flex-col max-h-[30vh]">
                    <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 text-sm font-medium flex-none sticky top-0 z-10">
                      Existing Categories
                    </div>
                    <div className="divide-y divide-gray-200 dark:divide-gray-700 overflow-y-auto">
                      {customCategories.map((category, index) => (
                        <div key={index} className="px-4 py-3 flex justify-between items-center">
                          <div className="text-sm">
                            <span className="text-gray-500 dark:text-gray-400">Category Created: </span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{category}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditCategory(category)}
                              className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeletingCategory(category)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex justify-end space-x-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCategoryDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit"
                    className="bg-pink-500 hover:bg-pink-600 text-white"
                    disabled={isLoading}
                  >
                    {editingCategory ? 'Update' : 'Create'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Bulk Inventory Workspace Modal */}
        <BulkInventoryWorkspace
          isOpen={isBulkInventoryOpen}
          onClose={() => setIsBulkInventoryOpen(false)}
          onSuccess={loadProducts}
        />

        {/* Bulk Inventory History Modal */}
        <BulkInventoryHistory
          isOpen={isBulkHistoryOpen}
          onClose={() => setIsBulkHistoryOpen(false)}
        />
      </motion.div>
    </Layout>
  );
};

export default InventoryManagement;
