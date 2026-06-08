/**
 * src/lib/agreementValidators.ts
 *
 * Pure validation helpers for agreement form fields.
 * All functions return an error string or null (no error).
 */

export function validateAssetsInScope(value: string): string | null {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) {
    return 'Assets in Scope must contain at least one non-empty item';
  }
  return null;
}

export function validateEligibleCollateral(value: string): string | null {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) {
    return 'Eligible Collateral must contain at least one non-empty item';
  }
  return null;
}

export function validateLtvPct(value: string, fieldLabel: string): string | null {
  if (value.trim() === '') return `${fieldLabel} is required`;
  const num = parseFloat(value);
  if (isNaN(num)) return `${fieldLabel} must be a number`;
  if (num <= 0) return `${fieldLabel} must be greater than 0`;
  if (num >= 100) return `${fieldLabel} must be less than 100`;
  return null;
}

export function validateMarginCallLtv(
  marginCall: string,
  initial: string,
): string | null {
  const marginNum = parseFloat(marginCall);
  const initialNum = parseFloat(initial);
  if (isNaN(marginNum) || isNaN(initialNum)) return null; // individual field errors handle this
  if (marginNum <= initialNum) {
    return 'Margin Call LTV % must be greater than Initial LTV %';
  }
  return null;
}

export function validateLiquidationLtv(
  liquidation: string,
  marginCall: string,
): string | null {
  const liquidationNum = parseFloat(liquidation);
  const marginNum = parseFloat(marginCall);
  if (isNaN(liquidationNum) || isNaN(marginNum)) return null;
  if (liquidationNum <= marginNum) {
    return 'Liquidation LTV % must be greater than Margin Call LTV %';
  }
  return null;
}

export function validatePositiveInt(
  value: string,
  fieldLabel: string,
  min = 1,
  max?: number,
): string | null {
  if (value.trim() === '') return `${fieldLabel} is required`;
  const num = Number(value);
  if (!Number.isInteger(num) || isNaN(num)) return `${fieldLabel} must be a whole number`;
  if (num < min) return `${fieldLabel} must be at least ${min}`;
  if (max !== undefined && num > max) return `${fieldLabel} must be at most ${max}`;
  return null;
}

export function validateDayCountBasis(value: string): string | null {
  if (value === 'actual_360' || value === 'actual_365') return null;
  return 'Day Count Basis is required';
}
