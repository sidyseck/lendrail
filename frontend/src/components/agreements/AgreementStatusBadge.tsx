// src/components/agreements/AgreementStatusBadge.tsx

import type { AgreementStatus } from '@/types/agreement';

const STATUS_STYLES: Record<AgreementStatus, string> = {
  pending_confirmation: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
};

const STATUS_LABELS: Record<AgreementStatus, string> = {
  pending_confirmation: 'Pending Confirmation',
  active: 'Active',
};

interface AgreementStatusBadgeProps {
  status: AgreementStatus;
}

export function AgreementStatusBadge({ status }: AgreementStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
