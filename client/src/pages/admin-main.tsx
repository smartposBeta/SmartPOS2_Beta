import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { LogOut, DollarSign, Package, Plus, Eye, Calendar, CreditCard, Receipt, User, FileText, Lock, FileSpreadsheet, BarChart3, Bell, CheckCircle, Clock, ArrowRight, Monitor, Tablet, Smartphone, Trash2, Edit, RefreshCw, History, Cloud, Download, Settings, X, AlertTriangle, WifiOff } from 'lucide-react';
import Layout from '@/components/Layout';
import FloatingActionButton from '@/components/FloatingActionButton';
import { useAuth } from '@/contexts/AuthContext';
import { useDevices } from '@/contexts/DeviceContext';
import {
    SalesService, ProductService, ExpenseService, PurchaseService, CreditorService, NotificationService, RemittanceService, db
} from '@/lib/db';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { Notification, Remittance } from '@shared/schema';
import { useLanguage } from '@/contexts/LanguageContext';

// Schemas for expenses and purchases
const expenseSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  category: z.string().min(1, 'Category is required'),
  date: z.string().min(1, 'Date is required'),
});

const purchaseSchema = z.object({
  productName: z.string().min(1, 'Product name is required'),
  quantity: z.number().min(1, 'Quantity must be at least 1'),
  cost: z.number().min(0.01, 'Cost must be greater than 0'),
  supplier: z.string().min(1, 'Supplier is required'),
  date: z.string().min(1, 'Date is required'),
});

