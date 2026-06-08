// src/components/StatusBadge.tsx

import type { ConnectionStatus } from '@/types/connection';

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  pending:    'bg-yellow-100 text-yellow-800',
  accepted:   'bg-blue-100 text-blue-800',
  active:     'bg-green-100 text-green-800',
  suspended:  'bg-orange-100 text-orange-800',
  terminated: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
