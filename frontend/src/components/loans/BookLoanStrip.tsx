import { FormEvent, useEffect, useMemo, useState } from 'react';
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

  const rows = inventory.breakdown;
  const selected = useMemo(
    () => rows.find((row) => `${row.connection_id}:${row.asset_type}` === selectedKey) ?? null,
    [rows, selectedKey],
  );

  useEffect(() => {
    const connectionId = searchParams.get('connection_id');
    const assetType = searchParams.get('asset_type');
    if (connectionId && assetType) {
      setSelectedKey(`${connectionId}:${assetType}`);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selected && rows.length > 0 && !searchParams.get('connection_id')) {
      const first = rows[0];
      setSelectedKey(`${first.connection_id}:${first.asset_type}`);
    }
  }, [rows, searchParams, selected]);

  // Pre-populate asset price when selection or live prices change
  useEffect(() => {
    if (!selected) return;
    const p = prices[selected.asset_type];
    if (p !== undefined) {
      setValues((current) => ({ ...current, asset_price_usd: p.toFixed(2) }));
    }
  }, [selected?.asset_type, prices]);

  useEffect(() => {
    if (!selected) {
      setBorrowers([]);
      return;
    }

    let cancelled = false;
    setBorrowersLoading(true);
    setError(null);
    setValues((current) => ({ ...current, borrower_id: '' }));

    listApprovedBorrowers(selected.connection_id)
      .then((rows) => {
        if (!cancelled) setBorrowers(rows);
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

  function chooseInventory(nextKey: string) {
    setSelectedKey(nextKey);
    const [connectionId, assetType] = nextKey.split(':');
    setSearchParams({ connection_id: connectionId, asset_type: assetType });
  }

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setError(null);
    setSuccess(null);
    setIsBooking(true);
    try {
      const payload: LoanBookingRequest = {
        connection_id: selected.connection_id,
        borrower_id: values.borrower_id,
        asset_type: selected.asset_type,
        quantity: values.quantity,
        asset_price_usd: values.asset_price_usd,
        booking_ltv_pct: values.booking_ltv_pct,
        margin_call_ltv_pct: values.margin_call_ltv_pct,
        liquidation_ltv_pct: values.liquidation_ltv_pct,
        rate_bps: Number(values.rate_bps),
        term_type: values.term_type,
        maturity_date: values.term_type === 'fixed' ? values.maturity_date : null,
        collateral_type: values.collateral_type,
        collateral_quantity: values.collateral_quantity,
        collateral_value_usd: values.collateral_value_usd,
      };
      await bookLoan(payload);
      setValues(EMPTY_FORM);
      setSuccess('Loan booked.');
      await onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book loan.');
    } finally {
      setIsBooking(false);
    }
  }

  if (inventory.isLoading) {
    return <p className="mb-6 text-sm text-gray-500">Loading booking inventory...</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="mb-6 rounded border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
        No supplier inventory is available for booking.
      </div>
    );
  }

  return (
    <section aria-labelledby="book-loan-heading" className="mb-6 border-b border-gray-200 pb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="book-loan-heading" className="text-sm font-semibold text-gray-900">
          Book Loan
        </h2>
        <Link to="/dashboard/borrowers" className="text-xs font-medium text-blue-700 hover:text-blue-900">
          Manage borrowers
        </Link>
      </div>

      {inventory.error && <p role="alert" className="mb-3 text-sm text-red-600">{inventory.error}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mb-3 text-sm text-green-700">{success}</p>}

      <form onSubmit={handleSubmit} className="grid gap-3 lg:grid-cols-12">
        {/* Row 1: Inventory, Borrower, Quantity, Price, LTV group */}
        <label className="lg:col-span-2">
          <span className="sr-only">Supplier inventory</span>
          <select
            value={selectedKey}
            onChange={(event) => chooseInventory(event.target.value)}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {rows.map((row) => {
              const key = `${row.connection_id}:${row.asset_type}`;
              return (
                <option key={key} value={key}>
                  {row.asset_type} {row.effective_available} from {row.supplier_id.slice(0, 8)}...
                </option>
              );
            })}
          </select>
        </label>

        <label className="lg:col-span-2">
          <span className="sr-only">Approved Borrower</span>
          <select
            required
            value={values.borrower_id}
            onChange={(event) => updateValue('borrower_id', event.target.value)}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
            disabled={borrowersLoading}
          >
            <option value="">{borrowersLoading ? 'Loading...' : 'Borrower'}</option>
            {borrowers.map((borrower) => (
              <option key={borrower.borrower_id} value={borrower.borrower_id}>
                {borrower.name}
              </option>
            ))}
          </select>
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Quantity</span>
          <input
            required
            aria-label="Quantity"
            placeholder="Qty"
            value={values.quantity}
            onChange={(event) => updateValue('quantity', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        {/* Price / LTV / Collateral calculation group */}
        <label className="lg:col-span-2">
          <span className="sr-only">Asset Price USD</span>
          <input
            required
            aria-label="Asset Price USD"
            placeholder="Price USD"
            value={values.asset_price_usd}
            onChange={(event) => updateValue('asset_price_usd', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Booking LTV %</span>
          <input
            required
            aria-label="Booking LTV %"
            placeholder="LTV %"
            value={values.booking_ltv_pct}
            onChange={(event) => updateValue('booking_ltv_pct', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Margin Call LTV %</span>
          <input
            required
            aria-label="Margin Call LTV %"
            placeholder="MC %"
            value={values.margin_call_ltv_pct}
            onChange={(event) => updateValue('margin_call_ltv_pct', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Liquidation LTV %</span>
          <input
            required
            aria-label="Liquidation LTV %"
            placeholder="Liq %"
            value={values.liquidation_ltv_pct}
            onChange={(event) => updateValue('liquidation_ltv_pct', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        {/* Row 2: Rate, Term, Maturity, Collateral */}
        <label className="lg:col-span-1">
          <span className="sr-only">Rate BPS</span>
          <input
            required
            aria-label="Rate BPS"
            type="number"
            min="0"
            placeholder="BPS"
            value={values.rate_bps}
            onChange={(event) => updateValue('rate_bps', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Term</span>
          <select
            aria-label="Term"
            value={values.term_type}
            onChange={(event) => updateValue('term_type', event.target.value as TermType)}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="open">Open</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>

        {values.term_type === 'fixed' && (
          <label className="lg:col-span-2">
            <span className="sr-only">Maturity Date</span>
            <input
              required
              aria-label="Maturity Date"
              type="date"
              value={values.maturity_date}
              onChange={(event) => updateValue('maturity_date', event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        )}

        <label className="lg:col-span-1">
          <span className="sr-only">Collateral Type</span>
          <input
            required
            aria-label="Collateral Type"
            value={values.collateral_type}
            onChange={(event) => updateValue('collateral_type', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Collateral Quantity</span>
          <input
            required
            aria-label="Collateral Quantity"
            placeholder="Coll qty"
            value={values.collateral_quantity}
            onChange={(event) => updateValue('collateral_quantity', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="lg:col-span-1">
          <span className="sr-only">Collateral Value USD</span>
          <input
            required
            aria-label="Collateral Value USD"
            placeholder="Coll USD"
            value={values.collateral_value_usd}
            onChange={(event) => updateValue('collateral_value_usd', event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={isBooking || !values.borrower_id}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 lg:col-span-1"
        >
          {isBooking ? 'Booking...' : 'Book'}
        </button>
      </form>

      {borrowers.length === 0 && !borrowersLoading && (
        <p className="mt-2 text-xs text-gray-500">
          No approved borrower for this supplier. Onboard and link borrowers from{' '}
          <Link to="/dashboard/borrowers" className="font-medium text-blue-700 hover:text-blue-900">
            Borrowers
          </Link>
          .
        </p>
      )}
    </section>
  );
}
