import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, MoreVertical, Trash2, Edit, Barcode, Download, Tag, Info, Package, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { NonInventoryProductService } from '@/lib/db';
import ProductImage from '@/components/ProductImage';
import type { NonInventoryProduct } from '@shared/schema';
import BarcodeModal from './BarcodeModal';
import BarcodePreview from './BarcodePreview';
import { LocalizedContent } from '@/contexts/LanguageContext';

const nonInventorySchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  price: z.number().min(0.01, 'Price must be greater than 0'),
  category: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  barcode: z.string().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
});

type NonInventoryFormData = z.infer<typeof nonInventorySchema>;
type CategoryFormData = z.infer<typeof categorySchema>;

const NonInventoryProducts: React.FC = () => {
  const { toast } = useToast();
  const [products, setProducts] = useState<NonInventoryProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<NonInventoryProduct | null>(null);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<NonInventoryProduct | null>(null);
  const [productImage, setProductImage] = useState<string | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<NonInventoryProduct | null>(null);

  // Category management state
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<string[]>([]);

  const form = useForm<NonInventoryFormData>({
    resolver: zodResolver(nonInventorySchema),
    defaultValues: {
      name: '',
      price: 0,
      category: 'general',
      description: '',
      image: '',
      barcode: '',
    },
  });

  const categoryForm = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '' },
  });

  // Load categories from localStorage
  const loadCategories = () => {
    try {
      const savedCategories = localStorage.getItem('nonInventoryCustomCategories');
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
      localStorage.setItem('nonInventoryCustomCategories', JSON.stringify(categories));
    } catch (error) {
      console.error('Error saving categories:', error);
    }
  };

  // Add new category or update existing one
  const handleAddCategory = (data: CategoryFormData) => {
    if (editingCategory) {
      if (data.name !== editingCategory && customCategories.includes(data.name)) {
        toast({ title: 'Error', description: 'Category name already exists', variant: 'destructive' });
        return;
      }
      const newCategories = customCategories.map(c => c === editingCategory ? data.name : c);
      setCustomCategories(newCategories);
      saveCategories(newCategories);
      toast({ title: 'Category Updated', description: `Category has been updated to "${data.name}"` });
      setEditingCategory(null);
    } else {
      if (customCategories.includes(data.name)) {
        toast({ title: 'Error', description: 'Category already exists', variant: 'destructive' });
        return;
      }
      const newCategories = [...customCategories, data.name];
      setCustomCategories(newCategories);
      saveCategories(newCategories);
      toast({ title: 'Category Added', description: `${data.name} has been added to categories` });
    }
    setIsCategoryDialogOpen(false);
    categoryForm.reset();
  };

  const loadProducts = async () => {
    try {
      const allProducts = await NonInventoryProductService.getAllNonInventoryProducts();
      setProducts(allProducts);
    } catch (error) {
      console.error('Error loading non-inventory products:', error);
      toast({
        title: 'Error',
        description: 'Failed to load non-inventory products',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    loadProducts();
    loadCategories();
  }, []);

  // Get unique categories for filter chips
  const allProductCategories = Array.from(new Set(products.map(p => p.category || 'general')));
  const categories = ['All', ...allProductCategories, ...customCategories.filter(c => !allProductCategories.includes(c))];

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

  const onSubmit = async (data: NonInventoryFormData) => {
    setIsLoading(true);
    try {
      // Auto-generate barcode if not provided
      const barcodeValue = data.barcode || `NI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      if (editingProduct) {
        await NonInventoryProductService.updateNonInventoryProduct(editingProduct.id, {
          ...data,
          barcode: barcodeValue,
        });
        toast({
          title: 'Product Updated',
          description: `${data.name} has been updated`,
        });
      } else {
        await NonInventoryProductService.addNonInventoryProduct({
          ...data,
          barcode: barcodeValue,
        });
        toast({
          title: 'Product Added',
          description: `${data.name} has been added successfully`,
        });
      }

      await loadProducts();
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

  const handleEdit = (product: NonInventoryProduct) => {
    setEditingProduct(product);
    setProductImage(product.image || null);
    form.reset({
      name: product.name,
      price: product.price,
      category: product.category || 'general',
      description: product.description || '',
      image: product.image || '',
      barcode: product.barcode || '',
    });
    setIsAddDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingProduct) return;
    
    try {
      await NonInventoryProductService.deleteNonInventoryProduct(deletingProduct.id);
      toast({
        title: 'Product Deleted',
        description: `${deletingProduct.name} removed successfully`,
      });
      await loadProducts();
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

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <LocalizedContent>
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search non-inventory products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 dark:text-gray-200"
            />
          </div>
          {/* Category Select */}
          <div className="w-full sm:w-40">
            <Select onValueChange={setSelectedCategory} value={selectedCategory}>
              <SelectTrigger className="h-10 text-sm border-gray-300 dark:border-gray-600 focus:border-[#FF8882]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(category => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Category Management Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCategory(null);
              categoryForm.reset();
              setIsCategoryDialogOpen(true);
            }}
            className="h-10"
          >
            <Tag className="w-4 h-4 mr-2" />
            Categories
          </Button>
        </div>
        <Button
          onClick={() => {
            setEditingProduct(null);
            setProductImage(null);
            form.reset();
            setIsAddDialogOpen(true);
          }}
          className="w-full sm:w-auto gap-2 bg-[#FF8882] hover:bg-[#FF7770] text-white"
        >
          <Plus className="w-4 h-4" />
          Add Non-Inventory
        </Button>
      </div>

      {/* Product List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence>
          {filteredProducts.map((product) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <Card className="overflow-hidden bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-3">
                    <ProductImage
                      src={product.image}
                      alt={product.name}
                      className="w-10 h-10 rounded-full bg-[#FF8882]/10"
                      iconClassName="w-5 h-5 text-[#FF8882]"
                    />
                    <div>
                      <CardTitle className="text-base font-semibold dark:text-white">{product.name}</CardTitle>
                      <CardDescription className="text-xs dark:text-gray-400">{product.category}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedProduct(product);
                        setIsBarcodeModalOpen(true);
                      }}
                      className="text-gray-500 hover:text-[#FF8882] hover:bg-[#FF8882]/10 h-8 w-8"
                    >
                      <Barcode className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(product)}
                      className="text-gray-500 hover:text-blue-500 hover:bg-blue-50 h-8 w-8"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingProduct(product)}
                      className="text-gray-500 hover:text-red-500 hover:bg-red-50 h-8 w-8"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">₱{product.price.toFixed(2)}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{product.barcode}</span>
                  </div>
                  {product.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{product.description}</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {filteredProducts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-white dark:bg-gray-800 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700">
          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">No products found</h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-xs mt-1">
            {searchTerm ? "Try adjusting your search terms" : "Start by adding your first non-inventory product"}
          </p>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-white">{editingProduct ? 'Edit Non-Inventory Product' : 'Add Non-Inventory Product'}</DialogTitle>
            <DialogDescription className="dark:text-gray-400">
              Create a product that doesn't track inventory levels. Barcode will be auto-generated if left blank.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              {/* Image Upload */}
              <div className="flex justify-center mb-6">
                <div className="relative group cursor-pointer" onClick={() => document.getElementById('non-inv-image')?.click()}>
                  <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center overflow-hidden transition-all group-hover:border-[#FF8882]">
                    <ProductImage
                      src={productImage}
                      alt="Product preview"
                      className="h-full w-full"
                      fallbackLabel="Add photo"
                    />
                  </div>
                  <input
                    id="non-inv-image"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Product Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter product name" {...field} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="dark:text-gray-200">Price (₱)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                          className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
                    <FormItem>
                      <FormLabel className="dark:text-gray-200">Category</FormLabel>
                      <FormControl>
                        <Select onValueChange={field.onChange} value={field.value || 'general'}>
                          <SelectTrigger className="dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map(category => category !== 'All' && (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Custom Barcode (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Leave blank to auto-generate" {...field} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Description (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Additional details..." {...field} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                  className="dark:text-white dark:border-gray-600"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="bg-[#FF8882] hover:bg-[#FF7770] text-white"
                >
                  {isLoading ? 'Saving...' : editingProduct ? 'Update Product' : 'Add Product'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Barcode Modal */}
      {selectedProduct && (
        <BarcodeModal
          isOpen={isBarcodeModalOpen}
          onClose={() => setIsBarcodeModalOpen(false)}
          productName={selectedProduct.name}
          barcode={selectedProduct.barcode}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingProduct} onOpenChange={(open) => !open && setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Non-Inventory Product?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{deletingProduct?.name}" from the system.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Category Management Dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white">
              {editingCategory ? 'Edit Category' : 'Create Category'}
            </DialogTitle>
          </DialogHeader>
          <Form {...categoryForm}>
            <form onSubmit={categoryForm.handleSubmit(handleAddCategory)} className="space-y-4 py-2">
              <FormField
                control={categoryForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Category Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter category name" {...field} className="dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCategoryDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-[#FF8882] hover:bg-[#FF7770] text-white">
                  {editingCategory ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
    </LocalizedContent>
  );
};

export default NonInventoryProducts;
