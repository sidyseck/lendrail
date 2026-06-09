import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { getLoan, recallLoan, returnLoan, substituteCollateral } from '@/api/loanApi';
import { useAuth } from '@/auth/AuthContext';
import { LoanStateBadge } from '@/components/loans/LoanStateBadge';
import type { Loan } from '@/types/loan';

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{children}</span>
      <div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | number | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gray-50 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-900 ${mono ? 'truncate font-mono text-xs' : ''}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-300';

export function LoanDetailPage() {
  const { loanId } = useParams<{ loanId: string }>();
  const { role } = useAuth();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collateralType, setCollateralType] = useState('');
  const [collateralQuantity, setCollateralQuantity] = useState('');
  const [collateralValue, setCollateralValue] = useState('');

  useEffect(() => {
    if (!loanId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getLoan(loanId)
      .then((row) => {
        if (!cancelled) {
          setLoan(row);
          setCollateralType(row.collateral_type);
          setCollateralQuantity(row.collateral_quantity);
          setCollateralValue(row.collateral_value_usd);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load loan.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [loanId]);

  if (!loanId) return <Navigate to="/dashboard/loans" replace />;
  const currentLoanId = loanId;

  async function runAction(action: () => Promise<Loan>) {
    setActionLoading(true);
    setActionError(null);
    try {
      const next = await action();
      setLoan(next);
      setCollateralType(next.collateral_type);
      setCollateralQuantity(next.collateral_quantity);
      setCollateralValue(next.collateral_value_usd);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setActionLoading(false);
    }
  }

  function handleSubstitution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAction(() =>
      substituteCollateral(currentLoanId, {
        collateral_type: collateralType,
        collateral_quantity: collateralQuantity,
        collateral_value_usd: collateralValue,
      }),
    );
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link to="/dashboard/loans" className="text-xs text-gray-400 hover:text-gray-600">
          ← Loans
        </Link>

        {isLoading && (
          <div className="mt-3 h-8 w-48 animate-pulse rounded bg-gray-100" />
        )}

        {!isLoading && loan && (
          <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-gray-900">{loan.borrower_name}</h1>
                <LoanStateBadge state={loan.state} />
              </div>
              <p className="mt-1 text-sm text-gray-500">
                <span className="font-medium tabular-nums">{Number(loan.quantity).toLocaleString('en-US')} {loan.asset_type}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>{loan.rate_bps} bps ({(loan.rate_bps / 100).toFixed(2)}% p.a.)</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span className="capitalize">{loan.term_type} term</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!isLoading && loan && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">

          {/* ── Main fields ─────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Terms */}
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
              <SectionLabel>Loan Terms</SectionLabel>
              <dl>
                <Row label="Borrower" value={loan.borrower_name} />
                <Row label="Asset" value={loan.asset_type} />
                <Row label="Quantity" value={Number(loan.quantity).toLocaleString('en-US')} />
                <Row label="Rate" value={`${loan.rate_bps} bps (${(loan.rate_bps / 100).toFixed(2)}% p.a.)`} />
                <Row label="Term type" value={loan.term_type} />
                {loan.maturity_date && <Row label="Maturity date" value={fmtDate(loan.maturity_date)} />}
                <Row label="Day count basis" value={loan.day_count_basis} />
              </dl>
            </div>

            {/* LTV & Collateral */}
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
              <SectionLabel>LTV &amp; Collateral</SectionLabel>
              <dl>
                <Row
                  label="Current LTV"
                  value={loan.current_ltv_pct ? `${Number(loan.current_ltv_pct).toFixed(2)}%` : null}
                />
                <Row label="LTV as of" value={fmtDateTime(loan.ltv_as_of)} />
                <Row label="Collateral type" value={loan.collateral_type} />
                <Row
                  label="Collateral quantity"
                  value={Number(loan.collateral_quantity).toLocaleString('en-US')}
                />
                <Row
                  label="Collateral value"
                  value={`$${Number(loan.collateral_value_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                />
              </dl>
            </div>

            {/* Timeline */}
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
              <SectionLabel>Timeline</SectionLabel>
              <dl>
                <Row label="Booked" value={fmtDateTime(loan.booked_at)} />
                <Row label="Activated" value={fmtDateTime(loan.activated_at)} />
                <Row label="Recall started" value={fmtDateTime(loan.recall_initiated_at)} />
                <Row label="Recall deadline" value={fmtDateTime(loan.recall_notice_deadline_at)} />
                <Row label="Return instruction" value={fmtDateTime(loan.return_instruction_at)} />
                <Row label="Return custodian ref" value={loan.return_custodian_ref} />
                <Row label="Settled" value={fmtDateTime(loan.settled_at)} />
                <Row label="Defaulted" value={fmtDateTime(loan.defaulted_at)} />
              </dl>
            </div>

            {/* Reference IDs */}
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
              <SectionLabel>Reference IDs</SectionLabel>
              <dl>
                <Row label="Loan ID" value={loan.loan_id} mono />
                <Row label="Connection ID" value={loan.connection_id} mono />
                <Row label="Agreement ID" value={loan.agreement_id} mono />
              </dl>
            </div>
          </div>

          {/* ── Actions sidebar ──────────────────────────────────────── */}
          <aside className="space-y-4">
            {actionError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </p>
            )}

            {role === 'supplier' && loan.state === 'active' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void runAction(() => recallLoan(currentLoanId))}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Recall Loan
              </button>
            )}

            {role === 'agent' && loan.state === 'recall_initiated' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void runAction(() => returnLoan(currentLoanId))}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Return Assets
              </button>
            )}

            {role === 'agent' && (loan.state === 'active' || loan.state === 'margin_call') && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Substitute Collateral
                </p>
                <form onSubmit={handleSubstitution} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
                    <input
                      value={collateralType}
                      onChange={(e) => setCollateralType(e.target.value)}
                      className={inputCls}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Quantity</label>
                    <input
                      value={collateralQuantity}
                      onChange={(e) => setCollateralQuantity(e.target.value)}
                      inputMode="decimal"
                      className={inputCls}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Value (USD)</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">$</span>
                      <input
                        value={collateralValue}
                        onChange={(e) => setCollateralValue(e.target.value)}
                        inputMode="decimal"
                        className={`${inputCls} pl-7`}
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    Substitute Collateral
                  </button>
                </form>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
