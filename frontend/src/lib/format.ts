// Display-only formatting helpers for the booking ticket.
// These NEVER mutate form state — form strings remain raw numeric (no commas/$)
// because they are submitted to the API. Use only for rendered display values.

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const QTY = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
});

/** Format a finite number as `$1,234,567.00`. Returns `—` when not finite. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return USD.format(n);
}

/** Format a quantity string (decimal-as-string) with thousands separators. Returns `—` when blank/invalid. */
export function formatQty(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—';
  const n = typeof s === 'number' ? s : Number(s);
  if (!Number.isFinite(n)) return '—';
  return QTY.format(n);
}
