import React from 'react';
import { useThemeStore } from '../store/themeStore';
import { cn } from '../utils/cn';

const ASPECT = { mark: 320 / 336, full: 640 / 577 } as const;

export function BrandLogo({ variant = 'mark', className }: { variant?: 'mark' | 'full'; className?: string }): React.JSX.Element {
  const isLight = useThemeStore((s) => s.theme === 'light');
  const base = variant === 'full' ? 'voltlink-logo' : 'voltlink-mark';
  return (
    <img
      src={`/brand/${base}${isLight ? '-light' : ''}.webp`}
      alt="VoltLink"
      width={variant === 'full' ? 640 : 320}
      height={Math.round((variant === 'full' ? 640 : 320) / ASPECT[variant])}
      decoding="async"
      draggable={false}
      className={cn('block shrink-0 object-contain select-none', className)}
    />
  );
}
