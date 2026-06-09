import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FieldGroupProps {
  title: string;
  variant?: 'primary' | 'secondary';
  warning?: boolean;
  children: React.ReactNode;
}

export function FieldGroup({ title, variant = 'secondary', warning, children }: FieldGroupProps) {
  if (variant === 'primary') {
    return (
      <div
        className={cn(
          'rounded-md border p-4 space-y-4',
          warning ? 'border-amber-300 bg-amber-50/40' : 'border-gray-300 bg-gray-50',
        )}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
      {children}
    </div>
  );
}
