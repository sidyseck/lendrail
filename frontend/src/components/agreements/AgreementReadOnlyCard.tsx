// src/components/agreements/AgreementReadOnlyCard.tsx

import type { Agreement } from '@/types/agreement';
import { AgreementStatusBadge } from './AgreementStatusBadge';

interface AgreementReadOnlyCardProps {
  agreement: Agreement;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString();
}

export function AgreementReadOnlyCard({ agreement }: AgreementReadOnlyCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          Agreement v{agreement.version}
        </h2>
        <AgreementStatusBadge status={agreement.status} />
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium text-gray-600">Assets in Scope</dt>
          <dd className="text-gray-900">{agreement.assets_in_scope.join(', ')}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Eligible Collateral</dt>
          <dd className="text-gray-900">{agreement.eligible_collateral.join(', ')}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Initial LTV %</dt>
          <dd className="text-gray-900">{agreement.initial_ltv_pct}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Margin Call LTV %</dt>
          <dd className="text-gray-900">{agreement.margin_call_ltv_pct}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Recall Notice (days)</dt>
          <dd className="text-gray-900">{agreement.recall_notice_days}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Max Loan Days</dt>
          <dd className="text-gray-900">{agreement.max_loan_days}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Day Count Basis</dt>
          <dd className="text-gray-900">
            {agreement.day_count_basis === 'actual_360' ? 'Actual/360' : 'Actual/365'}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Agent Fee (bps)</dt>
          <dd className="text-gray-900">{agreement.agent_fee_bps}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Supplier Confirmed At</dt>
          <dd className="text-gray-900">
            {formatTimestamp(agreement.confirmed_by_supplier_at)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Agent Confirmed At</dt>
          <dd className="text-gray-900">
            {formatTimestamp(agreement.confirmed_by_agent_at)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-gray-600">Created At</dt>
          <dd className="text-gray-900">{new Date(agreement.created_at).toLocaleDateString()}</dd>
        </div>
      </dl>
    </div>
  );
}
