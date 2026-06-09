import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listApprovedBorrowers } from '@/api/borrowerApi';
import { getLatestAgreement } from '@/api/agreementApi';
import { bookLoan } from '@/api/loanApi';
import { Button } from '@/components/ui/button';
import { useAgentInventory } from '@/hooks/useAgentInventory';
import { usePriceStream } from '@/hooks/usePriceStream';
import { formatUsd } from '@/lib/format';
import type { Agreement } from '@/types/agreement';
import type { ApprovedBorrower } from '@/types/borrower';
import type { LoanBookingRequest } from '@/types/loan';
import { BookingSummary, type BookingSummaryProps } from './BookingSummary';
import { CalcField } from './CalcField';
import { ConfirmBookingPanel } from './ConfirmBookingPanel';
import { FieldGroup } from './FieldGroup';

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

const CASH = 'CASH_USD';
const EPSILON = 1e-9;

type FieldKey = keyof FormValues;
type FieldErrors = Partial<Record<FieldKey | 'top', string>>;

// ── Numeric helpers (string-as-decimal form model) ──────────────────────────
function num(s: string): number {
  return Number(s);
}
/** Present & strictly positive: participates in the recalc engine. */
function isPos(s: string): boolean {
  const t = s.trim();
  if (t === '') return false;
  const n = num(t);
  return Number.isFinite(n) && n > 0;
}
function isCashType(t: string): boolean {
  return t.trim().toUpperCase() === CASH;
}

// Map backend F-035/F-064 error codes to the field they anchor to.
const CODE_TO_FIELD: Record<string, FieldKey | 'top'> = {
  borrower_not_approved: 'borrower_id',
  asset_not_in_scope: 'top',
  collateral_not_eligible: 'collateral_type',
  no_active_agreement: 'top',
  agreement_not_fully_confirmed: 'top',
  no_inventory_published: 'top',
  exceeds_published_inventory: 'quantity',
  below_minimum_size: 'quantity',
  insufficient_inventory: 'quantity',
};
const CODE_TO_MESSAGE: Record<string, string> = {
  borrower_not_approved: 'Borrower is not approved for this supplier connection.',
  asset_not_in_scope: 'Asset is not in the agreement scope.',
  collateral_not_eligible: 'Collateral type is not eligible under the agreement.',
  no_active_agreement: 'No active agreement for this connection.',
  agreement_not_fully_confirmed: 'Agreement is not dual-confirmed.',
  no_inventory_published: 'No inventory is published for this connection.',
  exceeds_published_inventory: 'Quantity exceeds published inventory.',
  below_minimum_size: 'Quantity is below the agreement minimum.',
  insufficient_inventory: 'Insufficient custodian inventory.',
};

