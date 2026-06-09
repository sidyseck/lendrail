import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface CalcFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string; // e.g. "BTC" — static text right of the input
  helper?: React.ReactNode; // dual value / implied readback line
  error?: string; // anchored red message
  recomputed?: boolean; // triggers the blue flash
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  inputClassName?: string;
  placeholder?: string;
}

export function CalcField({
  id,
  label,
  value,
  onChange,
  unit,
  helper,
  error,
  recomputed,
  disabled,
  readOnly,
  required,
  inputClassName,
  placeholder,
}: CalcFieldProps) {
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [helper ? helperId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          placeholder={placeholder}
          inputMode="decimal"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'text-right tabular-nums transition-colors duration-500',
            recomputed && 'ring-1 ring-blue-300 bg-blue-50',
            error && 'border-red-400 focus-visible:ring-red-500',
            readOnly && 'bg-gray-100 text-gray-600',
            inputClassName,
          )}
        />
        {unit && <span className="shrink-0 text-xs text-gray-500">{unit}</span>}
      </div>
      {helper && (
        <p id={helperId} className="mt-1 text-xs text-gray-500 tabular-nums">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
