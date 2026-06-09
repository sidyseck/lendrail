import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listApprovedBorrowers } from '@/api/borrowerApi';
import { bookLoan } from '@/api/loanApi';
import { useAgentInventory } from '@/hooks/useAgentInventory';
import { usePriceStream } from '@/hooks/usePriceStream';
import type { ApprovedBorrower } from '@/types/borrower';
import type { LoanBookingRequest } from '@/types/loan';

type TermType = 'open' | 'fixed';

interface Props {
  onBooked: () => Promise<void>;
}

interface FormValues {
  borrower_id: string;
  quantity: string;
  asset_price_usd: string;
  booking_ltv_pct: string;
  margin_call_ltv_pct: string;
  liquidation_ltv_pct: string;
  rate_bps: string;
  term_type: TermType;
  maturity_date: string;
  collateral_type: string;
  collateral_quantity: string;
  collateral_value_usd: string;
}

const EMPTY_FORM: FormValues = {
  borrower_id: '',
  quantity: '',
  asset_price_usd: '',
  booking_ltv_pct: '',
  margin_call_ltv_pct: '',
  liquidation_ltv_pct: '',
  rate_bps: '',
  term_type: 'open',
  maturity_date: '',
  collateral_type: 'CASH_USD',
  collateral_quantity: '',
  collateral_value_usd: '',
};

const COLLATERAL_TYPES = [
  { value: 'CASH_USD', label: 'USD Cash' },
  { value: 'TREASURY', label: 'US Treasury' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'CRYPTO', label: 'Crypto' },
  { value: 'OTHER', label: 'Other' },
];

/** Parse human-friendly shorthand: 50k → 50000, 1.5m → 1500000 */
function parseShorthand(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, '');
  if (!s) return null;
  const match = /^([\d.]+)\s*([kmb]?)$/.exec(s);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  const mult: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000, '': 1 };
  return num * (mult[match[2]] ?? 1);
}

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{children}</span>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

