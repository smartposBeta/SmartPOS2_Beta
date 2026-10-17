import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';

type ProductImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  iconClassName?: string;
  fallbackLabel?: string;
};

export default function ProductImage({
  src,
  alt,
  className,
  imageClassName,
  fallbackClassName,
  iconClassName,
  fallbackLabel,
}: ProductImageProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const showFallback = !src || hasError;

  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden', className)}>
      {showFallback ? (
        <div
          role="img"
          aria-label={`${alt} image unavailable`}
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
            fallbackClassName
          )}
        >
          <Package className={cn('h-8 w-8', iconClassName)} aria-hidden="true" />
          {fallbackLabel && <span className="text-[9px] font-semibold uppercase tracking-wider">{fallbackLabel}</span>}
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={cn('h-full w-full object-cover', imageClassName)}
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
}
