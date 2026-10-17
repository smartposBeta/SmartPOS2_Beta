import React, { useEffect } from 'react';
import { useLocation } from 'wouter';

const RegisterTenant: React.FC = () => {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation('/admin-signup', { replace: true });
  }, [setLocation]);

  return <div role="status" className="min-h-screen flex items-center justify-center text-sm text-gray-600">Opening secure account setup…</div>;
};

export default RegisterTenant;