function Field({
  label,
  hint,
  hintVariant = 'neutral',
  children,
}: {
  label: string;
  hint?: string;
  hintVariant?: 'neutral' | 'warn' | 'ok';
  children: React.ReactNode;
}) {
  const hintColor =
    hintVariant === 'warn'
      ? 'text-red-600'
      : hintVariant === 'ok'
      ? 'text-green-700'
      : 'text-gray-400';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
      {hint && <span className={`text-[11px] tabular-nums ${hintColor}`}>{hint}</span>}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-300';
const inputNumCls = inputCls + ' tabular-nums';

export function BookLoanStrip({ onBooked }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const inventory = useAgentInventory();
  const prices = usePriceStream();
  const [selectedKey, setSelectedKey] = useState('');
  const [borrowers, setBorrowers] = useState<ApprovedBorrower[]>([]);
  const [borrowersLoading, setBorrowersLoading] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const latestPrices = useRef(prices);
  latestPrices.current = prices;

  const rows = inventory.breakdown;
  const selected = useMemo(
    () => rows.find((row) => `${row.connection_id}:${row.asset_type}` === selectedKey) ?? null,
    [rows, selectedKey],
  );
  const selectedBorrower = borrowers.find((b) => b.borrower_id === values.borrower_id) ?? null;

  // ── Derived values ──────────────────────────────────────────────────────
  const parsedQty = parseShorthand(values.quantity);
  const parsedPrice = parseShorthand(values.asset_price_usd);
  const notional = parsedQty !== null && parsedPrice !== null ? parsedQty * parsedPrice : null;

  const parsedCollateralValue = parseShorthand(values.collateral_value_usd);
  const coverageRatio =
    notional !== null && notional > 0 && parsedCollateralValue !== null
      ? (parsedCollateralValue / notional) * 100
      : null;

  const ratePct = values.rate_bps ? (Number(values.rate_bps) / 100).toFixed(2) : null;

  const summaryReady = !!(selected && selectedBorrower && parsedQty !== null && parsedPrice !== null);

  // ── URL sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const connectionId = searchParams.get('connection_id');
    const assetType = searchParams.get('asset_type');
    if (connectionId && assetType) setSelectedKey(`${connectionId}:${assetType}`);
  }, [searchParams]);

  useEffect(() => {
    if (!selected && rows.length > 0 && !searchParams.get('connection_id')) {
      const first = rows[0];
      setSelectedKey(`${first.connection_id}:${first.asset_type}`);
    }
  }, [rows, searchParams, selected]);

  useEffect(() => {
    if (!selected) return;
    const p = latestPrices.current[selected.asset_type];
    if (p !== undefined) setValues((cur) => ({ ...cur, asset_price_usd: p.toFixed(2) }));
  }, [selected?.asset_type]);

  useEffect(() => {
    if (!selected) {
      setBorrowers([]);
      return;
    }
    let cancelled = false;
    setBorrowersLoading(true);
    setError(null);
    setValues((cur) => ({ ...cur, borrower_id: '' }));
    listApprovedBorrowers(selected.connection_id)
      .then((data) => { if (!cancelled) setBorrowers(data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load borrowers.'); })
      .finally(() => { if (!cancelled) setBorrowersLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  function chooseInventory(nextKey: string) {
    setSelectedKey(nextKey);
    const [connectionId, assetType] = nextKey.split(':');
    setSearchParams({ connection_id: connectionId, asset_type: assetType });
  }

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((cur) => ({ ...cur, [key]: value }));
  }

  function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirming(true);
  }

  async function handleConfirm() {
    if (!selected) return;
    const quantityStr = parsedQty !== null ? String(parsedQty) : values.quantity;
    const priceStr = parsedPrice !== null ? parsedPrice.toFixed(2) : values.asset_price_usd;
    const collQtyParsed = parseShorthand(values.collateral_quantity);
    const collQtyStr = collQtyParsed !== null ? String(collQtyParsed) : values.collateral_quantity;
    const collValParsed = parseShorthand(values.collateral_value_usd);
    const collValStr = collValParsed !== null ? collValParsed.toFixed(2) : values.collateral_value_usd;

    setError(null);
    setSuccess(null);
    setIsBooking(true);
    try {
      const payload: LoanBookingRequest = {
        connection_id: selected.connection_id,
        borrower_id: values.borrower_id,
        asset_type: selected.asset_type,
        quantity: quantityStr,
        asset_price_usd: priceStr,
        booking_ltv_pct: values.booking_ltv_pct,
        margin_call_ltv_pct: values.margin_call_ltv_pct,
        liquidation_ltv_pct: values.liquidation_ltv_pct,
        rate_bps: Number(values.rate_bps),
        term_type: values.term_type,
        maturity_date: values.term_type === 'fixed' ? values.maturity_date : null,
        collateral_type: values.collateral_type,
        collateral_quantity: collQtyStr,
        collateral_value_usd: collValStr,
      };
      await bookLoan(payload);
      setValues(EMPTY_FORM);
      setConfirming(false);
      setSuccess('Loan booked.');
      await onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book loan.');
      setConfirming(false);
    } finally {
      setIsBooking(false);
    }
  }

  // ── Loading / empty states ───────────────────────────────────────────────
  if (inventory.isLoading) {
    return (
      <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 px-5 py-4 text-sm text-gray-400">
        Loading booking inventory...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mb-6 rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500">
        No supplier inventory is available for booking.
      </div>
    );
  }

  // ── Confirmation step ────────────────────────────────────────────────────
  if (confirming && summaryReady) {
    return (
      <section
        aria-labelledby="confirm-booking-heading"
        className="mb-6 rounded-lg border border-gray-300 bg-white shadow-sm"
      >
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 id="confirm-booking-heading" className="text-sm font-semibold text-gray-900">
            Confirm Booking
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            This action cannot be undone. Verify all details before confirming.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="mb-4 space-y-2.5 rounded-lg bg-gray-50 px-4 py-4 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-gray-500">Lend</span>
              <span className="text-right font-semibold tabular-nums text-gray-900">
                {fmtNumber(parsedQty)} {selected.asset_type}
                {notional !== null && (
                  <span className="ml-2 font-normal text-gray-500">{fmtUSD(notional)}</span>
                )}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-gray-500">Borrower</span>
              <span className="font-semibold text-gray-900">{selectedBorrower.name}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-gray-500">Rate</span>
              <span className="tabular-nums text-gray-900">
                {values.rate_bps} bps{ratePct ? ` (${ratePct}% p.a.)` : ''}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-gray-500">Term</span>
              <span className="text-gray-900">
                {values.term_type === 'open' ? 'Open' : `Fixed — matures ${values.maturity_date}`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-gray-500">Collateral</span>
              <span className="text-right tabular-nums text-gray-900">
                {values.collateral_type}
                {parsedCollateralValue !== null && ` · ${fmtUSD(parsedCollateralValue)}`}
                {coverageRatio !== null && (
                  <span className={`ml-2 text-xs font-medium ${coverageRatio < 100 ? 'text-red-600' : 'text-green-700'}`}>
                    {coverageRatio.toFixed(1)}% cover
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="shrink-0 text-gray-500">LTV thresholds</span>
              <span className="tabular-nums text-gray-900">
                Book {values.booking_ltv_pct}%
                {values.margin_call_ltv_pct && (
                  <span className="text-amber-600"> · MC {values.margin_call_ltv_pct}%</span>
                )}
                {values.liquidation_ltv_pct && (
                  <span className="text-red-600"> · Liq {values.liquidation_ltv_pct}%</span>
                )}
              </span>
            </div>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isBooking}
              className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isBooking}
              className="flex-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {isBooking ? 'Booking...' : 'Confirm & Book'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="book-loan-heading" className="mb-6 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 id="book-loan-heading" className="text-sm font-semibold text-gray-900">
          Book Loan
        </h2>
        <Link to="/dashboard/borrowers" className="text-xs font-medium text-blue-700 hover:text-blue-900">
          Manage borrowers
        </Link>
      </div>

      {success && (
        <div className="border-b border-green-100 bg-green-50 px-5 py-2 text-sm text-green-800">{success}</div>
      )}
      {(inventory.error || error) && (
        <div role="alert" className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">
          {inventory.error ?? error}
        </div>
      )}

      <form onSubmit={handleReview} className="p-5 space-y-5">

        {/* ── Counterparty ─────────────────────────────────────────────── */}
        <div>
          <SectionLabel>Counterparty</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier inventory">
              <select
                value={selectedKey}
                onChange={(e) => chooseInventory(e.target.value)}
                className={inputCls}
              >
                {rows.map((row) => {
                  const key = `${row.connection_id}:${row.asset_type}`;
                  return (
                    <option key={key} value={key}>
                      {row.asset_type} · {fmtNumber(Number(row.effective_available))} avail · {row.supplier_id.slice(0, 8)}
                    </option>
                  );
                })}
              </select>
            </Field>

            <Field label="Borrower">
              <select
                required
                value={values.borrower_id}
                onChange={(e) => updateValue('borrower_id', e.target.value)}
                disabled={borrowersLoading}
                className={`${inputCls} disabled:bg-gray-50`}
              >
                <option value="">{borrowersLoading ? 'Loading...' : '— Select borrower —'}</option>
                {borrowers.map((b) => (
                  <option key={b.borrower_id} value={b.borrower_id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {borrowers.length === 0 && !borrowersLoading && (
                <span className="text-[11px] text-amber-600">
                  No approved borrowers.{' '}
                  <Link to="/dashboard/borrowers" className="underline">
                    Onboard one
                  </Link>
                  .
                </span>
              )}
            </Field>
          </div>
        </div>

        {/* ── Loan Terms ───────────────────────────────────────────────── */}
        <div>
          <SectionLabel>Loan Terms</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Quantity"
              hint={parsedQty !== null ? `= ${fmtNumber(parsedQty)} ${selected?.asset_type ?? ''}` : undefined}
            >
              <input
                required
                placeholder="e.g. 50,000 or 50k"
                value={values.quantity}
                onChange={(e) => updateValue('quantity', e.target.value)}
                className={inputNumCls}
              />
            </Field>

            <Field
              label="Asset price (USD)"
              hint={notional !== null ? `Notional: ${fmtUSD(notional)}` : undefined}
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">$</span>
                <input
                  required
                  placeholder="0.00"
                  value={values.asset_price_usd}
                  onChange={(e) => updateValue('asset_price_usd', e.target.value)}
                  className={`${inputNumCls} pl-7`}
                />
              </div>
            </Field>

            <Field
              label="Rate"
              hint={ratePct ? `${ratePct}% per annum` : undefined}
            >
              <div className="relative">
                <input
                  required
                  type="number"
                  min="0"
                  placeholder="0"
                  value={values.rate_bps}
                  onChange={(e) => updateValue('rate_bps', e.target.value)}
                  className={`${inputNumCls} pr-10`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">bps</span>
              </div>
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Term type">
              <div className="flex overflow-hidden rounded-md border border-gray-300">
                {(['open', 'fixed'] as TermType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateValue('term_type', t)}
                    className={`flex-1 py-2 text-sm font-medium capitalize transition-colors ${
                      values.term_type === t
                        ? 'bg-gray-900 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>

            {values.term_type === 'fixed' && (
              <Field label="Maturity date">
                <input
                  required
                  type="date"
                  value={values.maturity_date}
                  onChange={(e) => updateValue('maturity_date', e.target.value)}
                  className={inputCls}
                />
              </Field>
            )}
          </div>
        </div>

        {/* ── LTV Thresholds ───────────────────────────────────────────── */}
        <div>
          <SectionLabel>LTV Thresholds</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { key: 'booking_ltv_pct', label: 'Booking LTV' },
                { key: 'margin_call_ltv_pct', label: 'Margin call LTV' },
                { key: 'liquidation_ltv_pct', label: 'Liquidation LTV' },
              ] as const
            ).map(({ key, label }) => (
              <Field key={key} label={label}>
                <div className="relative">
                  <input
                    required
                    placeholder="0"
                    value={values[key]}
                    onChange={(e) => updateValue(key, e.target.value)}
                    className={`${inputNumCls} pr-8`}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">%</span>
                </div>
              </Field>
            ))}
          </div>
          {values.booking_ltv_pct && values.margin_call_ltv_pct && values.liquidation_ltv_pct && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] tabular-nums">
              <span className="text-gray-600">Book {values.booking_ltv_pct}%</span>
              <span className="text-gray-300">→</span>
              <span className="text-amber-600">MC {values.margin_call_ltv_pct}%</span>
              <span className="text-gray-300">→</span>
              <span className="text-red-600">Liq {values.liquidation_ltv_pct}%</span>
            </div>
          )}
        </div>

        {/* ── Collateral ───────────────────────────────────────────────── */}
        <div>
          <SectionLabel>Collateral</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Collateral type">
              <select
                required
                value={values.collateral_type}
                onChange={(e) => updateValue('collateral_type', e.target.value)}
                className={inputCls}
              >
                {COLLATERAL_TYPES.map((ct) => (
                  <option key={ct.value} value={ct.value}>
                    {ct.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Collateral quantity">
              <input
                required
                placeholder="e.g. 100 or 1k"
                value={values.collateral_quantity}
                onChange={(e) => updateValue('collateral_quantity', e.target.value)}
                className={inputNumCls}
              />
            </Field>

            <Field
              label="Collateral value (USD)"
              hint={
                coverageRatio !== null
                  ? coverageRatio < 100
                    ? `${coverageRatio.toFixed(1)}% coverage — under-collateralized`
                    : `${coverageRatio.toFixed(1)}% coverage`
                  : undefined
              }
              hintVariant={
                coverageRatio !== null ? (coverageRatio < 100 ? 'warn' : 'ok') : 'neutral'
              }
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">$</span>
                <input
                  required
                  placeholder="0.00"
                  value={values.collateral_value_usd}
                  onChange={(e) => updateValue('collateral_value_usd', e.target.value)}
                  className={`${inputNumCls} pl-7 ${
                    coverageRatio !== null && coverageRatio < 100
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
                      : ''
                  }`}
                />
              </div>
            </Field>
          </div>
        </div>

        {/* ── Booking preview ──────────────────────────────────────────── */}
        {summaryReady && (
          <div className="rounded-lg bg-gray-50 px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Booking preview</p>
            <p className="text-sm text-gray-900">
              Lend{' '}
              <span className="font-semibold tabular-nums">{fmtNumber(parsedQty)} {selected.asset_type}</span>
              {notional !== null && <span className="ml-1 text-gray-500">({fmtUSD(notional)})</span>}
              {' '}to{' '}
              <span className="font-semibold">{selectedBorrower.name}</span>
            </p>
            {(values.rate_bps || values.term_type) && (
              <p className="mt-1 text-sm text-gray-500">
                {ratePct ? `${values.rate_bps} bps (${ratePct}% p.a.)` : ''}
                {values.rate_bps && ' · '}
                {values.term_type === 'open'
                  ? 'Open term'
                  : `Fixed to ${values.maturity_date || '…'}`}
              </p>
            )}
            {parsedCollateralValue !== null && (
              <p className="mt-1 text-sm text-gray-500">
                {values.collateral_type} collateral · {fmtUSD(parsedCollateralValue)}
                {coverageRatio !== null && (
                  <span className={`ml-1 font-medium ${coverageRatio < 100 ? 'text-red-600' : 'text-green-700'}`}>
                    ({coverageRatio.toFixed(1)}% cover)
                  </span>
                )}
              </p>
            )}
            {values.booking_ltv_pct && (
              <p className="mt-1 text-sm text-gray-500">
                LTV {values.booking_ltv_pct}%
                {values.margin_call_ltv_pct && ` → MC ${values.margin_call_ltv_pct}%`}
                {values.liquidation_ltv_pct && ` → Liq ${values.liquidation_ltv_pct}%`}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!values.borrower_id || parsedQty === null}
            className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review & Book →
          </button>
        </div>
      </form>
    </section>
  );
}