export function BookLoanStrip({ onBooked }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const inventory = useAgentInventory();
  const prices = usePriceStream();
  const [selectedKey, setSelectedKey] = useState('');
  const [borrowers, setBorrowers] = useState<ApprovedBorrower[]>([]);
  const [borrowersLoading, setBorrowersLoading] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recomputedField, setRecomputedField] = useState<FieldKey | null>(null);

  const hadQueryParams = useRef(
    Boolean(searchParams.get('connection_id') && searchParams.get('asset_type')),
  );
  const [collapsed, setCollapsed] = useState(!hadQueryParams.current);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Snapshot the price once when the selected asset changes — does NOT re-run on
  // live price ticks, so operator edits are never clobbered.
  useEffect(() => {
    if (!selected) return;
    const p = latestPrices.current[selected.asset_type];
    if (p !== undefined) {
      setValues((current) => ({ ...current, asset_price_usd: p.toFixed(2) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.asset_type]);

  // Load approved borrowers when the connection changes.
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
      .then((next) => {
        if (!cancelled) setBorrowers(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load borrowers.');
      })
      .finally(() => {
        if (!cancelled) setBorrowersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Gap B: fetch the active agreement on connection change and seed LTV defaults
  // only where the field is still empty (never clobber an in-progress edit).
  useEffect(() => {
    if (!selected) {
      setAgreement(null);
      return;
    }
    let cancelled = false;
    getLatestAgreement(selected.connection_id)
      .then((agr) => {
        if (cancelled) return;
        setAgreement(agr);
        if (!agr) return;
        setValues((current) => ({
          ...current,
          booking_ltv_pct:
            current.booking_ltv_pct.trim() === ''
              ? String(Number(agr.initial_ltv_pct))
              : current.booking_ltv_pct,
          margin_call_ltv_pct:
            current.margin_call_ltv_pct.trim() === ''
              ? String(Number(agr.margin_call_ltv_pct))
              : current.margin_call_ltv_pct,
          liquidation_ltv_pct:
            current.liquidation_ltv_pct.trim() === ''
              ? String(Number(agr.liquidation_ltv_pct))
              : current.liquidation_ltv_pct,
        }));
      })
      .catch(() => {
        if (!cancelled) setAgreement(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    return () => {
      if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    };
  }, []);

  function flashRecompute(field: FieldKey) {
    setRecomputedField(field);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => setRecomputedField(null), 600);
  }

  function chooseInventory(nextKey: string) {
    setSelectedKey(nextKey);
    const [connectionId, assetType] = nextKey.split(':');
    setSearchParams({ connection_id: connectionId, asset_type: assetType });
  }

  function clearFeedback() {
    setSuccess(null);
    setError(null);
    setFieldErrors({});
  }

  // ── Recalc engine (SPEC §3) — per-field handlers; the edited field is the
  // source of truth and is never its own recompute target. ────────────────────

  function setQuantity(v: string) {
    clearFeedback();
    setValues((c) => {
      const next: FormValues = { ...c, quantity: v };
      // quantity -> collateral_value_usd
      if (isPos(v) && isPos(c.asset_price_usd) && isPos(c.booking_ltv_pct)) {
        const cv = num(v) * num(c.asset_price_usd) * (num(c.booking_ltv_pct) / 100);
        if (Number.isFinite(cv) && cv > 0) {
          next.collateral_value_usd = cv.toFixed(2);
          if (isCashType(c.collateral_type)) next.collateral_quantity = next.collateral_value_usd;
          flashRecompute('collateral_value_usd');
        }
      }
      return next;
    });
  }

  function setAssetPrice(v: string) {
    clearFeedback();
    setValues((c) => {
      const next: FormValues = { ...c, asset_price_usd: v };
      if (isPos(c.quantity) && isPos(v) && isPos(c.booking_ltv_pct)) {
        const cv = num(c.quantity) * num(v) * (num(c.booking_ltv_pct) / 100);
        if (Number.isFinite(cv) && cv > 0) {
          next.collateral_value_usd = cv.toFixed(2);
          if (isCashType(c.collateral_type)) next.collateral_quantity = next.collateral_value_usd;
          flashRecompute('collateral_value_usd');
        }
      }
      return next;
    });
  }

  function setBookingLtv(v: string) {
    clearFeedback();
    setValues((c) => {
      const next: FormValues = { ...c, booking_ltv_pct: v };
      if (isPos(c.quantity) && isPos(c.asset_price_usd) && isPos(v)) {
        const cv = num(c.quantity) * num(c.asset_price_usd) * (num(v) / 100);
        if (Number.isFinite(cv) && cv > 0) {
          next.collateral_value_usd = cv.toFixed(2);
          if (isCashType(c.collateral_type)) next.collateral_quantity = next.collateral_value_usd;
          flashRecompute('collateral_value_usd');
        }
      }
      return next;
    });
  }

  function setCollateralValue(v: string) {
    clearFeedback();
    setValues((c) => {
      const next: FormValues = { ...c, collateral_value_usd: v };
      // CASH: quantity is locked to the USD value.
      if (isCashType(c.collateral_type)) next.collateral_quantity = v;
      // collateral_value_usd -> implied booking_ltv_pct
      if (isPos(c.quantity) && isPos(c.asset_price_usd) && isPos(v)) {
        const denom = num(c.quantity) * num(c.asset_price_usd);
        if (denom > 0) {
          const ltv = (num(v) / denom) * 100;
          if (Number.isFinite(ltv) && ltv > 0) {
            next.booking_ltv_pct = ltv.toFixed(2);
            flashRecompute('booking_ltv_pct');
          }
        }
      }
      return next;
    });
  }

  function setCollateralType(v: string) {
    clearFeedback();
    setValues((c) => {
      const wasCash = isCashType(c.collateral_type);
      const nowCash = isCashType(v);
      const next: FormValues = { ...c, collateral_type: v };
      if (!wasCash && nowCash) {
        // non-CASH -> CASH: relock collateral_quantity to the USD value.
        next.collateral_quantity = c.collateral_value_usd;
      } else if (wasCash && !nowCash) {
        // CASH -> non-CASH: unlock and clear; operator must re-enter.
        next.collateral_quantity = '';
      }
      return next;
    });
  }

  function setField<K extends FieldKey>(key: K, v: FormValues[K]) {
    clearFeedback();
    setValues((c) => ({ ...c, [key]: v }));
  }

  // ── Derived display values (SPEC §4) ────────────────────────────────────────
  const loanValueUsd =
    isPos(values.quantity) && isPos(values.asset_price_usd)
      ? num(values.quantity) * num(values.asset_price_usd)
      : undefined;
  const collateralValueNum = isPos(values.collateral_value_usd)
    ? num(values.collateral_value_usd)
    : undefined;
  const impliedLtv =
    loanValueUsd !== undefined && loanValueUsd > 0 && collateralValueNum !== undefined
      ? (collateralValueNum / loanValueUsd) * 100
      : undefined;
  const coverage =
    loanValueUsd !== undefined && loanValueUsd > 0 && collateralValueNum !== undefined
      ? collateralValueNum / loanValueUsd
      : undefined;
  const isCash = isCashType(values.collateral_type);

  // ── Warning (SPEC §5): numeric divergence from agreement baseline ───────────
  const warningActive = useMemo(() => {
    if (!agreement) return false;
    const diff = (a: string, b: string) => {
      if (a.trim() === '') return false;
      const na = num(a);
      const nb = num(b);
      if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
      return Math.abs(na - nb) > EPSILON;
    };
    return (
      diff(values.booking_ltv_pct, agreement.initial_ltv_pct) ||
      diff(values.margin_call_ltv_pct, agreement.margin_call_ltv_pct) ||
      diff(values.liquidation_ltv_pct, agreement.liquidation_ltv_pct) ||
      (impliedLtv !== undefined &&
        Math.abs(impliedLtv - num(agreement.initial_ltv_pct)) > EPSILON)
    );
  }, [agreement, values.booking_ltv_pct, values.margin_call_ltv_pct, values.liquidation_ltv_pct, impliedLtv]);

  const borrowerName = borrowers.find((b) => b.borrower_id === values.borrower_id)?.name;

  const summary: BookingSummaryProps = {
    borrowerName,
    supplierShort: selected ? `${selected.supplier_id.slice(0, 8)}…` : undefined,
    assetType: selected?.asset_type,
    quantity: values.quantity || undefined,
    loanValueUsd,
    collateralType: values.collateral_type,
    collateralQuantity: values.collateral_quantity || undefined,
    collateralValueUsd: collateralValueNum,
    coverage,
    bookingLtv: values.booking_ltv_pct || undefined,
    impliedLtv,
    marginCallLtv: values.margin_call_ltv_pct || undefined,
    liquidationLtv: values.liquidation_ltv_pct || undefined,
    rateBps: values.rate_bps || undefined,
    termType: values.term_type,
    maturityDate: values.term_type === 'fixed' ? values.maturity_date : null,
    warning: warningActive,
  };

  // ── Client validation (SPEC §6.1) — runs before the confirm panel opens ─────
  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!values.borrower_id) errs.borrower_id = 'Select an approved borrower.';
    if (!isPos(values.quantity)) errs.quantity = 'Enter a positive quantity.';
    if (!isPos(values.asset_price_usd)) errs.asset_price_usd = 'Enter a positive price.';
    if (!isPos(values.collateral_value_usd)) errs.collateral_value_usd = 'Enter a positive value.';
    if (!isPos(values.booking_ltv_pct)) errs.booking_ltv_pct = 'Enter a positive LTV.';
    if (!isPos(values.margin_call_ltv_pct)) errs.margin_call_ltv_pct = 'Enter a positive LTV.';
    if (!isPos(values.liquidation_ltv_pct)) errs.liquidation_ltv_pct = 'Enter a positive LTV.';

    const rate = num(values.rate_bps);
    if (values.rate_bps.trim() === '' || !Number.isFinite(rate) || rate < 0 || !Number.isInteger(rate)) {
      errs.rate_bps = 'Enter rate in bps (integer ≥ 0).';
    }
    if (!isCash && !isPos(values.collateral_quantity)) {
      errs.collateral_quantity = 'Enter a positive collateral quantity.';
    }
    if (values.term_type === 'fixed' && !values.maturity_date) {
      errs.maturity_date = 'Maturity date is required for a fixed term.';
    }

    // Threshold ordering 0 < booking < margin_call < liquidation — anchor to the
    // first offending threshold.
    if (
      isPos(values.booking_ltv_pct) &&
      isPos(values.margin_call_ltv_pct) &&
      isPos(values.liquidation_ltv_pct)
    ) {
      const b = num(values.booking_ltv_pct);
      const m = num(values.margin_call_ltv_pct);
      const l = num(values.liquidation_ltv_pct);
      const ordered = 0 < b && b < m && m < l;
      if (!ordered) {
        const anchor: FieldKey = b >= m ? 'margin_call_ltv_pct' : 'liquidation_ltv_pct';
        errs[anchor] = 'Thresholds must increase: booking < margin call < liquidation.';
      }
    }
    return errs;
  }

  function handleReview() {
    if (!selected) return;
    setSuccess(null);
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setConfirming(true);
  }

  function handleCancelConfirm() {
    setConfirming(false);
    requestAnimationFrame(() => reviewButtonRef.current?.focus());
  }

  async function handleConfirmBooking() {
    if (!selected) return;
    setError(null);
    setFieldErrors({});
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
      requestAnimationFrame(() => successRef.current?.focus());
      await onBooked();
    } catch (err) {
      setConfirming(false);
      const code = (err as Error & { code?: string }).code;
      const message = err instanceof Error ? err.message : 'Failed to book loan.';
      if (code && CODE_TO_FIELD[code]) {
        const anchor = CODE_TO_FIELD[code];
        if (anchor === 'top') {
          setError(CODE_TO_MESSAGE[code]);
        } else {
          setFieldErrors({ [anchor]: CODE_TO_MESSAGE[code] });
        }
      } else {
        setError(message);
      }
    } finally {
      setIsBooking(false);
    }
  }

  // ── Loading / empty states ───────────────────────────────────────────────
  if (inventory.isLoading) {
    return <p className="text-sm text-gray-500">Loading booking inventory...</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
        No supplier inventory is available for booking.
      </div>
    );
  }

  const formDirty =
    values.quantity !== '' ||
    values.borrower_id !== '' ||
    values.collateral_value_usd !== '' ||
    values.rate_bps !== '';

  return (
    <section
      aria-labelledby="book-loan-heading"
      className="rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between px-5 py-3">
        <h2 id="book-loan-heading" className="text-sm font-semibold text-gray-900">
          Book loan
          {collapsed && formDirty && (
            <span className="ml-2 text-xs font-normal text-gray-400">· draft in progress</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-controls="book-loan-panel"
          className="text-sm font-medium text-blue-700 hover:text-blue-900"
        >
          {collapsed ? 'Expand to book ▸' : 'Collapse ▾'}
        </button>
      </div>

      <div id="book-loan-panel" className={collapsed ? 'hidden' : 'border-t border-gray-200 p-5'}>
        {success && (
          <p
            ref={successRef}
            tabIndex={-1}
            role="status"
            className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 outline-none"
          >
            {success}
          </p>
        )}
        {inventory.error && (
          <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {inventory.error}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {fieldErrors.top && (
          <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {fieldErrors.top}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Form column */}
          <div className={confirming ? 'space-y-4 opacity-60 pointer-events-none' : 'space-y-4'}>
            {/* Counterparty */}
            <FieldGroup title="Counterparty">
              <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
                <div>
                  <label
                    htmlFor="inventory-select"
                    className="block text-xs font-medium text-gray-600 mb-1"
                  >
                    Supplier inventory
                  </label>
                  <select
                    id="inventory-select"
                    value={selectedKey}
                    onChange={(e) => chooseInventory(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    {rows.map((row) => {
                      const key = `${row.connection_id}:${row.asset_type}`;
                      return (
                        <option key={key} value={key}>
                          {row.asset_type} · {row.effective_available} avail · {row.supplier_id.slice(0, 8)}…
                        </option>
                      );
                    })}
                  </select>
                  {selected && (
                    <p className="mt-1 text-xs text-gray-500 tabular-nums">
                      {selected.effective_available} {selected.asset_type} available
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="borrower-select"
                    className="block text-xs font-medium text-gray-600 mb-1"
                  >
                    Approved borrower
                  </label>
                  <select
                    id="borrower-select"
                    value={values.borrower_id}
                    onChange={(e) => setField('borrower_id', e.target.value)}
                    disabled={borrowersLoading}
                    aria-invalid={fieldErrors.borrower_id ? true : undefined}
                    aria-describedby={fieldErrors.borrower_id ? 'borrower-select-error' : undefined}
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    <option value="">{borrowersLoading ? 'Loading…' : 'Select borrower'}</option>
                    {borrowers.map((b) => (
                      <option key={b.borrower_id} value={b.borrower_id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.borrower_id && (
                    <p id="borrower-select-error" className="mt-1 text-xs text-red-600">
                      {fieldErrors.borrower_id}
                    </p>
                  )}
                  {borrowers.length === 0 && !borrowersLoading && (
                    <p className="mt-1 text-xs text-gray-500">
                      No approved borrower for this supplier. Onboard from{' '}
                      <Link
                        to="/dashboard/borrowers"
                        className="font-medium text-blue-700 hover:text-blue-900"
                      >
                        Borrowers
                      </Link>
                      .
                    </p>
                  )}
                </div>
              </div>
            </FieldGroup>

            {/* Secured loan — primary calc cluster */}
            <FieldGroup title="Secured loan" variant="primary" warning={warningActive}>
              <div className="grid gap-x-6 gap-y-4 lg:grid-cols-3">
                <CalcField
                  id="field-quantity"
                  label="Quantity"
                  value={values.quantity}
                  onChange={setQuantity}
                  unit={selected?.asset_type}
                  error={fieldErrors.quantity}
                  helper={
                    loanValueUsd !== undefined && selected
                      ? `${values.quantity} ${selected.asset_type} · ${formatUsd(loanValueUsd)}`
                      : '—'
                  }
                />
                <CalcField
                  id="field-asset-price"
                  label="Asset price USD"
                  value={values.asset_price_usd}
                  onChange={setAssetPrice}
                  error={fieldErrors.asset_price_usd}
                  helper={selected ? `per ${selected.asset_type}` : '—'}
                />
                <CalcField
                  id="field-booking-ltv"
                  label="Booking LTV %"
                  value={values.booking_ltv_pct}
                  onChange={setBookingLtv}
                  error={fieldErrors.booking_ltv_pct}
                  recomputed={recomputedField === 'booking_ltv_pct'}
                  helper={
                    impliedLtv !== undefined ? (
                      <span>
                        implied {impliedLtv.toFixed(2)}%
                        {isPos(values.booking_ltv_pct) &&
                          Math.abs(impliedLtv - num(values.booking_ltv_pct)) < 0.01 && (
                            <span className="text-green-700"> ✓</span>
                          )}
                      </span>
                    ) : (
                      '—'
                    )
                  }
                />
              </div>

              <div className="border-t border-gray-200" />

              <div className={`grid gap-x-6 gap-y-4 ${isCash ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
                {!isCash && (
                  <CalcField
                    id="field-collateral-quantity"
                    label="Collateral quantity"
                    value={values.collateral_quantity}
                    onChange={(v) => setField('collateral_quantity', v)}
                    unit={values.collateral_type}
                    error={fieldErrors.collateral_quantity}
                  />
                )}
                <CalcField
                  id="field-collateral-value"
                  label="Collateral value USD"
                  value={values.collateral_value_usd}
                  onChange={setCollateralValue}
                  error={fieldErrors.collateral_value_usd}
                  recomputed={recomputedField === 'collateral_value_usd'}
                  helper={
                    loanValueUsd !== undefined
                      ? `Loan value ${formatUsd(loanValueUsd)}${
                          isPos(values.booking_ltv_pct) ? ` · LTV ${values.booking_ltv_pct}%` : ''
                        }`
                      : isCash
                        ? 'quantity locked to USD value'
                        : '—'
                  }
                />
                <div>
                  <p className="block text-xs font-medium text-gray-600 mb-1">Coverage</p>
                  <p className="flex h-10 items-center text-sm text-gray-900 tabular-nums">
                    {coverage !== undefined ? (
                      <span>
                        {coverage.toFixed(2)}× · {(coverage * 100).toFixed(0)}% of loan value
                      </span>
                    ) : (
                      '—'
                    )}
                  </p>
                  {coverage !== undefined && (
                    <p className="mt-1 text-xs">
                      {coverage >= 1 ? (
                        <span className="text-green-700">secured ✓</span>
                      ) : (
                        <span className="text-amber-700">under-collateralized</span>
                      )}
                    </p>
                  )}
                  {isCash && (
                    <p className="mt-1 text-xs text-gray-500">quantity locked to USD value</p>
                  )}
                </div>
              </div>
            </FieldGroup>

            {warningActive && (
              <p
                role="status"
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                Loan terms differ from supplier guidance.
              </p>
            )}

            {/* Risk thresholds — secondary */}
            <FieldGroup title="Risk thresholds">
              <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
                <CalcField
                  id="field-margin-call-ltv"
                  label="Margin call LTV %"
                  value={values.margin_call_ltv_pct}
                  onChange={(v) => setField('margin_call_ltv_pct', v)}
                  error={fieldErrors.margin_call_ltv_pct}
                />
                <CalcField
                  id="field-liquidation-ltv"
                  label="Liquidation LTV %"
                  value={values.liquidation_ltv_pct}
                  onChange={(v) => setField('liquidation_ltv_pct', v)}
                  error={fieldErrors.liquidation_ltv_pct}
                />
              </div>
              <p className="text-xs text-gray-400">
                must increase: booking &lt; margin call &lt; liquidation
              </p>
            </FieldGroup>

            {/* Economics & collateral — secondary */}
            <FieldGroup title="Economics & collateral">
              <div className="grid gap-x-6 gap-y-4 lg:grid-cols-4">
                <CalcField
                  id="field-rate-bps"
                  label="Rate bps"
                  value={values.rate_bps}
                  onChange={(v) => setField('rate_bps', v)}
                  error={fieldErrors.rate_bps}
                />
                <div>
                  <label htmlFor="field-term" className="block text-xs font-medium text-gray-600 mb-1">
                    Term
                  </label>
                  <select
                    id="field-term"
                    value={values.term_type}
                    onChange={(e) => setField('term_type', e.target.value as TermType)}
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    <option value="open">Open</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
                {values.term_type === 'fixed' && (
                  <div>
                    <label
                      htmlFor="field-maturity"
                      className="block text-xs font-medium text-gray-600 mb-1"
                    >
                      Maturity date
                    </label>
                    <input
                      id="field-maturity"
                      type="date"
                      value={values.maturity_date}
                      onChange={(e) => setField('maturity_date', e.target.value)}
                      aria-invalid={fieldErrors.maturity_date ? true : undefined}
                      className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                    />
                    {fieldErrors.maturity_date && (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.maturity_date}</p>
                    )}
                  </div>
                )}
                <div>
                  <label
                    htmlFor="field-collateral-type"
                    className="block text-xs font-medium text-gray-600 mb-1"
                  >
                    Collateral type
                  </label>
                  <input
                    id="field-collateral-type"
                    value={values.collateral_type}
                    onChange={(e) => setCollateralType(e.target.value)}
                    aria-invalid={fieldErrors.collateral_type ? true : undefined}
                    aria-describedby={
                      fieldErrors.collateral_type ? 'field-collateral-type-error' : undefined
                    }
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  />
                  {fieldErrors.collateral_type && (
                    <p id="field-collateral-type-error" className="mt-1 text-xs text-red-600">
                      {fieldErrors.collateral_type}
                    </p>
                  )}
                </div>
              </div>
            </FieldGroup>

            {!confirming && (
              <div className="flex justify-end">
                <Button
                  ref={reviewButtonRef}
                  type="button"
                  onClick={handleReview}
                  disabled={isBooking || !values.borrower_id}
                >
                  Review booking →
                </Button>
              </div>
            )}
          </div>

          {/* Live preview / confirm rail */}
          <div className="lg:col-start-2 lg:row-start-1">
            <div className="lg:sticky lg:top-4 space-y-4">
              {confirming ? (
                <ConfirmBookingPanel
                  summary={summary}
                  isBooking={isBooking}
                  onCancel={handleCancelConfirm}
                  onConfirm={handleConfirmBooking}
                />
              ) : (
                <BookingSummary {...summary} />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
