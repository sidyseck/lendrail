import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listLoans } from '@/api/loanApi';
import { useAuth } from '@/auth/AuthContext';
import { BookLoanStrip } from '@/components/loans/BookLoanStrip';
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
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LoanListPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<LoanState | ''>('');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLoans = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const rows = await listLoans(filter || undefined);
      setLoans(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loans.');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadLoans();
  }, [loadLoans]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Loans</h1>
          <p className="mt-1 text-sm text-gray-500">Lifecycle status across connected lending programs.</p>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by state">
          {FILTERS.map((item) => (
            <button
              key={item.value || 'all'}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === item.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {role === 'agent' && <BookLoanStrip onBooked={loadLoans} />}

      {isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!isLoading && !error && loans.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">No loans match the selected state.</p>
      )}

      {!isLoading && !error && loans.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Borrower</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Asset</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Quantity</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Rate</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">LTV</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">State</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Booked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loans.map((loan) => (
                <tr
                  key={loan.loan_id}
                  onClick={() => void navigate(`/dashboard/loans/${loan.loan_id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{loan.borrower_name}</td>
                  <td className="px-4 py-3 text-gray-700">{loan.asset_type}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {Number(loan.quantity).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                    {loan.rate_bps} bps
                    <span className="ml-1 text-gray-400 text-xs">({(loan.rate_bps / 100).toFixed(2)}%)</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {loan.current_ltv_pct ? `${Number(loan.current_ltv_pct).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <LoanStateBadge state={loan.state} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(loan.booked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