const creditorSchema = z.object({
  name: z.string().min(1, 'Creditor name is required'),
  amount: z.number().min(0.01, 'Amount must be greater than 0'),
  description: z.string().min(1, 'Description is required'),
  dueDate: z.string().min(1, 'Due date is required'),
  reminderDate: z.string().min(1, 'Reminder date is required'),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;
type PurchaseFormData = z.infer<typeof purchaseSchema>;
type CreditorFormData = z.infer<typeof creditorSchema>;

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
}

interface Purchase {
  id: string;
  productName: string;
  quantity: number;
  cost: number;
  supplier: string | null;
  date: string;
}

interface Creditor {
  id: string;
  name: string;
  amount: number;
  description: string;
  dueDate: string;
  reminderDate: string;
  isPaid: boolean;
}

const AdminMain: React.FC = () => {
  const { user, logout, socket } = useAuth();
  const { deviceMode } = useDevices();
  const { language, setLanguage, t } = useLanguage();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { isOnline } = useNetworkStatus();
  const [showAdminOfflinePrompt, setShowAdminOfflinePrompt] = useState(!navigator.onLine);
  
  const [stats, setStats] = useState({
    todaySales: 0,
    totalProducts: 0,
    totalIncome: 0,
    revenueTrend: '+0.0%',
    expenseTrend: '+0.0%',
    profitTrend: '+0.0%',
  });

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [creditors, setCreditors] = useState<Creditor[]>([]);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isAddPurchaseOpen, setIsAddPurchaseOpen] = useState(false);
  const [isAddCreditorOpen, setIsAddCreditorOpen] = useState(false);
  const [selectedMonth] = useState(new Date().getMonth());
  const [selectedYear] = useState(new Date().getFullYear());
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedRemittance, setSelectedRemittance] = useState<Remittance | null>(null);
  const [remittanceSalesBreakdown, setRemittanceSalesBreakdown] = useState<any[]>([]);
  const [isConfirmingRemit, setIsConfirmingRemit] = useState(false);
  const [activeTab, setActiveTab] = useState<'updates' | 'remittance' | 'completed'>('updates');
  const [pendingRemittances, setPendingRemittances] = useState<Remittance[]>([]);
  const [confirmedRemittances, setConfirmedRemittances] = useState<Remittance[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<string[]>([]);

  useEffect(() => {
    if (selectedRemittance) {
      SalesService.getAllSales().then(allSales => {
        const staffSales = allSales.filter(s => 
          s.staffId === selectedRemittance.staffId || 
          (s as any).staff_id === selectedRemittance.staffId ||
          (s as any).staffId === (selectedRemittance as any).staff_id
        );
        setRemittanceSalesBreakdown(staffSales);
      }).catch(err => console.warn('Failed to load remittance breakdown sales:', err));
    } else {
      setRemittanceSalesBreakdown([]);
    }
  }, [selectedRemittance]);

  const [chartData, setChartData] = useState<Array<{ date: string; income: number; expenses: number }>>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [staffPerformance, setStaffPerformance] = useState<any[]>([]);

  const expenseForm = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: '',
      amount: 0,
      category: '',
      date: new Date().toISOString().split('T')[0],
    },
  });

  const purchaseForm = useForm<PurchaseFormData>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      productName: '',
      quantity: 1,
      cost: 0,
      supplier: '',
      date: new Date().toISOString().split('T')[0],
    },
  });
  
  const creditorForm = useForm<CreditorFormData>({
    resolver: zodResolver(creditorSchema),
    defaultValues: {
      name: '',
      amount: 0,
      description: '',
      dueDate: new Date().toISOString().split('T')[0],
      reminderDate: new Date().toISOString().split('T')[0],
    },
  });

  const handleTutorialClick = () => {
    console.log('Tutorial started');
  };

  const handleAddExpense = async (data: ExpenseFormData) => {
    try {
      await ExpenseService.addExpense({
        tenantId: (user as any)?.tenantId || '',
        description: data.description,
        amount: data.amount,
        category: data.category,
        date: new Date(data.date),
      });
      setIsAddExpenseOpen(false);
      expenseForm.reset();
      toast({ title: t('expenseAdded'), description: `${data.description} has been added` });
      loadFinancialData();
      loadStats();
    } catch (error) {
      toast({ title: t('error'), description: t('failedToAddExpense'), variant: 'destructive' });
    }
  };

  const handleAddPurchase = async (data: PurchaseFormData) => {
    try {
      await PurchaseService.addPurchase({
        tenantId: (user as any)?.tenantId || '',
        productName: data.productName,
        quantity: data.quantity,
        cost: data.cost,
        supplier: data.supplier || null,
        date: new Date(data.date),
        description: null,
        details: null,
        expirationDate: null,
      });
      setIsAddPurchaseOpen(false);
      purchaseForm.reset();
      toast({ title: t('purchaseAdded'), description: `${data.productName} has been added` });
      loadFinancialData();
      loadStats();
    } catch (error) {
      toast({ title: t('error'), description: t('failedToAddPurchase'), variant: 'destructive' });
    }
  };
  
  const handleAddCreditor = async (data: CreditorFormData) => {
    try {
      await CreditorService.addCreditor({
        tenantId: (user as any)?.tenantId || '',
        name: data.name,
        amount: data.amount,
        description: data.description,
        dueDate: new Date(data.dueDate),
        reminderDate: new Date(data.reminderDate),
        isPaid: false,
      });
      setIsAddCreditorOpen(false);
      creditorForm.reset();
      toast({ title: t('creditorAdded'), description: `${data.name} has been added to the ledger` });
      loadFinancialData();
    } catch (error) {
      toast({ title: t('error'), description: t('failedToAddCreditor'), variant: 'destructive' });
    }
  };

  const formatDateSafely = (date: any) => {
    try {
      const d = date instanceof Date ? date : new Date(date ?? Date.now());
      if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
      return d.toISOString().split('T')[0];
    } catch (e) {
      return new Date().toISOString().split('T')[0];
    }
  };

  const loadFinancialData = async () => {
    try {
      const [expensesData, purchasesData, creditorsData] = await Promise.all([
        ExpenseService.getAllExpenses(),
        PurchaseService.getAllPurchases(),
        CreditorService.getAllCreditors(),
      ]);
      setExpenses(expensesData.map(e => ({
        id: e.id,
        description: e.description,
        amount: Number(e.amount) || 0,
        category: e.category,
        date: formatDateSafely(e.date),
      })));
      setPurchases(purchasesData.map(p => ({
        id: p.id,
        productName: p.productName,
        quantity: Number(p.quantity) || 0,
        cost: Number(p.cost) || 0,
        supplier: p.supplier ?? null,
        date: formatDateSafely(p.date),
      })));
      setCreditors(creditorsData.map(c => ({
        id: c.id,
        name: c.name,
        amount: Number(c.amount) || 0,
        description: c.description ?? '',
        dueDate: formatDateSafely(c.dueDate),
        reminderDate: formatDateSafely(c.reminderDate),
        isPaid: !!c.isPaid,
      })));
    } catch (error) {
      console.error('Error loading financial data:', error);
    }
  };

  const calculateTrend = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+100%' : '+0.0%';
    const diff = ((current - previous) / previous) * 100;
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
  };

  const loadStats = async () => {
    try {
      await SalesService.syncWithServer();
      const products = await ProductService.getAllProducts();
      const todaysSales = await SalesService.getTodaysSales();
      const todaysTotal = Array.isArray(todaysSales)
        ? todaysSales.reduce((sum, sale) => sum + (sale.total || 0), 0)
        : 0;
      const totalIncome = await SalesService.getTotalSales();

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const allSales = await db.sales.toArray();
      const allExpenses = await db.expenses.toArray();

      const currentWeekSales = allSales
        .filter(s => {
          const d = new Date(s.createdAt as any);
          return !isNaN(d.getTime()) && d >= oneWeekAgo;
        })
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);
      const previousWeekSales = allSales
        .filter(s => {
          const d = new Date(s.createdAt as any);
          return !isNaN(d.getTime()) && d >= twoWeeksAgo && d < oneWeekAgo;
        })
        .reduce((sum, s) => sum + (Number(s.total) || 0), 0);

      const currentWeekExpenses = allExpenses
        .filter(e => {
          const d = new Date(e.date);
          return !isNaN(d.getTime()) && d >= oneWeekAgo;
        })
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const previousWeekExpenses = allExpenses
        .filter(e => {
          const d = new Date(e.date);
          return !isNaN(d.getTime()) && d >= twoWeeksAgo && d < oneWeekAgo;
        })
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      const currentProfit = currentWeekSales - currentWeekExpenses;
      const previousProfit = previousWeekSales - previousWeekExpenses;

      setStats({
        todaySales: todaysTotal,
        totalProducts: products.length,
        totalIncome,
        revenueTrend: calculateTrend(currentWeekSales, previousWeekSales),
        expenseTrend: calculateTrend(currentWeekExpenses, previousWeekExpenses),
        profitTrend: calculateTrend(currentProfit, previousProfit),
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadChartData = async () => {
    try {
      const sales = await db.sales.toArray();
      const allExpenses = await db.expenses.toArray();
      const allSaleItems = await db.saleItems.toArray();
      const allProducts = await db.products.toArray();
      const allStaff = await db.staff.toArray();

      const days = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        d.setHours(0, 0, 0, 0);
        return d;
      });

      const data = days.map(d => {
        const next = new Date(d);
        next.setHours(23, 59, 59, 999);
        const income = sales
          .filter(s => {
            const c = new Date(s.createdAt as any);
            return !isNaN(c.getTime()) && c >= d && c <= next && (s.paymentType as any) !== 'credits';
          })
          .reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        const exp = allExpenses
          .filter(e => {
            const c = new Date(e.date);
            return !isNaN(c.getTime()) && c >= d && c <= next;
          })
          .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        return { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), income, expenses: exp };
      });
      setChartData(data);

      const staffMap = new Map(allStaff.map(s => [s.id, s.name]));
      const mappedSales = sales
        .sort((a, b) => {
          const da = new Date(a.createdAt as any).getTime();
          const db = new Date(b.createdAt as any).getTime();
          return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);
        })
        .map(s => ({
          ...s,
          total: Number(s.total) || 0,
          staffName: s.staffId ? staffMap.get(s.staffId) : 'Owner'
        }));

      setSalesHistory(mappedSales);
      setRecentTransactions(mappedSales.slice(0, 5));

      const productSales = new Map();
      allSaleItems.forEach(item => {
        const current = productSales.get(item.productId) || 0;
        productSales.set(item.productId, current + item.quantity);
      });
      const top = allProducts
        .map(p => ({ name: p.name, sales: productSales.get(p.id) || 0, price: p.price }))
        .filter(p => p.sales > 0)
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 5);
      setTopProducts(top);

      const staffSales = new Map();
      sales.forEach(s => {
        const sid = s.staffId || 'owner';
        const current = staffSales.get(sid) || 0;
        staffSales.set(sid, current + (s.total || 0));
      });
      const perf = [{ name: 'Owner', sales: staffSales.get('owner') || 0 }, ...allStaff.map(s => ({ name: s.name, sales: staffSales.get(s.id) || 0 }))]
        .filter(p => p.sales > 0)
        .sort((a, b) => b.sales - a.sales);
      setStaffPerformance(perf);
    } catch (error) {
      console.error('Failed to load chart data', error);
    }
  };

  const loadNotifications = async () => {
    try {
      await NotificationService.checkAndGenerateLowStockAlerts();
      const list = await NotificationService.list();
      setNotifications(list);
      const count = await NotificationService.getUnreadCount();
      setUnreadCount(count);
      const pending = await RemittanceService.listPending();
      setPendingRemittances(pending);
      const confirmed = await RemittanceService.listConfirmed();
      setConfirmedRemittances(confirmed);
    } catch (error) {
      console.error('Failed to load notifications', error);
    }
  };

  useEffect(() => {
    loadStats();
    loadFinancialData();
    loadChartData();
    loadNotifications();

    if (socket) {
      socket.on('notification-received', (notification: Notification) => {
        setNotifications(prev => [notification, ...prev]);
        setUnreadCount(prev => prev + 1);
        if (notification.type === 'inventory_alert') {
          let productName = notification.message;
          try {
            const data = typeof notification.data === 'string' ? JSON.parse(notification.data) : notification.data;
            productName = data?.productName || productName;
          } catch {}
          toast({ title: 'Low Stock', description: productName });
        } else {
          toast({ title: "New Notification", description: notification.message });
        }
        loadNotifications();
      });
      socket.on('remittance-sent', () => {
        loadNotifications();
        loadStats();
        loadFinancialData();
      });
      socket.on('new-remittance', () => {
        loadNotifications();
        loadStats();
        loadFinancialData();
      });
      socket.on('remittance-confirmed', () => {
        loadNotifications();
        loadStats();
        loadFinancialData();
      });
      socket.on('remittance-cancelled', () => {
        loadNotifications();
      });
      socket.on('unread-count-changed', (data: { count: number }) => {
        if (typeof data?.count === 'number') {
          setUnreadCount(data.count);
        }
      });
    }

    const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => {
      clearInterval(timer);
      if (socket) {
        socket.off('notification-received');
        socket.off('remittance-sent');
        socket.off('new-remittance');
        socket.off('remittance-confirmed');
        socket.off('remittance-cancelled');
        socket.off('unread-count-changed');
      }
    };
  }, [socket]);

  const handleMarkAsRead = async (id: string) => {
    try {
      const wasUnread = notifications.some(notification =>
        notification.id === id && !notification.isRead
      );
      await NotificationService.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      if (wasUnread) setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read', error);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    handleMarkAsRead(notification.id);
    if (notification.type === 'remittance' && notification.data) {
      try {
        const rawData = notification.data;
        const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        const remitId = data?.remittanceId || data?.id || data?.remittance_id;
        if (remitId) {
          fetchAndShowRemittance(remitId);
        }
      } catch (e) {
        console.error('Failed to parse notification data', e);
      }
    } else if (notification.type === 'inventory_alert') {
      setShowNotifications(false);
      if (notification.data) {
        try {
          const d = typeof notification.data === 'string' ? JSON.parse(notification.data) : notification.data;
          if (d.productId) {
            setLocation(`/inventory/product/${d.productId}`);
            return;
          }
        } catch {}
      }
      setLocation('/inventory');
    }
  };

  const fetchAndShowRemittance = async (id: string) => {
    try {
      const pending = await RemittanceService.listPending();
      let found = pending.find((r: Remittance) => r.id === id);
      if (!found) {
        // Direct server fallback
        try {
          const res = await api.get<any[]>('/api/remittances/pending');
          if (Array.isArray(res)) {
            const raw = res.find((r: any) => r.id === id || r.remittance_id === id);
            if (raw) {
              found = {
                id: raw.id,
                tenantId: raw.tenantId || raw.tenant_id || '',
                staffId: raw.staffId || raw.staff_id || '',
                staffName: raw.staffName || raw.staff_name || 'Staff',
                amount: Number(raw.amount || 0),
                transactionCount: Number(raw.transactionCount || raw.transaction_count || 0),
                status: raw.status || 'pending',
                createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
                confirmedAt: raw.confirmedAt ? new Date(raw.confirmedAt) : (raw.confirmed_at ? new Date(raw.confirmed_at) : null)
              };
            }
          }
        } catch (serverErr) {
          console.warn('Failed to fetch pending remittance fallback from server:', serverErr);
        }
      }
      if (found) {
        setSelectedRemittance(found);
      } else {
        toast({ title: "Remittance Not Found", description: "This remittance may have already been processed." });
      }
    } catch (error) {
      console.error('Failed to fetch remittance', error);
    }
  };

  const handleConfirmRemittance = async () => {
    if (!selectedRemittance) return;
    setIsConfirmingRemit(true);
    try {
      const res = await RemittanceService.confirm(selectedRemittance.id);
      if (res.success) {
        toast({ title: "Remittance Confirmed", description: `Confirmed receipt of ₱${selectedRemittance.amount.toLocaleString()} from ${selectedRemittance.staffName}.` });
        setSelectedRemittance(null);
        loadStats();
        loadNotifications(); // Refresh remittances
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to confirm remittance. Please try again.", variant: "destructive" });
    } finally {
      setIsConfirmingRemit(false);
    }
  };

  const handleCancelRemittance = async (remittance: Remittance) => {
    try {
      const res = await RemittanceService.cancel(remittance.id);
      if (res.success) {
        toast({ title: 'Remittance Cancelled', description: `Remittance from ${remittance.staffName} has been cancelled.` });
        loadNotifications(); // Refresh remittances
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to cancel remittance. Please try again.', variant: 'destructive' });
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await NotificationService.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast({ title: 'Success', description: 'All notifications marked as read.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to mark all as read.', variant: 'destructive' });
    }
  };

  const handleDeleteNotification = async (id: string) => {
    try {
      await NotificationService.delete(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      setSelectedNotificationIds(prev => prev.filter(i => i !== id));
      toast({ title: 'Success', description: 'Notification deleted.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete notification.', variant: 'destructive' });
    }
  };

  const handleDeleteSelected = async () => {
    try {
      await NotificationService.deleteMany(selectedNotificationIds);
      setNotifications(prev => prev.filter(n => !selectedNotificationIds.includes(n.id)));
      setSelectedNotificationIds([]);
      setIsSelectMode(false);
      toast({ title: 'Success', description: 'Selected notifications deleted.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete notifications.', variant: 'destructive' });
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedNotificationIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const loadData = async () => {
    await Promise.all([
      loadStats(),
      loadFinancialData(),
      loadChartData(),
      loadNotifications(),
    ]);
  };

  const handleExportCSV = () => {
      const rows = [
        ['Report Date', currentDateTime.toLocaleString()],
        ['Today Sales', stats.todaySales.toFixed(2)],
        ['Total Income', stats.totalIncome.toFixed(2)],
        ['Total Expenses', totalExpenses.toFixed(2)],
        ['Net Profit', (stats.totalIncome - totalExpenses).toFixed(2)],
        ['Total Products', stats.totalProducts],
        [],
        ['Full Transaction History'],
        ['ID', 'Staff', 'Type', 'Total', 'Date'],
        ...salesHistory.map(tx => [tx.id, tx.staffName, tx.paymentType, tx.total.toFixed(2), new Date(tx.createdAt).toLocaleString()])
      ];
      const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
      
      const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `SmartPOS_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Report Exported", description: "Business summary has been downloaded as CSV" });
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const profit = stats.totalIncome - totalExpenses;

  const getFilteredCreditors = () => {
    return creditors.filter(creditor => {
      const dueDate = new Date(creditor.dueDate);
      return dueDate.getMonth() === selectedMonth && dueDate.getFullYear() === selectedYear;
    });
  };

  return (
    <Layout>
      {!isOnline && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 flex items-center justify-between text-xs text-amber-600 dark:text-amber-300 z-50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span>
              <strong>Offline Mode Active:</strong> Remittances, real-time staff status tracking, and cloud sync are unavailable while offline. Local changes will save to device.
            </span>
          </div>
        </div>
      )}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          "min-h-screen bg-background flex flex-col overflow-hidden",
          (deviceMode === 'pc' || deviceMode === 'tablet') ? "h-screen" : ""
        )}
      >
        {/* Header - Fixed */}
        <div className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-100/50 flex-none">
          <div className={cn(
            "max-w-7xl mx-auto flex items-center justify-between",
            deviceMode === 'mobile' ? "p-4" : "p-4 px-6"
          )}>
            <div className="flex flex-col">
              <h1 className="text-xl font-black tracking-tighter gold-gradient-text uppercase">SmartPOS+</h1>
              <div className="text-[8px] font-bold tracking-[0.2em] text-gray-400 mt-1 uppercase">
                {currentDateTime.toLocaleDateString('en-US', {month: 'short', day: '2-digit'})} • {currentDateTime.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                  aria-haspopup="dialog"
                  className="w-10 h-10 rounded-xl bg-white border border-gray-100 shadow-sm relative group"
                  onClick={() => setShowNotifications(true)}
                >
                  <Bell className={cn("w-4 h-4 transition-colors", unreadCount > 0 ? "text-red-600" : "text-gray-400 group-hover:text-[#BF953F]")} />
                  {unreadCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm motion-safe:animate-pulse"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 bg-white p-1 pr-3 rounded-full border border-gray-100 shadow-sm hover:shadow-md transition-all focus:outline-none group">
                  <div className="w-8 h-8 bg-gradient-to-br from-[#BF953F] to-[#B38728] rounded-full flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <div className="hidden sm:flex flex-col items-start">
                    <span className="text-[10px] font-bold text-gray-800 uppercase tracking-wider">{t('admin')}</span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" className="w-56 bg-white border border-gray-100 shadow-2xl rounded-2xl p-2 z-[60]">
                  <DropdownMenuItem
                    onClick={async () => { 
                      try {
                        toast({ title: t('syncingToCloud'), description: t('pushingAllData') });
                        const result = await api.post('/api/sync/push-all', {});
                        if (result.success) {
                          toast({ title: t('success'), description: t('allDataBackedUp') });
                        } else {
                          toast({ title: t('syncFailed'), description: result.error || t('somethingWentWrong'), variant: 'destructive' });
                        }
                      } catch (error) {
                        toast({ title: t('syncFailed'), description: error instanceof Error ? error.message : t('somethingWentWrong'), variant: 'destructive' });
                      }
                    }}
                    className="h-12 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-600 cursor-pointer flex items-center group"
                  >
                    <Cloud className="w-4 h-4 mr-3 text-gray-400 group-hover:text-blue-500" />
                    <span>{t('pushToCloud')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      try {
                        toast({ title: "Fetching from Cloud...", description: "Downloading all products, staff, and tenant data from Supabase." });
                        const result = await SalesService.fetchFromCloud();
                        if (result.success) {
                          toast({ title: "Data Fetched Successfully", description: "Your local database has been updated with all data from Supabase." });
                          await Promise.all([loadStats(), loadFinancialData(), loadChartData(), loadNotifications()]);
                        }
                      } catch (error: any) {
                        toast({ title: "Fetch Failed", description: error?.message || "Unable to download data from Supabase.", variant: "destructive" });
                      }
                    }}
                    className="h-12 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer flex items-center group"
                  >
                    <Download className="w-4 h-4 mr-3 text-gray-400 group-hover:text-emerald-500" />
                    <span>Fetch Data from Cloud</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="h-12 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">
                      <span>{t('language')}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40 bg-white border border-gray-100 shadow-2xl rounded-2xl p-2 z-[60]">
                      <DropdownMenuRadioGroup value={language} onValueChange={(value) => setLanguage(value as 'en' | 'tl')}>
                        <DropdownMenuRadioItem value="en" className="h-10 rounded-xl cursor-pointer">{t('english')}</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="tl" className="h-10 rounded-xl cursor-pointer">{t('tagalog')}</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    onClick={() => { logout(); setLocation('/role-selection'); }}
                    className="h-12 px-4 rounded-xl text-sm font-semibold text-gray-700 hover:bg-red-50 hover:text-red-600 cursor-pointer flex items-center group"
                  >
                    <LogOut className="w-4 h-4 mr-3 text-gray-400 group-hover:text-red-500" />
                    <span>{t('terminateSession')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Main Content Area - Scrollable internally if needed */}
        <div className={cn(
          "flex-1 overflow-y-auto custom-scrollbar",
          (deviceMode === 'pc' || deviceMode === 'tablet') ? "p-4 space-y-4 max-w-7xl mx-auto w-full" : "p-4 space-y-4"
        )}>
          {/* Top Row: Welcome & Stats */}
          <div className={cn(
            "grid gap-4",
            (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"
          )}>
            {/* Welcome Section */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={cn(
                "relative overflow-hidden bg-white border border-gray-100 shadow-sm p-4 rounded-2xl lg:col-span-1",
                (deviceMode === 'pc' || deviceMode === 'tablet') ? "h-auto" : ""
              )}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[#BF953F]/10 to-transparent rounded-full -mr-10 -mt-10 blur-2xl"></div>
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-[#BF953F]/10 border border-[#BF953F]/20 mb-2">
                  <div className="w-1 h-1 rounded-full bg-[#BF953F] animate-pulse"></div>
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] text-[#BF953F]">{t('active')}</span>
                </div>
                <h1 className="text-xl font-black text-gray-900 tracking-tighter leading-tight">
                  Hi, <span className="gold-gradient-text">{user?.ownerName || user?.username || 'Admin'}</span>
                </h1>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-[9px] font-bold uppercase" onClick={() => setLocation('/admin/reports')}>{t('reports')}</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[9px] font-bold uppercase" onClick={handleExportCSV}>{t('export')}</Button>
                </div>
              </div>
            </motion.div>

            {/* Quick Stats Grid - Compact */}
            <div className={cn(
              "grid gap-3 lg:col-span-2",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-4" : "grid-cols-2"
            )}>
              {[
                { 
                  icon: DollarSign, 
                  value: `₱${stats.todaySales.toFixed(0)}`, 
                  label: 'Sales', 
                  path: '/transaction-history', 
                  bgColor: 'bg-amber-50', 
                  borderColor: 'border-amber-200', 
                  iconColor: 'text-amber-600', 
                  iconBg: 'bg-amber-100',
                  accentBg: 'bg-amber-500/10'
                },
                { 
                  icon: Package, 
                  value: stats.totalProducts, 
                  label: 'Items', 
                  path: '/inventory', 
                  bgColor: 'bg-blue-50', 
                  borderColor: 'border-blue-200', 
                  iconColor: 'text-blue-600', 
                  iconBg: 'bg-blue-100',
                  accentBg: 'bg-blue-500/10'
                },
                { 
                  icon: CreditCard, 
                  value: getFilteredCreditors().length, 
                  label: 'Credits', 
                  path: '/ledger', 
                  bgColor: 'bg-purple-50', 
                  borderColor: 'border-purple-200', 
                  iconColor: 'text-purple-600', 
                  iconBg: 'bg-purple-100',
                  accentBg: 'bg-purple-500/10'
                },
                { 
                  icon: Receipt, 
                  value: `₱${totalExpenses.toFixed(0)}`, 
                  label: 'Costs', 
                  path: '/expenses', 
                  bgColor: 'bg-red-50', 
                  borderColor: 'border-red-200', 
                  iconColor: 'text-red-600', 
                  iconBg: 'bg-red-100',
                  accentBg: 'bg-red-500/10'
                }
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 * i }}
                  className={`relative group overflow-hidden ${stat.bgColor} ${stat.borderColor} shadow-sm p-4 rounded-2xl transition-all duration-300 hover:shadow-md hover:scale-[1.02] cursor-pointer`}
                  onClick={() => setLocation(stat.path)}
                >
                  <div className={`absolute top-0 right-0 w-16 h-16 ${stat.accentBg} rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-150 duration-500`}></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-1.5 rounded-lg ${stat.iconBg}`}>
                        <stat.icon className={`w-3.5 h-3.5 ${stat.iconColor}`} />
                      </div>
                      <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{stat.label}</span>
                    </div>
                    <div className="text-xl font-black text-gray-900 tracking-tighter">{stat.value}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Middle Row: Tools & Performance */}
          <div className={cn(
            "grid gap-4",
            (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-12 h-auto lg:h-[350px]" : "grid-cols-1"
          )}>
            {/* Executive Tools - Scrollable internally */}
            <div className={cn(
              "modern-card p-4 flex flex-col",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "lg:col-span-4" : ""
            )}>
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-900 mb-3">{t('executiveTools')}</h2>
              <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-1 flex-1">
                {[
                  { title: t('inventory'), icon: Package, path: '/inventory', color: 'pink' },
                  { title: t('financials'), icon: CreditCard, path: '/ledger', color: 'indigo' },
                  { title: t('expenses'), icon: DollarSign, path: '/expenses', color: 'emerald' },
                  { title: t('bookkeeping'), icon: Receipt, path: '/bookkeeping', color: 'blue' },
                  { title: t('history'), icon: History, path: '/transaction-history', color: 'purple' },
                  { title: t('analytics'), icon: BarChart3, path: '/admin/reports', color: 'amber' },
                ].map((tool) => (
                  <Button
                    key={tool.title}
                    variant="outline"
                    className={cn(
                      "h-auto py-3.5 flex flex-col items-center gap-2 border border-slate-200/90 shadow-xs hover:border-[#BF953F]/40 hover:bg-[#BF953F]/5 hover:shadow-sm transition-all group rounded-xl",
                      `bg-${tool.color}-50/60`
                    )}
                    onClick={() => setLocation(tool.path)}
                  >
                    <tool.icon className={cn("w-5 h-5", `text-${tool.color}-500 group-hover:scale-110 transition-transform`)} />
                    <span className="text-xs font-bold text-gray-800">{tool.title}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Performance Matrix */}
            <div className={cn(
              "modern-card p-4 flex flex-col",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "lg:col-span-8" : ""
            )}>
              <div className="flex items-center justify-between mb-4 flex-none">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-900">7-Day Trajectory</h2>
                <div className="flex gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#BF953F]"></div>
                    <span className="text-[8px] font-black uppercase text-gray-400">{t('income')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-200"></div>
                    <span className="text-[8px] font-black uppercase text-gray-400">{t('costs')}</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#BF953F" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#BF953F" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="expensesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#CBD5E1" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#CBD5E1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#F8FAFC" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 8, fontWeight: 700 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 8, fontWeight: 700 }} tickFormatter={(v) => `₱${v}`} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', padding: '8px', fontSize: '10px' }} />
                    <Area type="monotone" dataKey="income" stroke="#BF953F" strokeWidth={2} fillOpacity={1} fill="url(#incomeGradient)" />
                    <Area type="monotone" dataKey="expenses" stroke="#CBD5E1" strokeWidth={2} fillOpacity={1} fill="url(#expensesGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Bottom Row: Top Products & Recent Transactions */}
          <div className={cn(
            "grid gap-4",
            (deviceMode === 'pc' || deviceMode === 'tablet') ? "grid-cols-12 h-auto lg:h-[300px]" : "grid-cols-1"
          )}>
            {/* Top Products */}
            <div className={cn(
              "modern-card p-4 flex flex-col",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "lg:col-span-5" : ""
            )}>
              <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-900 mb-3">{t('topSellers')}</h2>
              <div className="space-y-3 overflow-y-auto pr-1 flex-1">
                {topProducts.map((product, i) => (
                  <div key={product.name} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-gray-800">{product.name}</span>
                      <span className="text-[10px] font-black text-[#BF953F]">{product.sales} sold</span>
                    </div>
                    <div className="w-full h-1 bg-gray-50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (product.sales / (topProducts[0]?.sales || 1)) * 100)}%` }}
                        transition={{ delay: 0.1 * i, duration: 1 }}
                        className="h-full bg-[#BF953F] rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className={cn(
              "modern-card p-4 flex flex-col",
              (deviceMode === 'pc' || deviceMode === 'tablet') ? "lg:col-span-7" : ""
            )}>
              <div className="flex items-center justify-between mb-3 flex-none">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-gray-900">{t('recentActivity')}</h2>
                <Button variant="ghost" className="h-6 text-[8px] font-black uppercase tracking-widest text-[#BF953F]" onClick={() => setLocation('/transaction-history')}>{t('viewAll')}</Button>
              </div>
              <div className="overflow-x-auto flex-1 overflow-y-auto pr-1">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-50">
                      <th className="pb-2 text-[9px] font-black uppercase tracking-widest text-gray-400">{t('order')}</th>
                      <th className="pb-2 text-[9px] font-black uppercase tracking-widest text-gray-400">{t('staff')}</th>
                      <th className="pb-2 text-[9px] font-black uppercase tracking-widest text-gray-400 text-right">{t('total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recentTransactions.map((tx) => (
                      <tr key={tx.id} className="group hover:bg-gray-50/50">
                        <td className="py-2 text-[10px] font-bold text-gray-900">#{String(tx.id).substring(0, 6)}</td>
                        <td className="py-2">
                          <span className="text-[10px] font-bold text-gray-700">{tx.staffName}</span>
                        </td>
                        <td className="py-2 text-right text-[10px] font-black text-gray-900">₱{tx.total.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <FloatingActionButton onTutorialClick={handleTutorialClick} />

        {/* Dialogs - Fixed position */}
        <Dialog open={isAddExpenseOpen} onOpenChange={setIsAddExpenseOpen}>
          <DialogContent className="max-w-md rounded-2xl z-[70]">
            <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
            <Form {...expenseForm}>
              <form onSubmit={expenseForm.handleSubmit(handleAddExpense)} className="space-y-4">
                <FormField control={expenseForm.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">Description</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter description" className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm placeholder:text-gray-300 focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F]" {...field} />
                    </FormControl>
                    <FormMessage className="text-[10px] font-bold text-red-500" />
                  </FormItem>
                )} />
                <FormField control={expenseForm.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">Amount (₱)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} placeholder="0.00" className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm placeholder:text-gray-300 focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F]" />
                    </FormControl>
                    <FormMessage className="text-[10px] font-bold text-red-500" />
                  </FormItem>
                )} />
                <FormField control={expenseForm.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">Category</FormLabel>
                    <FormControl>
                      <select {...field} className="w-full h-12 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm px-4 focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F] appearance-none">
                        <option value="">Select category</option>
                        <option value="Rent">Rent</option>
                        <option value="Utilities">Utilities</option>
                        <option value="Supplies">Supplies</option>
                        <option value="Other">Other</option>
                      </select>
                    </FormControl>
                    <FormMessage className="text-[10px] font-bold text-red-500" />
                  </FormItem>
                )} />
                <FormField control={expenseForm.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 ml-1">Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} className="h-12 bg-gray-50 border-gray-100 rounded-2xl font-bold text-sm focus:ring-2 focus:ring-[#BF953F]/20 focus:border-[#BF953F]" />
                    </FormControl>
                    <FormMessage className="text-[10px] font-bold text-red-500" />
                  </FormItem>
                )} />
                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsAddExpenseOpen(false)} className="flex-1">Cancel</Button>
                  <Button type="submit" className="flex-1 bg-[#FF8882]">Add</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Notifications Dialog */}
        <Dialog open={showNotifications} onOpenChange={(open) => {
          setShowNotifications(open);
          if (!open) {
            setIsSelectMode(false);
            setSelectedNotificationIds([]);
          }
        }}>
          <DialogContent className="max-w-md h-[70vh] flex flex-col p-0 overflow-hidden outline-none rounded-3xl z-[70]">
            <DialogHeader className="p-4 border-b bg-white flex-none">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-black tracking-tighter gold-gradient-text uppercase">Notifications</DialogTitle>
                {activeTab === 'updates' && (
                  <div className="flex items-center gap-2">
                    {!isSelectMode ? (
                      <>
                        <Button variant="ghost" size="icon" onClick={handleMarkAllAsRead} className="h-8 w-8">
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setIsSelectMode(true)} className="h-8 w-8">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => { setIsSelectMode(false); setSelectedNotificationIds([]); }} className="h-8 w-8">
                          <X className="h-4 w-4" />
                        </Button>
                        {selectedNotificationIds.length > 0 && (
                          <Button variant="destructive" size="icon" onClick={handleDeleteSelected} className="h-8 w-8">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {/* Tabs */}
              <div className="flex gap-2 mt-4">
                <Button 
                  variant={activeTab === 'updates' ? 'default' : 'ghost'}
                  onClick={() => { setActiveTab('updates'); setIsSelectMode(false); setSelectedNotificationIds([]); }}
                  className={cn(
                    "flex-1 text-xs font-black uppercase tracking-widest rounded-xl",
                    activeTab === 'updates' ? "bg-[#BF953F] text-white" : "text-gray-500 hover:bg-gray-100"
                  )}
                >
                  Updates
                </Button>
                <Button 
                  variant={activeTab === 'remittance' ? 'default' : 'ghost'}
                  onClick={() => { setActiveTab('remittance'); setIsSelectMode(false); setSelectedNotificationIds([]); }}
                  className={cn(
                    "flex-1 text-xs font-black uppercase tracking-widest rounded-xl",
                    activeTab === 'remittance' ? "bg-[#BF953F] text-white" : "text-gray-500 hover:bg-gray-100"
                  )}
                >
                  Remittance
                </Button>
                <Button 
                  variant={activeTab === 'completed' ? 'default' : 'ghost'}
                  onClick={() => { setActiveTab('completed'); setIsSelectMode(false); setSelectedNotificationIds([]); }}
                  className={cn(
                    "flex-1 text-xs font-black uppercase tracking-widest rounded-xl",
                    activeTab === 'completed' ? "bg-[#BF953F] text-white" : "text-gray-500 hover:bg-gray-100"
                  )}
                >
                  Completed
                </Button>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
              {activeTab === 'updates' && (
                notifications.length === 0 ? (
                  <div className="py-8 text-center text-xs text-gray-400">
                    No notifications yet
                  </div>
                ) : (
                  notifications.map((n) => {
                    const isInventoryAlert = n.type === 'inventory_alert';
                    let inventoryAlertData: any = null;
                    if (isInventoryAlert) {
                      try {
                        inventoryAlertData = typeof n.data === 'string' ? JSON.parse(n.data) : n.data;
                      } catch {}
                    }
                    return (
                      <div 
                        key={n.id} 
                        className={cn(
                          "p-3.5 rounded-xl border bg-white transition-all flex items-start gap-3", 
                          !n.isRead && (isInventoryAlert ? "border-amber-300 bg-amber-50/20 shadow-sm" : "border-[#BF953F]/20 shadow-sm")
                        )}
                      >
                        {isSelectMode && (
                          <input 
                            type="checkbox" 
                            checked={selectedNotificationIds.includes(n.id)}
                            onChange={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); handleToggleSelect(n.id); }}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-[#BF953F] focus:ring-[#BF953F]"
                          />
                        )}
                        <div 
                          className="flex-1 cursor-pointer"
                          onClick={() => !isSelectMode && handleNotificationClick(n)}
                        >
                          {isInventoryAlert && (
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider">
                                Low Stock
                              </span>
                            </div>
                          )}
                          {isInventoryAlert && inventoryAlertData?.type === 'low_stock' ? (
                            <div className="text-xs leading-relaxed">
                              <p className={cn(!n.isRead ? "font-bold text-gray-900" : "text-gray-600")}>
                                {inventoryAlertData.productName || n.message}
                              </p>
                              <p className="mt-1 text-[11px] text-gray-500">
                                Current quantity: <strong className="text-gray-700">{inventoryAlertData.quantity}</strong> pieces
                              </p>
                            </div>
                          ) : (
                            <p className={cn("text-xs leading-relaxed", !n.isRead ? "font-bold text-gray-900" : "text-gray-600")}>{n.message}</p>
                          )}
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[9px] text-gray-400 block">{new Date(n.createdAt as any).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {isInventoryAlert && (
                              <span className="text-[9px] font-semibold text-[#FF8882] hover:underline flex items-center gap-0.5">
                                View Product →
                              </span>
                            )}
                          </div>
                        </div>
                        {!isSelectMode && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-gray-400 hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); handleDeleteNotification(n.id); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })
                )
              )}
              {activeTab === 'remittance' && (
                pendingRemittances.map((r) => (
                  <div key={r.id} className="p-4 rounded-xl border bg-white shadow-sm flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{r.staffName}</p>
                        <p className="text-xs text-gray-500">₱{r.amount.toLocaleString()}</p>
                        <p className="text-[8px] text-gray-400">{r.transactionCount} transactions</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => setSelectedRemittance(r)}
                        className="flex-1 h-10 rounded-xl bg-[#BF953F] text-white text-xs font-black uppercase tracking-widest"
                      >
                        Confirm
                      </Button>
                      <Button 
                        onClick={() => handleCancelRemittance(r)}
                        className="flex-1 h-10 rounded-xl border border-gray-200 text-gray-600 text-xs font-black uppercase tracking-widest"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ))
              )}
              {activeTab === 'completed' && (
                confirmedRemittances.map((r) => (
                  <div key={r.id} className="p-4 rounded-xl border bg-white shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{r.staffName}</p>
                        <p className="text-xs text-gray-500">₱{r.amount.toLocaleString()}</p>
                        <p className="text-[8px] text-gray-400">{r.transactionCount} transactions</p>
                      </div>
                      <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                        Confirmed
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Remittance Dialog */}
        <Dialog open={!!selectedRemittance} onOpenChange={(open) => !open && setSelectedRemittance(null)}>
          <DialogContent className="max-w-md rounded-3xl p-6 z-[80]">
            <DialogHeader className="text-center">
              <DialogTitle className="text-2xl font-black">Confirm Remittance</DialogTitle>
              <DialogDescription>From {selectedRemittance?.staffName}</DialogDescription>
            </DialogHeader>

            <div className="my-4 p-4 bg-gray-50 rounded-2xl border space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Amount</span>
                <span className="text-xl font-black text-[#BF953F]">₱{(selectedRemittance?.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Orders</span>
                <span className="text-sm font-bold text-gray-800">{selectedRemittance?.transactionCount}</span>
              </div>
            </div>

            {/* Transaction History Breakdown */}
            <div className="mb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-2">Transaction History</span>
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                {remittanceSalesBreakdown.length > 0 ? (
                  remittanceSalesBreakdown.map((s, idx) => (
                    <div key={s.id || idx} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-xl text-xs">
                      <div>
                        <span className="font-bold text-gray-900 block">
                          {s.createdAt ? new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                        </span>
                        <span className="text-[9px] font-bold text-gray-400 uppercase">{s.paymentType || 'cash'}</span>
                      </div>
                      <span className="font-black text-gray-900">₱{(s.total || 0).toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-3 bg-gray-50 rounded-xl">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">No recent local transaction details found</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setSelectedRemittance(null)} className="flex-1">Cancel</Button>
              <Button onClick={handleConfirmRemittance} disabled={isConfirmingRemit} className="flex-1 bg-[#BF953F]">{isConfirmingRemit ? "..." : "Confirm"}</Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showAdminOfflinePrompt} onOpenChange={setShowAdminOfflinePrompt}>
          <AlertDialogContent className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl p-6 max-w-md z-[100]">
            <AlertDialogHeader className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <AlertDialogTitle className="text-xl font-bold text-white">
                Offline Mode Warning
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300 text-xs leading-relaxed">
                You are running in offline mode without internet connection. Real-time staff tracking, cross-device remittances, and cloud synchronization are temporarily unavailable. Local changes will be saved to your device until internet is restored.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-6">
              <AlertDialogAction
                onClick={() => setShowAdminOfflinePrompt(false)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold py-2.5 shadow-lg shadow-blue-600/30"
              >
                Proceed to Admin Dashboard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </motion.div>
    </Layout>
  );
};

export default AdminMain;
