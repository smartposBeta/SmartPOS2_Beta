import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronLeft, 
  ChevronRight, 
  ShoppingCart, 
  Package, 
  Users, 
  TrendingUp, 
  LayoutDashboard, 
  ArrowRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { SalesService, ProductService, StaffService } from '@/lib/db';
import { cn } from '@/lib/utils';
import { LocalizedContent } from '@/contexts/LanguageContext';

const AdminDashboard: React.FC = () => {
  const [, setLocation] = useLocation();
  const [currentSlide, setCurrentSlide] = useState(0);
  const { user } = useAuth();
  
  const [stats, setStats] = useState({
    todaySales: 0,
    totalItems: 0,
    staffCount: 0
  });

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [sales, products, staff] = await Promise.all([
          SalesService.getTotalSales(),
          ProductService.getAllProducts(),
          StaffService.getAllStaff()
        ]);
        setStats({
          todaySales: sales,
          totalItems: products.length,
          staffCount: staff.length
        });
      } catch (err) {
        console.error('Failed to load stats', err);
      }
    };
    loadStats();
  }, []);

  const features = [
    {
      icon: <Zap className="w-8 h-8 text-amber-500" />,
      title: "Fast Selling",
      description: "Sell items quickly with our easy scanner system."
    },
    {
      icon: <ShieldCheck className="w-8 h-8 text-emerald-500" />,
      title: "Safe & Secure",
      description: "Your business data is always safe and backed up."
    },
    {
      icon: <TrendingUp className="w-8 h-8 text-blue-500" />,
      title: "Track Growth",
      description: "See how much you earn every day with simple charts."
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % features.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [features.length]);

  return (
    <LocalizedContent>
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Welcome Section */}
      <div className="bg-slate-900 pt-12 pb-20 px-6 rounded-b-[3rem] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#BF953F]/10 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24 blur-2xl" />
        
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="relative z-10"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-[#BF953F] rounded-2xl flex items-center justify-center shadow-lg shadow-[#BF953F]/20">
              <LayoutDashboard className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-[#BF953F] text-[10px] font-black uppercase tracking-[0.3em]">Quick View</p>
              <h1 className="text-2xl font-black text-white tracking-tight">Welcome, {user?.businessName || 'Admin'}!</h1>
            </div>
          </div>
          <p className="text-slate-400 text-sm font-medium">Ready to manage your store today?</p>
        </motion.div>
      </div>

      {/* Stats Quick View */}
      <div className="px-6 -mt-12 relative z-20">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Sales', value: `₱${stats.todaySales.toLocaleString()}`, icon: ShoppingCart, color: 'text-amber-500', bg: 'bg-amber-50' },
            { label: 'Items', value: stats.totalItems, icon: Package, color: 'text-blue-500', bg: 'bg-blue-50' },
            { label: 'Staff', value: stats.staffCount, icon: Users, color: 'text-emerald-500', bg: 'bg-emerald-50' }
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 * i }}
              className="bg-white p-4 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-col items-center text-center"
            >
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-2", stat.bg)}>
                <stat.icon className={cn("w-5 h-5", stat.color)} />
              </div>
              <div className="text-sm font-black text-slate-900 tracking-tight">{stat.value}</div>
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6 space-y-8">
        {/* Tips Carousel */}
        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-slate-100 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Zap className="w-20 h-20 text-slate-900" />
          </div>
          
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSlide}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="relative z-10"
            >
              <div className="mb-4">{features[currentSlide].icon}</div>
              <h3 className="text-lg font-black text-slate-900 mb-2 uppercase tracking-tight">
                {features[currentSlide].title}
              </h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                {features[currentSlide].description}
              </p>
            </motion.div>
          </AnimatePresence>

          <div className="flex gap-1.5 mt-6">
            {features.map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === currentSlide ? "w-6 bg-[#BF953F]" : "w-1.5 bg-slate-200"
                )} 
              />
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="space-y-4 pt-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] text-center px-4">
            Tap the button below to start managing your business
          </p>
          <Button
            onClick={() => setLocation('/admin-main')}
            className="w-full h-20 bg-slate-900 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] shadow-2xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[#BF953F] to-[#B38728] opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative z-10 flex items-center justify-center gap-3">
              Go to Dashboard
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
          </Button>
        </div>
      </div>

      {/* Footer Decoration */}
      <div className="p-8 text-center">
        <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.5em]">
          SmartPOS+ • Version 4.0
        </p>
      </div>
    </div>
    </LocalizedContent>
  );
};

export default AdminDashboard;
