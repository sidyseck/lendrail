import type { LoanState } from '@/types/loan';

const STATE_STYLES: Record<LoanState, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  margin_call: 'bg-red-100 text-red-800',
  recall_initiated: 'bg-blue-100 text-blue-800',
  settled: 'bg-gray-100 text-gray-700',
  defaulted: 'bg-black text-white',
};

export function LoanStateBadge({ state }: { state: LoanState }) {
  return (
    <span
      className={`inline-flex min-w-24 items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}
    >
      {state.replace('_', ' ')}
    </span>
  );
}
