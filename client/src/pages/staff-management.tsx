import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  Search,
  Filter,
  RefreshCw,
  Eye,
  EyeOff,
  Edit,
  Lock,
  Key,
  Activity,
  Clock,
  Plus,
  X,
  Check,
  ChevronRight,
  Shield,
  Calendar,
  Phone,
  Mail,
  MapPin,
  User,
  Briefcase,
  Building,
  Download,
  FileSpreadsheet
} from 'lucide-react';
import { useLocation } from 'wouter';
import Layout from '@/components/Layout';
import { LocalizedContent } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthService, StaffService, SalesService, db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Staff } from '@shared/schema';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import io from 'socket.io-client';
import api from '@/lib/api';

const staffSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  middleName: z.string().optional(),
  lastName: z.string().min(1, 'Last name is required'),
  staffId: z.string().min(1, 'Staff ID is required'),
  passkey: z.string().min(4, 'Passkey must be at least 4 characters'),
  role: z.enum(['cashier', 'manager', 'admin']),
  branch: z.string().optional(),
  department: z.string().optional(),
  employmentStatus: z.enum(['active', 'inactive', 'on_leave']),
  email: z.string().email('Enter a valid email').or(z.literal('')).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  birthdate: z.string().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  dateHired: z.string().optional(),
  assignedShift: z.enum(['morning', 'afternoon', 'evening']).optional(),
  permissions: z.array(z.string()),
});

type StaffFormData = z.infer<typeof staffSchema>;

interface StaffWithStatus {
  [key: string]: any;
  isOnline?: boolean;
  lastActive?: Date;
  todaySales?: number;
}

const getInitials = (name: string) =>
  name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

const getGradient = (name: string) => {
  const colors = [
    'from-blue-500 to-cyan-400',
    'from-purple-500 to-pink-400',
    'from-green-500 to-emerald-400',
    'from-orange-500 to-amber-400',
    'from-rose-500 to-red-400'
  ];
  const index = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  return colors[index];
};

// Types for staff details
interface StaffDetails extends Staff {
  performance?: {
    todaySales: number;
    weeklySales: number;
    monthlySales: number;
    transactionCount: number;
    itemsSold: number;
  };
  attendance?: {
    date: string;
    clockIn: string;
    clockOut: string;
    hoursWorked: number;
    isLate: boolean;
  };
  activity?: any[];
  loginHistory?: any[];
}

