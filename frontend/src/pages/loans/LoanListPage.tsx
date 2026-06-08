import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listLoans } from '@/api/loanApi';
import { LoanStateBadge } from '@/components/loans/LoanStateBadge';
import type { Loan, LoanState } from '@/types/loan';

const FILTERS: Array<{ label: string; value: LoanState | '' }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Active', value: 'active' },
  { label: 'Recall', value: 'recall_initiated' },
  { label: 'Settled', value: 'settled' },
  { label: 'Defaulted', value: 'defaulted' },
];

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

export function LoanListPage() {
  const [filter, setFilter] = useState<LoanState | ''>('');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listLoans(filter || undefined)
      .then((rows) => {
        if (!cancelled) setLoans(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load loans.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Loans</h1>
          <p className="mt-1 text-sm text-gray-500">Lifecycle status across connected lending programs.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Loan state filter">
          {FILTERS.map((item) => (
            <button
              key={item.value || 'all'}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded border px-3 py-1.5 text-sm ${
                filter === item.value
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading loans...</p>}
      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!isLoading && !error && loans.length === 0 && (
        <p className="text-sm text-gray-500">No loans match the selected state.</p>
      )}

      {!isLoading && !error && loans.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Borrower</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Quantity</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">LTV</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">State</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Booked</th>
                <th className="py-2 text-left font-medium text-gray-600">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.loan_id} className="border-b border-gray-100">
                  <td className="py-3 pr-4 text-gray-900">{loan.borrower_name}</td>
                  <td className="py-3 pr-4 text-gray-700">{loan.asset_type}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-gray-700">{loan.quantity}</td>
                  <td className="py-3 pr-4 text-gray-700">
                    {loan.current_ltv_pct ? `${Number(loan.current_ltv_pct).toFixed(2)}%` : '-'}
                  </td>
                  <td className="py-3 pr-4">
                    <LoanStateBadge state={loan.state} />
                  </td>
                  <td className="py-3 pr-4 text-gray-600">{formatDate(loan.booked_at)}</td>
                  <td className="py-3">
                    <Link
                      to={`/dashboard/loans/${loan.loan_id}`}
                      className="text-sm font-medium text-blue-700 hover:text-blue-900"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
