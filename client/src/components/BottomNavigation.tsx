import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useDevices } from '@/contexts/DeviceContext';
import { Home, Package, Scan, Users, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

const BottomNavigation: React.FC = () => {
  const [location, setLocation] = useLocation();
  const { isAdmin } = useAuth();
  const { deviceMode } = useDevices();
  const { t } = useLanguage();
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isAdmin) return null;

  const navItems = [
    { id: 'dashboard', icon: Home, label: t('dashboard'), path: '/admin-main' },
    { id: 'inventory', icon: Package, label: t('inventory'), path: '/inventory' },
    { id: 'scanner', icon: Scan, label: '', path: '/pos', isScanner: true },
    { id: 'staff', icon: Users, label: t('staff'), path: '/staff' },
    { id: 'profile', icon: User, label: t('profile'), path: '/profile' },
  ];

  const getContainerMaxWidth = () => {
    switch (deviceMode) {
      case 'pc': return 'max-w-4xl';
      case 'tablet': return 'max-w-2xl';
      case 'mobile': return 'max-w-md';
      default: return 'max-w-lg';
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-2 sm:px-4 pb-4 bg-transparent pointer-events-none">
      <div className={cn("w-full mx-auto pointer-events-auto", getContainerMaxWidth())}>
        {/* Soft UI Navigation Container */}
        <div
          className="relative bg-white/95 rounded-[2rem] shadow-[0_10px_40px_rgba(0,0,0,0.15)] border border-gray-100/50 overflow-visible"
          style={{ backdropFilter: 'blur(10px)' }}
        >
          <div className="relative flex justify-around items-center py-2 sm:py-4 px-1 sm:px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path;

              if (item.isScanner) {
                return (
                  <button
                    key={item.id}
                    onClick={() => setLocation(item.path)}
                    data-testid={`nav-${item.id}`}
                    aria-label={t('salesScanner')}
                    className="relative -top-6 sm:-top-8 z-10"
                  >
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-[#BF953F] via-[#FCF6BA] to-[#B38728] rounded-full flex items-center justify-center shadow-[0_10px_25px_rgba(191,149,63,0.4)] touch-feedback hover:scale-110 active:scale-95 transition-all duration-300 transform border-2 sm:border-4 border-white"
                         style={{
                           boxShadow: '0 10px 25px rgba(191, 149, 63, 0.4), inset 0 2px 4px rgba(255,255,255,0.5)',
                         }}>
                      <Icon className="w-6 h-6 sm:w-8 sm:h-8 text-[#5C4D2E] drop-shadow-sm" />
                    </div>
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  onClick={() => setLocation(item.path)}
                  data-testid={`nav-${item.id}`}
                  className={cn(
                    "relative flex flex-col items-center py-1 sm:py-2 px-2 sm:px-4 transition-all duration-300 rounded-2xl group min-w-[50px] sm:min-w-[64px]",
                    isActive
                      ? "text-[#BF953F]"
                      : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  <div className="relative flex flex-col items-center">
                    <Icon
                      className={cn(
                        "w-5 h-5 sm:w-6 sm:h-6 mb-0.5 sm:mb-1 transition-all duration-300",
                        isActive
                          ? "text-[#BF953F] drop-shadow-sm scale-110"
                          : "group-hover:scale-110"
                      )}
                    />
                    <span
                      className={cn(
                        "text-[8px] sm:text-[10px] font-black uppercase tracking-tighter transition-all duration-300",
                        isActive ? "text-[#BF953F]" : "text-gray-400"
                      )}
                    >
                      {item.label}
                    </span>
                    {isActive && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute -bottom-1.5 sm:-bottom-2 w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full bg-[#BF953F]"
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BottomNavigation;