const StaffManagement: React.FC = () => {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffWithStatus[]>([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deletingStaff, setDeletingStaff] = useState<StaffWithStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const socketRef = useRef<any>(null);
  const [serverInfoState, setServerInfoState] = useState('unknown');
  const [socketStatus, setSocketStatus] = useState('disconnected');
  const [socketLastError, setSocketLastError] = useState<string | null>(null);

  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffDetails | null>(null);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddPasskey, setShowAddPasskey] = useState(false);

  // Time Stamp / Attendance dialog states
  const [timestampDialogOpen, setTimestampDialogOpen] = useState(false);
  const [selectedTimestampStaff, setSelectedTimestampStaff] = useState<StaffWithStatus | null>(null);
  const [staffTimestamps, setStaffTimestamps] = useState<any[]>([]);
  const [isLoadingTimestamps, setIsLoadingTimestamps] = useState(false);

  const handleOpenTimestamp = async (member: StaffWithStatus) => {
    setSelectedTimestampStaff(member);
    setTimestampDialogOpen(true);
    setIsLoadingTimestamps(true);
    try {
      const data = await StaffService.getStaffTimestamps(member.id);
      setStaffTimestamps(data);
    } catch (e) {
      console.error('Failed to load timestamps:', e);
      toast({ title: 'Failed to load timestamps', variant: 'destructive' });
      setStaffTimestamps([]);
    } finally {
      setIsLoadingTimestamps(false);
    }
  };

  const handleExportTimestampsToExcel = () => {
    if (!selectedTimestampStaff) return;
    try {
      const nowStr = new Date().toLocaleString();
      const exportDate = new Date().toISOString().split('T')[0];
      const rows: string[][] = [
        ['SmartPOS+ Staff Attendance Record'],
        ['Staff Name', selectedTimestampStaff.name || ''],
        ['Staff ID', selectedTimestampStaff.staffId || ''],
        ['Role', selectedTimestampStaff.role || 'Cashier'],
        ['Report Generated', nowStr],
        [''],
        ['Date', 'Time In', 'Time Out', 'Hours Worked', 'Status', 'Device Info', 'IP Address']
      ];

      staffTimestamps.forEach((row) => {
        const timeInFormatted = row.timeIn ? new Date(row.timeIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
        const timeOutFormatted = row.timeOut ? new Date(row.timeOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Active / On Duty';
        const hoursStr = row.hoursWorked != null ? `${row.hoursWorked} hrs` : (row.status === 'Active' ? 'In Progress' : '-');
        rows.push([
          row.date || '',
          timeInFormatted,
          timeOutFormatted,
          hoursStr,
          row.status || 'Completed',
          row.deviceInfo || '',
          row.ipAddress || ''
        ]);
      });

      const totalHours = staffTimestamps.reduce((acc, curr) => acc + (Number(curr.hoursWorked) || 0), 0);
      rows.push(['']);
      rows.push(['Total Records', String(staffTimestamps.length)]);
      rows.push(['Total Hours Worked', `${totalHours.toFixed(2)} hrs`]);

      const csvContent = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const safeName = (selectedTimestampStaff.name || 'Staff').replace(/[^a-zA-Z0-9_-]/g, '_');
      link.setAttribute('download', `Attendance_${safeName}_${exportDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast({ title: 'Attendance exported successfully' });
    } catch (e) {
      console.error('Export error:', e);
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  };

  // Permission options
  const permissionOptions = [
    { id: 'sales.create', label: 'Create Sales' },
    { id: 'sales.view', label: 'View Sales' },
    { id: 'products.manage', label: 'Manage Products' },
    { id: 'customers.manage', label: 'Manage Customers' },
    { id: 'staff.view', label: 'View Staff' },
    { id: 'reports.view', label: 'View Reports' },
  ];

  const form = useForm<StaffFormData>({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      firstName: '',
      middleName: '',
      lastName: '',
      staffId: '',
      passkey: '',
      role: 'cashier',
      branch: '',
      department: '',
      employmentStatus: 'active',
      email: '',
      phone: '',
      address: '',
      birthdate: '',
      gender: undefined,
      dateHired: '',
      assignedShift: undefined,
      permissions: [],
    },
  });

  // Load staff by ID for view/edit
  const loadStaffDetails = async (staffId: string) => {
    setIsLoadingStaff(true);
    try {
      let response: any = null;
      try {
        response = await api.get(`/api/staff/${staffId}`);
      } catch (serverErr) {
        console.warn('[Staff Details] Server fetch failed, attempting local Dexie lookup:', serverErr);
        const local = await db.staff.get(staffId);
        if (local) {
          response = {
            ...local,
            performance: { todaySales: 0, weeklySales: 0, monthlySales: 0, transactionCount: 0, itemsSold: 0 },
            attendance: null,
            activity: [],
            loginHistory: []
          };
        }
      }
      if (response) {
        setSelectedStaff(response);
        return response;
      } else {
        toast({
          title: 'Error',
          description: 'Failed to load staff details',
          variant: 'destructive',
        });
        return null;
      }
    } catch (error) {
      console.error('Error loading staff details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load staff details',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoadingStaff(false);
    }
  };

  // Handle view staff
  const handleViewStaff = async (id: string) => {
    setIsLoadingStaff(true);
    setViewDialogOpen(true);
    await loadStaffDetails(id);
  };

  // Handle edit staff
  const handleEditStaff = async (id: string) => {
    setIsLoadingStaff(true);
    await loadStaffDetails(id);
    setEditDialogOpen(true);
  };

  // Handle save staff
  const handleSaveStaff = async (data: any) => {
    if (!selectedStaff) return;
    setIsSaving(true);
    try {
      let response;
      try {
        response = await api.put(`/api/staff/${selectedStaff.id}`, data);
      } catch (serverErr: any) {
        console.warn('[Staff Edit] Server update failed, falling back to local IndexedDB:', serverErr?.message || serverErr);
        if (typeof StaffService.updateStaff === 'function') {
          await StaffService.updateStaff(selectedStaff.id, data);
          const local = await db.staff.get(selectedStaff.id);
          if (local) response = local;
        }
        if (!response) throw serverErr;
      }
      setSelectedStaff(response);
      toast({ title: 'Success', description: 'Staff updated successfully' });
      setEditDialogOpen(false);
      await loadStaff();
    } catch (error: any) {
      console.error('Error saving staff:', error);
      const msg = error?.details
        ? typeof error.details === 'object'
          ? Object.entries(error.details).flatMap(([k, v]) => Array.isArray(v) ? v.map(item => `${k}: ${item}`) : [`${k}: ${v}`]).join('; ')
          : String(error.details)
        : error?.error || error?.message || 'Failed to save staff';
      toast({
        title: 'Error Saving Staff',
        description: String(msg).slice(0, 160),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const loadStaff = async () => {
    setIsLoading(true);
    try {
      let staffData: any[] = [];
      try {
        staffData = await api.get('/api/staff');
      } catch (err) {
        console.warn('Server fetch /api/staff failed, checking local Dexie:', err);
        staffData = [];
      }

      if (!Array.isArray(staffData) || staffData.length === 0) {
        staffData = await StaffService.getAllStaff();
      }

      const staffWithStatus: StaffWithStatus[] = await Promise.all((staffData || []).map(async member => {
        let todaySales = 0;
        try {
          const performance = await api.get(`/api/staff/${member.id}/performance`);
          todaySales = Number(performance.todaySales) || 0;
        } catch {
          todaySales = 0;
        }
        const name = member.name || [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ');
        return {
        ...member,
        name,
        isOnline: false,
        lastActive: member.createdAt || new Date(),
        role: (member as any).role || 'Cashier',
        todaySales,
        };
      }));

      setStaff(staffWithStatus);

      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('getStaffStatus', staffWithStatus.map(s => s.id));
      }

      return staffWithStatus;
    } catch (error) {
      console.error('Error loading staff:', error);
      toast({
        title: 'Error',
        description: 'Failed to load staff list',
        variant: 'destructive',
      });
      setStaff([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let heartbeatInterval: any;
    let socketInstance: any = null;
    let cancelled = false;

    const init = async () => {
      try {
        let socketUrl = window.location.origin;
        try {
          const data = await api.get('/api/server-info');
          socketUrl = data.origin;
        } catch (e) {
          console.warn('Failed to fetch server info');
        }

        if (window.location.hostname.includes('netlify.app')) {
          socketUrl = 'https://smartposv4.onrender.com';
        }

        socketInstance = io(socketUrl, {
          auth: {
            token: localStorage.getItem('userToken') || '',
            businessId: user?.id || ''
          },
          transports: ['polling', 'websocket'],
          reconnection: true,
          reconnectionAttempts: 20,
          reconnectionDelay: 1000,
          timeout: 45000,
          autoConnect: true
        });

        setServerInfoState(socketUrl);
      } catch (error) {
        console.error('Socket init failed:', error);
        socketInstance = null;
      }

      if (cancelled) return;
      if (!socketInstance) {
        loadStaff();
        return;
      }

      socketRef.current = socketInstance;

      socketInstance.on('connect', () => {
        setSocketStatus('connected');
        setSocketLastError(null);
        loadStaff();
        if (user?.id) socketInstance.emit('adminOnline', { adminId: user.id });
      });

      socketInstance.on('connect_error', (error: any) => {
        setSocketStatus('error');
        setSocketLastError(error?.message || 'Unknown error');
      });

      socketInstance.on('staffStatusUpdate', (data: { staffId: string, isOnline: boolean, lastActive?: Date }) => {
        setStaff(prevStaff =>
          prevStaff.map(member =>
            member.id === data.staffId
              ? { ...member, isOnline: data.isOnline, lastActive: data.lastActive || member.lastActive }
              : member
          )
        );
      });

      socketInstance.on('staffStatusBulk', (statusUpdates: Array<{ staffId: string, isOnline: boolean, lastActive?: Date }>) => {
        setStaff(prevStaff => {
          const staffMap = new Map(prevStaff.map(s => [s.id, s]));
          statusUpdates.forEach(update => {
            const st = staffMap.get(update.staffId);
            if (st) {
              st.isOnline = update.isOnline;
              st.lastActive = update.lastActive || st.lastActive;
            }
          });
          return Array.from(staffMap.values());
        });
      });

      heartbeatInterval = setInterval(() => {
        if (socketRef.current && socketRef.current.connected && user?.id) {
          socketRef.current.emit('heartbeat', { adminId: user.id });
        }
      }, 30000);
    };

    init();

    const handleTenantSync = () => {
      loadStaff();
    };
    window.addEventListener('tenant-data-synced', handleTenantSync);

    return () => {
      cancelled = true;
      clearInterval(heartbeatInterval);
      window.removeEventListener('tenant-data-synced', handleTenantSync);
      if (socketRef.current) {
        if (user?.id) {
          try { socketRef.current.emit('adminOffline', { adminId: user.id }); } catch (_) {}
        }
        try { socketRef.current.disconnect(); } catch (_) {}
      }
    };
  }, [user?.id, toast]);

  const onSubmit = async (data: StaffFormData) => {
    setIsLoading(true);
    try {
      const newStaff = await AuthService.createStaff({
        ...data,
        name: [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' '),
        createdBy: user?.id || '',
        tenantId: user?.tenantId || '',
      });

      if (newStaff) {
        // Sync to server SQLite and Supabase Cloud immediately
        try {
          await api.post('/api/staff', [newStaff]);
          console.log('[STAFF CREATE] Successfully synced staff to server and Supabase Cloud');
        } catch (e) {
          console.warn('[STAFF CREATE WARN] Server sync pending (will sync when online):', e);
        }

        toast({ title: 'Staff Account Created', description: `${[data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')} saved to local DB and Supabase Cloud` });
        setIsAddDialogOpen(false);
        form.reset();
        await loadStaff();
      }
    } catch (error: any) {
      console.error('Error adding staff:', error);
      toast({ title: 'Error Creating Staff', description: error?.message || 'Failed to add staff account', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingStaff) return;
    const staffIdToDelete = deletingStaff.id;
    const staffNameToDelete = deletingStaff.name;

    try {
      // 1. Delete from Server SQLite & Supabase Cloud
      try {
        await api.delete(`/api/staff/${staffIdToDelete}`);
      } catch (err) {
        console.warn('Server delete /api/staff failed, proceeding with local delete:', err);
      }

      // 2. Delete from Local Dexie IndexedDB
      await StaffService.deleteStaff(staffIdToDelete);
      if ((deletingStaff as any).staffId) {
        await StaffService.deleteStaff((deletingStaff as any).staffId);
      }

      // 3. Update local React state UI immediately
      setStaff(prev => prev.filter(s => s.id !== staffIdToDelete && (s as any).staffId !== staffIdToDelete));

      toast({ title: 'Staff Deleted', description: `${staffNameToDelete} deleted from local database and Supabase cloud` });
      setDeletingStaff(null);
      await loadStaff();
    } catch (error) {
      console.error('Error deleting staff:', error);
      toast({ title: 'Error', description: 'Failed to delete staff account', variant: 'destructive' });
    }
  };

  const formatLastActive = (date?: Date) => {
    if (!date) return 'Never';
    try {
      const diff = new Date().getTime() - new Date(date).getTime();
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
      }
      if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
      }
      return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return 'Unknown';
    }
  };

  const filteredStaff = staff.filter(member => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.staffId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'all' ||
      (activeFilter === 'online' && member.isOnline) ||
      (activeFilter === 'offline' && !member.isOnline) ||
      (activeFilter.toLowerCase() === (member.role || 'cashier').toLowerCase());
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: staff.length,
    online: staff.filter(s => s.isOnline).length,
    active: staff.filter(s => s.isOnline).length,
    inactive: staff.filter(s => !s.isOnline).length,
  };

  const filterOptions = ['All', 'Online', 'Offline', 'Cashier', 'Manager', 'Admin'];

  return (
    <Layout>
      <div className="min-h-screen bg-[#F8FAFC]">
        {/* Header */}
        <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100">
                <Users className="w-6 h-6 text-[#2563EB]" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                  Staff Management
                </h1>
                <p className="text-gray-600 mt-1">
                  Manage employees, monitor activity, and assign roles
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 sm:px-6 max-w-7xl mx-auto pb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Users className="w-5 h-5 text-[#2563EB]" />}
              value={stats.total}
              label="Total Staff"
              color="border-blue-100"
            />
            <StatCard
              icon={<Wifi className="w-5 h-5 text-[#10B981]" />}
              value={stats.online}
              label="Online Now"
              color="border-green-100"
            />
            <StatCard
              icon={<Activity className="w-5 h-5 text-[#F59E0B]" />}
              value={stats.active}
              label="Active"
              color="border-orange-100"
            />
            <StatCard
              icon={<WifiOff className="w-5 h-5 text-gray-500" />}
              value={stats.inactive}
              label="Inactive"
              color="border-gray-100"
            />
          </div>
        </div>

        {/* Connection Status */}
        <div className="px-4 sm:px-6 max-w-7xl mx-auto pb-6">
          <Card className="border-gray-100 shadow-sm bg-white">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    socketStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                  }`} />
                  <div>
                    <p className="font-medium text-gray-900">
                      {socketStatus === 'connected' ? 'Live Monitoring' : 'Disconnected'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {socketStatus === 'connected' ? 'Real-time updates active' : 'Trying to reconnect'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-auto">
                  <div className="text-xs text-gray-500">
                    <div className="text-gray-400 mb-1">Server Address</div>
                    <div className="text-gray-600 break-all font-mono">{serverInfoState}</div>
                  </div>
                  <div className="text-xs text-gray-500">
                    <div className="text-gray-400 mb-1">Last Sync</div>
                    <div className="text-gray-600 font-mono">Just now</div>
                  </div>
                </div>
              </div>
              {socketLastError && (
                <div className="mt-3 text-xs text-red-500">{socketLastError}</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Search & Filters */}
        <div className="px-4 sm:px-6 max-w-7xl mx-auto pb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="w-full sm:max-w-md relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by name, role, or staff ID"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white border-gray-200 focus:border-[#2563EB]"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full no-scrollbar flex-nowrap sm:flex-wrap">
              {filterOptions.map(filter => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter.toLowerCase())}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border flex-shrink-0 ${
                    activeFilter === filter.toLowerCase()
                      ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Staff List */}
        <div className="px-4 sm:px-6 max-w-7xl mx-auto pb-24">
          <AnimatePresence mode="popLayout">
            {filteredStaff.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-16"
              >
                <div className="w-24 h-24 bg-gray-100 rounded-full mx-auto mb-6 flex items-center justify-center">
                  <Users className="w-12 h-12 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Staff Found</h3>
                <p className="text-gray-600 mb-8 max-w-md mx-auto">
                  {searchQuery ? 'Try adjusting your search' : 'Start by inviting your first employee'}
                </p>
                {!searchQuery && staff.length === 0 && (
                  <Button
                    onClick={() => setIsAddDialogOpen(true)}
                    className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Add Staff
                  </Button>
                )}
              </motion.div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStaff.map((member, index) => (
                  <StaffCard
                    key={member.id}
                    member={member}
                    index={index}
                    onDelete={() => setDeletingStaff(member)}
                    onView={() => handleViewStaff(member.id)}
                    onEdit={() => handleEditStaff(member.id)}
                    onTimestamp={() => handleOpenTimestamp(member)}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* View Staff Dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Staff Details</DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-full pr-4">
              {isLoadingStaff ? (
                <div className="py-8 text-center">Loading...</div>
              ) : selectedStaff ? (
                <div className="space-y-6 py-4">
                  {/* Profile Section */}
                  <div className="flex items-center gap-4">
                    <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${getGradient(selectedStaff.name)} flex items-center justify-center text-white font-bold text-2xl shadow-md`}>
                      {getInitials(selectedStaff.name)}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">{selectedStaff.name}</h2>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Badge className="bg-blue-100 text-blue-700">{selectedStaff.role}</Badge>
                        <Badge className={`${selectedStaff.employmentStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {selectedStaff.employmentStatus}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Staff ID</p>
                      <p className="font-medium">{selectedStaff.staffId}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        {selectedStaff.email || '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Phone</p>
                      <p className="font-medium flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        {selectedStaff.phone || '-'}
                      </p>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <p className="text-sm text-gray-500">Address</p>
                      <p className="font-medium flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        {selectedStaff.address || '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Branch</p>
                      <p className="font-medium">{selectedStaff.branch || '-'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Department</p>
                      <p className="font-medium">{selectedStaff.department || '-'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Date Hired</p>
                      <p className="font-medium flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        {selectedStaff.dateHired ? new Date(selectedStaff.dateHired).toLocaleDateString() : '-'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">Assigned Shift</p>
                      <p className="font-medium">{selectedStaff.assignedShift || '-'}</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Attendance */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Clock className="w-5 h-5" />
                      Today's Attendance
                    </h3>
                    {selectedStaff.attendance && (
                      <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                        <div>
                          <p className="text-sm text-gray-500">Clock In</p>
                          <p className="font-medium">{selectedStaff.attendance.clockIn}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Clock Out</p>
                          <p className="font-medium">{selectedStaff.attendance.clockOut}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Hours Worked</p>
                          <p className="font-medium">{selectedStaff.attendance.hoursWorked}h</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Late</p>
                          <p className="font-medium">{selectedStaff.attendance.isLate ? 'Yes' : 'No'}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Performance */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Activity className="w-5 h-5" />
                      Performance
                    </h3>
                    {selectedStaff.performance && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-blue-50 rounded-xl">
                          <p className="text-sm text-blue-700">Today's Sales</p>
                          <p className="text-2xl font-bold text-blue-900">₱{selectedStaff.performance.todaySales.toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-green-50 rounded-xl">
                          <p className="text-sm text-green-700">Weekly Sales</p>
                          <p className="text-2xl font-bold text-green-900">₱{selectedStaff.performance.weeklySales.toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-purple-50 rounded-xl">
                          <p className="text-sm text-purple-700">Monthly Sales</p>
                          <p className="text-2xl font-bold text-purple-900">₱{selectedStaff.performance.monthlySales.toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-orange-50 rounded-xl">
                          <p className="text-sm text-orange-700">Transactions</p>
                          <p className="text-2xl font-bold text-orange-900">{selectedStaff.performance.transactionCount}</p>
                        </div>
                        <div className="p-4 bg-pink-50 rounded-xl col-span-2">
                          <p className="text-sm text-pink-700">Items Sold (Today)</p>
                          <p className="text-2xl font-bold text-pink-900">{selectedStaff.performance.itemsSold}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Login History */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Recent Login History</h3>
                    {selectedStaff.loginHistory?.length ? (
                      <div className="space-y-2">
                        {selectedStaff.loginHistory.slice(0, 5).map((login, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <p className="text-sm font-medium">{login.device_info}</p>
                              <p className="text-xs text-gray-500">{login.ip_address}</p>
                            </div>
                            <p className="text-xs text-gray-500">{new Date(login.created_at).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500">No login history</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center">Staff not found</div>
              )}
            </ScrollArea>
            <div className="flex gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  if (selectedStaff) {
                    setViewDialogOpen(false);
                    handleEditStaff(selectedStaff.id);
                  }
                }}
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Employee
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Staff Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Edit Staff</DialogTitle>
            </DialogHeader>
            {isLoadingStaff ? (
              <div className="py-8 text-center">Loading...</div>
            ) : selectedStaff ? (
              <EditStaffForm
                staff={selectedStaff}
                onSave={handleSaveStaff}
                onCancel={() => setEditDialogOpen(false)}
                isSaving={isSaving}
              />
            ) : null}
          </DialogContent>
        </Dialog>

        {/* Staff Timestamp & Attendance Dialog */}
        <StaffTimestampDialog
          open={timestampDialogOpen}
          onOpenChange={setTimestampDialogOpen}
          staff={selectedTimestampStaff}
          timestamps={staffTimestamps}
          isLoading={isLoadingTimestamps}
          onExport={handleExportTimestampsToExcel}
        />

        {/* Floating Action Button - Add Staff (Aligned with Bottom Navigation & Inventory FAB) */}
        <div className="fixed bottom-28 right-6 z-50 flex flex-col items-end space-y-3">
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsAddDialogOpen(true)}
            className="w-14 h-14 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-full shadow-lg transition-colors flex items-center justify-center cursor-pointer"
            style={{
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
            }}
            title="Add Staff"
          >
            <UserPlus className="w-6 h-6" />
          </motion.button>
        </div>

        {/* Add Staff Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Add Staff Member</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl><Input placeholder="First name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="middleName" render={({ field }) => (
                  <FormItem><FormLabel>Middle Name</FormLabel><FormControl><Input placeholder="Middle name" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input placeholder="Last name" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="staffId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Staff ID</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., STAFF001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="passkey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passkey</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input type={showAddPasskey ? "text" : "password"} placeholder="Create a secure passkey" className="pr-10" {...field} />
                          <button
                            type="button"
                            onClick={() => setShowAddPasskey(!showAddPasskey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                            title={showAddPasskey ? "Hide passkey" : "Show passkey"}
                          >
                            {showAddPasskey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="staff@example.com" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="Phone number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="branch" render={({ field }) => (
                  <FormItem><FormLabel>Branch</FormLabel><FormControl><Input placeholder="Branch" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="department" render={({ field }) => (
                  <FormItem><FormLabel>Department</FormLabel><FormControl><Input placeholder="Department" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="birthdate" render={({ field }) => (
                  <FormItem><FormLabel>Birthdate</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="dateHired" render={({ field }) => (
                  <FormItem><FormLabel>Date Hired</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>Role</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="cashier">Cashier</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="employmentStatus" render={({ field }) => (
                  <FormItem><FormLabel>Status</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="on_leave">On Leave</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="assignedShift" render={({ field }) => (
                  <FormItem><FormLabel>Shift</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger></FormControl><SelectContent><SelectItem value="morning">Morning</SelectItem><SelectItem value="afternoon">Afternoon</SelectItem><SelectItem value="evening">Evening</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="gender" render={({ field }) => (
                  <FormItem><FormLabel>Gender</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                )} />
                </div>
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="Address" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                    className="flex-1 border-gray-200"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
                  >
                    {isLoading ? 'Adding...' : 'Add Staff'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deletingStaff} onOpenChange={() => setDeletingStaff(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Staff Member</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove "{deletingStaff?.name}"? They will no longer have access.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-500 hover:bg-red-600 text-white"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
};

const StatCard = ({
  icon,
  value,
  label,
  color
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: string;
}) => (
  <Card className={`border ${color} bg-white shadow-sm hover:shadow-md transition-shadow`}>
    <CardContent className="p-5">
      <div className="flex items-center justify-between">
        <div className="p-2 bg-gray-50 rounded-lg">
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-3xl font-bold text-gray-900">{value}</h3>
        <p className="text-sm text-gray-500 mt-1">{label}</p>
      </div>
    </CardContent>
  </Card>
);

const EditStaffForm = ({
  staff,
  onSave,
  onCancel,
  isSaving
}: {
  staff: StaffDetails;
  onSave: (data: any) => void;
  onCancel: () => void;
  isSaving: boolean;
}) => {
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [formData, setFormData] = useState<any>({
    firstName: staff.firstName || staff.name.split(' ')[0] || '',
    middleName: staff.middleName || '',
    lastName: staff.lastName || staff.name.split(' ').slice(1).join(' ') || '',
    name: staff.name,
    email: staff.email || '',
    phone: staff.phone || '',
    address: staff.address || '',
    role: (staff.role || 'cashier').toLowerCase(),
    branch: staff.branch || '',
    department: staff.department || '',
    employmentStatus: staff.employmentStatus || 'active',
    assignedShift: staff.assignedShift || '',
    birthdate: staff.birthdate ? String(staff.birthdate).slice(0, 10) : '',
    gender: staff.gender || '',
    dateHired: staff.dateHired ? String(staff.dateHired).slice(0, 10) : '',
    permissions: staff.permissions || [],
  });

  // Password reset state
  const [pwOpen, setPwOpen] = useState(false);
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [showEditPw, setShowEditPw] = useState(false);
  const { toast: pwToast } = useToast();

  const handleResetPassword = async () => {
    if (!pwNew || pwNew.length < 4) {
      pwToast({ title: 'Password too short', description: 'New password must be at least 4 characters.', variant: 'destructive' });
      return;
    }
    if (pwNew !== pwConfirm) {
      pwToast({ title: 'Passwords do not match', description: 'Please re-enter the new password in both fields.', variant: 'destructive' });
      return;
    }
    setPwSaving(true);
    try {
      let ok = false;
      try {
        await api.put(`/api/staff/${staff.id}/password`, { newPassword: pwNew, confirmPassword: pwConfirm });
        ok = true;
      } catch (serverErr: any) {
        console.warn('[Staff Password Reset] Server failed, falling back to IndexedDB:', serverErr?.message || serverErr);
        if (typeof StaffService.updateStaffPassword === 'function') {
          await StaffService.updateStaffPassword(staff.id, pwNew);
          ok = true;
        }
        if (!ok) throw serverErr;
      }
      if (ok) {
        pwToast({ title: 'Password updated', description: `${staff.name}'s password has been reset successfully.` });
        setPwNew('');
        setPwConfirm('');
        setPwOpen(false);
      }
    } catch (err: any) {
      console.error('Password reset error:', err);
      pwToast({
        title: 'Password reset failed',
        description: String(err?.error || err?.message || 'Unknown error').slice(0, 160),
        variant: 'destructive'
      });
    } finally {
      setPwSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConfirmDialogOpen(true);
  };

  const handleConfirm = () => {
    setConfirmDialogOpen(false);
    onSave({
      ...formData,
      name: [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(' '),
      email: formData.email || null,
      phone: formData.phone || null,
      address: formData.address || null,
      branch: formData.branch || null,
      department: formData.department || null,
      birthdate: formData.birthdate || null,
      dateHired: formData.dateHired || null,
      gender: formData.gender || null,
      assignedShift: formData.assignedShift || null,
    });
  };

  return (
    <LocalizedContent>
    <form onSubmit={handleSubmit} className="space-y-6 py-4">
      {/* Profile Section */}
      <div className="flex items-center gap-4">
        <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${getGradient(staff.name)} flex items-center justify-center text-white font-bold text-2xl shadow-md`}>
          {getInitials(staff.name)}
        </div>
        <div>
          <h2 className="text-xl font-bold">{staff.name}</h2>
          <p className="text-sm text-gray-500">Staff ID: {staff.staffId}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">First Name</label>
          <Input
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Middle Name</label><Input value={formData.middleName} onChange={(e) => setFormData({ ...formData, middleName: e.target.value })} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Last Name</label><Input value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} required /></div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Email</label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Phone</label>
          <Input
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
        <div className="space-y-1 col-span-2">
          <label className="text-sm font-medium">Address</label>
          <Input
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Role</label>
          <Select
            value={formData.role}
            onValueChange={(val) => setFormData({ ...formData, role: val })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cashier">Cashier</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Branch</label>
          <Input
            value={formData.branch}
            onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Department</label>
          <Input
            value={formData.department}
            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Status</label>
          <Select
            value={formData.employmentStatus}
            onValueChange={(val) => setFormData({ ...formData, employmentStatus: val })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="on_leave">On Leave</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Shift</label>
          <Select
            value={formData.assignedShift}
            onValueChange={(val) => setFormData({ ...formData, assignedShift: val })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Morning</SelectItem>
              <SelectItem value="afternoon">Afternoon</SelectItem>
              <SelectItem value="evening">Evening</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><label className="text-sm font-medium">Birthdate</label><Input type="date" value={formData.birthdate} onChange={(e) => setFormData({ ...formData, birthdate: e.target.value })} /></div>
        <div className="space-y-1"><label className="text-sm font-medium">Date Hired</label><Input type="date" value={formData.dateHired} onChange={(e) => setFormData({ ...formData, dateHired: e.target.value })} /></div>
      </div>

      {/* Password Reset Section */}
      <Separator className="my-2" />
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setPwOpen(!pwOpen)}
          className="w-full flex items-center justify-between p-4 rounded-xl bg-gray-50 hover:bg-gray-100 dark:bg-gray-800/60 dark:hover:bg-gray-800 transition border border-gray-100 dark:border-gray-700"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <Key className="w-5 h-5 text-red-600 dark:text-red-300" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-gray-800 dark:text-gray-100">Reset Staff Password</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {staff.passwordLastChanged
                  ? `Last changed ${new Date(staff.passwordLastChanged).toLocaleDateString()}`
                  : 'Password has never been reset since creation'}
              </div>
            </div>
          </div>
          <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${pwOpen ? 'rotate-90' : ''}`} />
        </button>

        {pwOpen && (
          <div className="mt-4 space-y-4 p-4 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/60 dark:bg-red-950/20">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-red-700 dark:text-red-300/90 leading-relaxed">
                After resetting this password, share the new credentials with the staff member securely. They will need to use this new password on their next login. Consider rotating temporary passwords immediately.
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">New Password</label>
                <div className="relative">
                  <Input
                    type={showEditPw ? "text" : "password"}
                    placeholder="Enter new password (min 4 characters)"
                    autoComplete="new-password"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    className="bg-white dark:bg-gray-800 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPw(!showEditPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    title={showEditPw ? "Hide password" : "Show password"}
                  >
                    {showEditPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Confirm New Password</label>
                <div className="relative">
                  <Input
                    type={showEditPw ? "text" : "password"}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    className="bg-white dark:bg-gray-800 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPw(!showEditPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                    title={showEditPw ? "Hide password" : "Show password"}
                  >
                    {showEditPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPwOpen(false);
                    setPwNew('');
                    setPwConfirm('');
                  }}
                  className="flex-1 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={pwSaving}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl"
                >
                  {pwSaving ? 'Updating...' : 'Reset Password'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" className="flex-1 bg-[#2563EB]" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to save these changes? This will update the staff information.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
    </LocalizedContent>
  );
};

const StaffTimestampDialog = ({
  open,
  onOpenChange,
  staff,
  timestamps,
  isLoading,
  onExport
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffWithStatus | null;
  timestamps: any[];
  isLoading: boolean;
  onExport: () => void;
}) => {
  if (!staff) return null;
  const initials = getInitials(staff.name || 'Staff');
  const gradient = getGradient(staff.name || 'Staff');
  const roleColor = staff.role?.toLowerCase().includes('manager')
    ? 'bg-blue-100 text-blue-700'
    : staff.role?.toLowerCase().includes('admin')
      ? 'bg-purple-100 text-purple-700'
      : 'bg-green-100 text-green-700';

  const totalHours = timestamps.reduce((acc, curr) => acc + (Number(curr.hoursWorked) || 0), 0);

  return (
    <LocalizedContent>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-2xl">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-900 text-white flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-xl shadow-md border border-white/20 flex-shrink-0`}>
                {initials}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white tracking-tight">{staff.name}</h2>
                  <Badge className={`px-2.5 py-0.5 rounded-full text-xs font-medium border-0 ${roleColor}`}>
                    {staff.role || 'Cashier'}
                  </Badge>
                  <Badge className={`px-2.5 py-0.5 rounded-full text-xs font-medium border-0 ${
                    staff.isOnline ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {staff.isOnline ? '● Online' : 'Offline'}
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 flex items-center gap-2">
                  <span>Staff ID: <strong className="text-white font-medium">{staff.staffId}</strong></span>
                  {staff.department && <span>• Dept: <strong className="text-white font-medium">{staff.department}</strong></span>}
                </p>
              </div>
            </div>

            <Button
              onClick={onExport}
              disabled={timestamps.length === 0 || isLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md gap-2 text-xs font-semibold px-4 py-2.5 flex-shrink-0 cursor-pointer transition-all hover:shadow-lg disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export to Excel</span>
            </Button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-800">
            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Total Logins</span>
              <span className="text-lg font-bold text-white mt-0.5 block">{timestamps.length}</span>
            </div>
            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Total Hours</span>
              <span className="text-lg font-bold text-blue-400 mt-0.5 block">{totalHours.toFixed(2)} hrs</span>
            </div>
            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Current Status</span>
              <span className={`text-sm font-semibold mt-1 block ${staff.isOnline ? 'text-emerald-400' : 'text-slate-300'}`}>
                {staff.isOnline ? 'Active / On Duty' : 'Off Duty'}
              </span>
            </div>
          </div>
        </div>

        {/* Attendance & Timestamps Table Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
          {isLoading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-[#2563EB] animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500 font-medium">Loading attendance timestamp records...</p>
            </div>
          ) : timestamps.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-2xl border border-gray-100 p-8 shadow-xs">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <Clock className="w-8 h-8" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">No Attendance Timestamps Found</h3>
              <p className="text-sm text-gray-500 max-w-sm mx-auto">
                No login or clock-in sessions have been recorded for {staff.name} yet.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200/80 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/90 text-gray-600 font-semibold uppercase text-[11px] tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Time In</th>
                      <th className="py-3 px-4">Time Out</th>
                      <th className="py-3 px-4">Hours</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {timestamps.map((item, idx) => {
                      const timeInStr = item.timeIn ? new Date(item.timeIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
                      const timeOutStr = item.timeOut ? new Date(item.timeOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
                      const isCompleted = Boolean(item.timeOut);

                      return (
                        <tr key={item.id || idx} className="hover:bg-blue-50/30 transition-colors">
                          <td className="py-3.5 px-4 font-medium text-gray-900 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                              <span>{item.date || '-'}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-gray-700 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md w-fit">
                              <Clock className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{timeInStr}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-gray-700 whitespace-nowrap">
                            {timeOutStr ? (
                              <div className="flex items-center gap-1.5 font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded-md w-fit">
                                <Clock className="w-3.5 h-3.5 text-slate-500" />
                                <span>{timeOutStr}</span>
                              </div>
                            ) : (
                              <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-medium text-[11px]">
                                Active (Open)
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-gray-900 whitespace-nowrap">
                            {item.hoursWorked != null ? (
                              <span>{item.hoursWorked} hrs</span>
                            ) : (
                              <span className="text-gray-400 italic">{isCompleted ? '-' : 'Running...'}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <Badge className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold border-0 ${
                              isCompleted ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {isCompleted ? 'Completed' : '● Active'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </LocalizedContent>
  );
};

const StaffCard = ({
  member,
  index,
  onDelete,
  onView,
  onEdit,
  onTimestamp
}: {
  member: StaffWithStatus;
  index: number;
  onDelete: () => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onTimestamp: () => void;
}) => {
  const initials = getInitials(member.name);
  const gradient = getGradient(member.name);
  const roleColor = member.role?.toLowerCase().includes('manager')
    ? 'bg-blue-100 text-blue-700'
    : member.role?.toLowerCase().includes('admin')
      ? 'bg-purple-100 text-purple-700'
      : 'bg-green-100 text-green-700';

  return (
    <LocalizedContent>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-1 transition-all"
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`relative w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-base sm:text-lg shadow-md`}>
              {initials}
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-white ${
                member.isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
              }`} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base sm:text-lg font-bold text-gray-900 truncate">{member.name}</CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <Badge className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium border-0 ${roleColor}`}>
                  {member.role || 'Cashier'}
                </Badge>
                <Badge className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium border-0 ${
                  member.isOnline ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600'
                }`}>
                  {member.isOnline ? 'Online' : 'Offline'}
                </Badge>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onTimestamp}
            className="flex-shrink-0 h-8 px-2.5 text-xs font-semibold text-blue-700 border-blue-200 bg-blue-50/60 hover:bg-blue-100 hover:text-blue-800 rounded-lg gap-1.5 transition-all shadow-xs cursor-pointer"
            title="View Attendance & Timestamps"
          >
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            <span>Time Stamp</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-4 pt-0">
        <div className="space-y-3 mb-4">
          <div className="flex items-center text-sm text-gray-500">
            <Clock className="w-4 h-4 mr-2 text-gray-400" />
            <span>Last active: {member.isOnline ? 'Just now' : 'Unknown'}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-xl">
            <div>
              <div className="text-xs text-gray-500 mb-1">Staff ID</div>
              <div className="font-medium text-gray-900">{member.staffId}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Today's Sales</div>
              <div className="font-medium text-[#2563EB]">
                ₱{member.todaySales?.toLocaleString() || '0'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-3 border-t border-gray-100">
          <Button variant="outline" size="sm" onClick={() => onView(member.id)} className="flex-1 h-9 border-gray-200 bg-white">
            <Eye className="w-4 h-4 mr-2" />
            View
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(member.id)} className="flex-1 h-9 border-gray-200 bg-white">
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-9 px-3 text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </motion.div>
    </LocalizedContent>
  );
};

export default StaffManagement;
