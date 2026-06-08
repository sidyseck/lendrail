// src/components/agreements/AgreementHistoryTable.tsx

import { Fragment, useState } from 'react';
import type { Agreement } from '@/types/agreement';
import { AgreementStatusBadge } from './AgreementStatusBadge';
import { AgreementReadOnlyCard } from './AgreementReadOnlyCard';

interface AgreementHistoryTableProps {
  agreements: Agreement[];
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString();
}

export function AgreementHistoryTable({ agreements }: AgreementHistoryTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (agreements.length === 0) {
    return <p className="text-sm text-gray-500">No agreement versions yet.</p>;
  }

  const orderedAgreements = [...agreements].sort((a, b) => a.version - b.version);
  const maxVersion = Math.max(...orderedAgreements.map((a) => a.version));

  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-2 pr-4 text-left font-medium text-gray-600">Version</th>
            <th className="py-2 pr-4 text-left font-medium text-gray-600">Status</th>
            <th className="py-2 pr-4 text-left font-medium text-gray-600">Supplier Confirmed</th>
            <th className="py-2 pr-4 text-left font-medium text-gray-600">Agent Confirmed</th>
            <th className="py-2 pr-4 text-left font-medium text-gray-600">Created</th>
            <th className="py-2 text-left font-medium text-gray-600">Details</th>
          </tr>
        </thead>
        <tbody>
          {orderedAgreements.map((agreement) => {
            const isCurrent = agreement.version === maxVersion;
            return (
              <Fragment key={agreement.agreement_id}>
                <tr
                  className={`border-b border-gray-100 ${isCurrent ? 'bg-blue-50' : ''}`}
                >
                  <td className={`py-3 pr-4 ${isCurrent ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                    v{agreement.version}
                    {isCurrent && (
                      <span className="ml-1 text-xs text-blue-600">(current)</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <AgreementStatusBadge status={agreement.status} />
                  </td>
                  <td className="py-3 pr-4 text-gray-600">
                    {formatTimestamp(agreement.confirmed_by_supplier_at)}
                  </td>
                  <td className="py-3 pr-4 text-gray-600">
                    {formatTimestamp(agreement.confirmed_by_agent_at)}
                  </td>
                  <td className="py-3 pr-4 text-gray-600">
                    {new Date(agreement.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <button
                      onClick={() =>
                        setExpandedId(
                          expandedId === agreement.agreement_id ? null : agreement.agreement_id,
                        )
                      }
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {expandedId === agreement.agreement_id ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
                {expandedId === agreement.agreement_id && (
                  <tr className="border-b border-gray-100">
                    <td colSpan={6} className="py-4 px-2">
                      <AgreementReadOnlyCard agreement={agreement} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
