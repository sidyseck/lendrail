import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { createBorrower, listApprovedBorrowers } from '@/api/borrowerApi';
import { bookLoan } from '@/api/loanApi';
import { useAuth } from '@/auth/AuthContext';
import { useAgentInventory } from '@/hooks/useAgentInventory';
import type { ApprovedBorrower } from '@/types/borrower';
import type { LoanBookingRequest } from '@/types/loan';

type TermType = 'open' | 'fixed';

interface FormValues {
  borrower_id: string;
  quantity: string;
  rate_bps: string;
  term_type: TermType;
  maturity_date: string;
  collateral_type: string;
  collateral_quantity: string;
  collateral_value_usd: string;
}

interface NewBorrowerValues {
  name: string;
  jurisdiction: string;
  contact_email: string;
}

const EMPTY_FORM: FormValues = {
  borrower_id: '',
  quantity: '',
  rate_bps: '',
  term_type: 'open',
  maturity_date: '',
  collateral_type: 'CASH_USD',
  collateral_quantity: '',
  collateral_value_usd: '',
};

const EMPTY_BORROWER: NewBorrowerValues = {
  name: '',
  jurisdiction: '',
  contact_email: '',
};

export function BookLoanPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inventory = useAgentInventory();

  const [selectedKey, setSelectedKey] = useState('');
  const [borrowers, setBorrowers] = useState<ApprovedBorrower[]>([]);
  const [borrowersLoading, setBorrowersLoading] = useState(false);
  const [borrowerError, setBorrowerError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [isCreatingBorrower, setIsCreatingBorrower] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [newBorrower, setNewBorrower] = useState<NewBorrowerValues>(EMPTY_BORROWER);

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

  useEffect(() => {
    if (!selected) {
      setBorrowers([]);
      return;
    }

    let cancelled = false;
    setBorrowersLoading(true);
    setBorrowerError(null);
    setValues((current) => ({ ...current, borrower_id: '' }));

    listApprovedBorrowers(selected.connection_id)
      .then((rows) => {
        if (!cancelled) setBorrowers(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBorrowerError(err instanceof Error ? err.message : 'Failed to load borrowers.');
        }
      })
      .finally(() => {
        if (!cancelled) setBorrowersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (role !== 'agent') return <Navigate to="/dashboard/loans" replace />;

  function chooseInventory(nextKey: string) {
    setSelectedKey(nextKey);
    const [connectionId, assetType] = nextKey.split(':');
    setSearchParams({ connection_id: connectionId, asset_type: assetType });
  }

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateBorrower<K extends keyof NewBorrowerValues>(
    key: K,
    value: NewBorrowerValues[K],
  ) {
    setNewBorrower((current) => ({ ...current, [key]: value }));
  }

  async function handleCreateBorrower(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setBorrowerError(null);
    setIsCreatingBorrower(true);
    try {
      const created = await createBorrower({
        ...newBorrower,
        connection_id: selected.connection_id,
      });
      const nextBorrower: ApprovedBorrower = {
        borrower_id: created.borrower_id,
        name: newBorrower.name,
        jurisdiction: newBorrower.jurisdiction,
        status: created.status,
        approved_at: new Date().toISOString(),
      };
      setBorrowers((current) => [...current, nextBorrower]);
      setValues((current) => ({ ...current, borrower_id: created.borrower_id }));
      setNewBorrower(EMPTY_BORROWER);
    } catch (err) {
      setBorrowerError(err instanceof Error ? err.message : 'Failed to create borrower.');
    } finally {
      setIsCreatingBorrower(false);
    }
  }

  async function handleBookLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setBookingError(null);
    setIsBooking(true);
    try {
      const payload: LoanBookingRequest = {
        connection_id: selected.connection_id,
        borrower_id: values.borrower_id,
        asset_type: selected.asset_type,
        quantity: values.quantity,
        rate_bps: Number(values.rate_bps),
        term_type: values.term_type,
        maturity_date: values.term_type === 'fixed' ? values.maturity_date : null,
        collateral_type: values.collateral_type,
        collateral_quantity: values.collateral_quantity,
        collateral_value_usd: values.collateral_value_usd,
      };
      const created = await bookLoan(payload);
      navigate(`/dashboard/loans/${created.loan_id}`);
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Failed to book loan.');
    } finally {
      setIsBooking(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Book Loan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create a borrower and book against supplier-published inventory.
          </p>
        </div>
        <Link to="/dashboard/available-inventory" className="text-sm text-gray-500 hover:text-gray-900">
          Available Inventory
        </Link>
      </div>

      {inventory.error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {inventory.error}
        </div>
      )}

      <section aria-labelledby="booking-context-heading" className="space-y-4">
        <h2 id="booking-context-heading" className="text-lg font-semibold text-gray-900">
          Inventory
        </h2>
        {inventory.isLoading && <p className="text-sm text-gray-500">Loading inventory...</p>}
        {!inventory.isLoading && rows.length === 0 && (
          <p className="text-sm text-gray-500">No available supplier inventory.</p>
        )}
        {rows.length > 0 && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <label className="space-y-1">
              <span className="text-sm font-medium text-gray-700">Supplier inventory</span>
              <select
                value={selectedKey}
                onChange={(event) => chooseInventory(event.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                {rows.map((row) => {
                  const key = `${row.connection_id}:${row.asset_type}`;
                  return (
                    <option key={key} value={key}>
                      {row.asset_type} from {row.supplier_id.slice(0, 8)}...
                    </option>
                  );
                })}
              </select>
            </label>
            <div>
              <p className="text-sm font-medium text-gray-700">Available</p>
              <p className="mt-2 font-mono text-sm text-gray-900">
                {selected?.effective_available ?? '-'} {selected?.asset_type ?? ''}
              </p>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="grid gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section aria-labelledby="borrower-heading" className="space-y-4">
            <h2 id="borrower-heading" className="text-lg font-semibold text-gray-900">
              Borrower
            </h2>

            {borrowerError && (
              <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {borrowerError}
              </div>
            )}

            <form onSubmit={handleCreateBorrower} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-gray-700">Name</span>
                <input
                  required
                  value={newBorrower.name}
                  onChange={(event) => updateBorrower('name', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-gray-700">Jurisdiction</span>
                <input
                  required
                  value={newBorrower.jurisdiction}
                  onChange={(event) => updateBorrower('jurisdiction', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-gray-700">Contact Email</span>
                <input
                  required
                  type="email"
                  value={newBorrower.contact_email}
                  onChange={(event) => updateBorrower('contact_email', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={isCreatingBorrower}
                className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isCreatingBorrower ? 'Creating...' : 'Create Borrower'}
              </button>
            </form>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-gray-700">Approved Borrower</span>
              <select
                required
                value={values.borrower_id}
                onChange={(event) => updateValue('borrower_id', event.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                disabled={borrowersLoading}
              >
                <option value="">{borrowersLoading ? 'Loading...' : 'Select borrower'}</option>
                {borrowers.map((borrower) => (
                  <option key={borrower.borrower_id} value={borrower.borrower_id}>
                    {borrower.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section aria-labelledby="loan-heading" className="space-y-4">
            <h2 id="loan-heading" className="text-lg font-semibold text-gray-900">
              Loan Terms
            </h2>

            {bookingError && (
              <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {bookingError}
              </div>
            )}

            <form onSubmit={handleBookLoan} className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-700">Quantity</span>
                <input
                  required
                  value={values.quantity}
                  onChange={(event) => updateValue('quantity', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-700">Rate BPS</span>
                <input
                  required
                  type="number"
                  min="0"
                  value={values.rate_bps}
                  onChange={(event) => updateValue('rate_bps', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-700">Term</span>
                <select
                  value={values.term_type}
                  onChange={(event) => updateValue('term_type', event.target.value as TermType)}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="open">Open</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              {values.term_type === 'fixed' && (
                <label className="space-y-1">
                  <span className="text-sm font-medium text-gray-700">Maturity Date</span>
                  <input
                    required
                    type="date"
                    value={values.maturity_date}
                    onChange={(event) => updateValue('maturity_date', event.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              )}
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-700">Collateral Type</span>
                <input
                  required
                  value={values.collateral_type}
                  onChange={(event) => updateValue('collateral_type', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-700">Collateral Quantity</span>
                <input
                  required
                  value={values.collateral_quantity}
                  onChange={(event) => updateValue('collateral_quantity', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-gray-700">Collateral Value USD</span>
                <input
                  required
                  value={values.collateral_value_usd}
                  onChange={(event) => updateValue('collateral_value_usd', event.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={isBooking || !values.borrower_id}
                  className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {isBooking ? 'Booking...' : 'Book Loan'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
