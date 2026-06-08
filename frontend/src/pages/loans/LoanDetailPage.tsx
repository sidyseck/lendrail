import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { getLoan, recallLoan, returnLoan, substituteCollateral } from '@/api/loanApi';
import { useAuth } from '@/auth/AuthContext';
import { LoanStateBadge } from '@/components/loans/LoanStateBadge';
import type { Loan } from '@/types/loan';

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="border-b border-gray-100 py-3">
      <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-gray-900">{value ?? '-'}</dd>
    </div>
  );
}

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
    return () => {
      cancelled = true;
    };
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
      <div className="mb-6">
        <Link to="/dashboard/loans" className="text-sm text-gray-500 hover:text-gray-900">
          Back to Loans
        </Link>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Loan Detail</h1>
            <p className="mt-1 font-mono text-xs text-gray-500">{loanId}</p>
          </div>
          {loan && <LoanStateBadge state={loan.state} />}
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading loan...</p>}
      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!isLoading && loan && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Field label="Borrower" value={loan.borrower_name} />
            <Field label="Connection ID" value={loan.connection_id} />
            <Field label="Agreement ID" value={loan.agreement_id} />
            <Field label="Asset" value={loan.asset_type} />
            <Field label="Quantity" value={loan.quantity} />
            <Field label="Rate BPS" value={loan.rate_bps} />
            <Field label="Term" value={loan.term_type} />
            <Field label="Maturity" value={loan.maturity_date} />
            <Field label="Day Count" value={loan.day_count_basis} />
            <Field label="Collateral Type" value={loan.collateral_type} />
            <Field label="Collateral Quantity" value={loan.collateral_quantity} />
            <Field label="Collateral Value USD" value={loan.collateral_value_usd} />
            <Field label="Current LTV" value={loan.current_ltv_pct ? `${Number(loan.current_ltv_pct).toFixed(2)}%` : null} />
            <Field label="LTV As Of" value={formatDateTime(loan.ltv_as_of)} />
            <Field label="Booked At" value={formatDateTime(loan.booked_at)} />
            <Field label="Activated At" value={formatDateTime(loan.activated_at)} />
            <Field label="Recall Started" value={formatDateTime(loan.recall_initiated_at)} />
            <Field label="Recall Deadline" value={formatDateTime(loan.recall_notice_deadline_at)} />
            <Field label="Return Custodian Ref" value={loan.return_custodian_ref} />
            <Field label="Return Instruction At" value={formatDateTime(loan.return_instruction_at)} />
            <Field label="Settled At" value={formatDateTime(loan.settled_at)} />
            <Field label="Defaulted At" value={formatDateTime(loan.defaulted_at)} />
          </dl>

          <aside className="space-y-4">
            {actionError && (
              <p role="alert" className="text-sm text-red-600">
                {actionError}
              </p>
            )}

            {role === 'supplier' && loan.state === 'active' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void runAction(() => recallLoan(currentLoanId))}
                className="w-full rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Recall
              </button>
            )}

            {role === 'agent' && loan.state === 'recall_initiated' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => void runAction(() => returnLoan(currentLoanId))}
                className="w-full rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                Return Assets
              </button>
            )}

            {role === 'agent' && (loan.state === 'active' || loan.state === 'margin_call') && (
              <form onSubmit={handleSubstitution} className="space-y-3 border-t border-gray-200 pt-4">
                <h2 className="text-sm font-semibold text-gray-900">Substitute Collateral</h2>
                <label className="block text-sm">
                  <span className="text-gray-600">Type</span>
                  <input
                    value={collateralType}
                    onChange={(event) => setCollateralType(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600">Quantity</span>
                  <input
                    value={collateralQuantity}
                    onChange={(event) => setCollateralQuantity(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                    inputMode="decimal"
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600">Value USD</span>
                  <input
                    value={collateralValue}
                    onChange={(event) => setCollateralValue(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                    inputMode="decimal"
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  Substitute Collateral
                </button>
              </form>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
