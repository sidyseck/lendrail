import type { LoanState } from '@/types/loan';

const STATE_CONFIG: Record<LoanState, { dot: string; label: string; text: string }> = {
  pending:          { dot: 'bg-amber-400',  label: 'Pending',      text: 'text-amber-700'  },
  active:           { dot: 'bg-green-500',  label: 'Active',       text: 'text-green-700'  },
  margin_call:      { dot: 'bg-red-500',    label: 'Margin Call',  text: 'text-red-700'    },
  recall_initiated: { dot: 'bg-blue-500',   label: 'Recall',       text: 'text-blue-700'   },
  settled:          { dot: 'bg-gray-400',   label: 'Settled',      text: 'text-gray-500'   },
  defaulted:        { dot: 'bg-gray-800',   label: 'Defaulted',    text: 'text-gray-700'   },
};

export function LoanStateBadge({ state }: { state: LoanState }) {
  const cfg = STATE_CONFIG[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}>
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
