// src/pages/inventory/SupplierBreakdownSection.tsx — F-063 Section B
//
// Per-connection × per-asset breakdown. Rows highlighted by notification events
// show an "Updated X min ago" chip and a subtle yellow background.

import type { SupplierBreakdownRow } from '@/types/inventory';
import { Link } from 'react-router-dom';

interface Props {
  breakdown: SupplierBreakdownRow[];
  isLoading: boolean;
  highlightedConnections: Record<string, string>;
}

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin === 1) return '1 min ago';
  return `${diffMin} min ago`;
}

export function SupplierBreakdownSection({ breakdown, isLoading, highlightedConnections }: Props) {
  return (
    <section aria-labelledby="supplier-breakdown-heading">
      <h2
        id="supplier-breakdown-heading"
        className="mb-4 text-lg font-semibold text-gray-900"
      >
        Breakdown by supplier
      </h2>

      {isLoading && (
        <p className="text-sm text-gray-500" aria-label="loading breakdown">
          Loading…
        </p>
      )}

      {!isLoading && breakdown.length === 0 && (
        <p className="text-sm text-gray-500">No available inventory from suppliers.</p>
      )}

      {!isLoading && breakdown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Supplier</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset type</th>
                <th className="py-2 text-left font-medium text-gray-600">Available</th>
                <th className="py-2 text-right font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => {
                const highlightAt = highlightedConnections[row.connection_id];
                return (
                  <tr
                    key={`${row.connection_id}-${row.asset_type}`}
                    className={`border-b border-gray-100 ${highlightAt ? 'bg-yellow-50' : ''}`}
                    data-testid={`breakdown-row-${row.connection_id}-${row.asset_type}`}
                  >
                    <td className="py-3 pr-4 text-sm text-gray-700">
                      {row.supplier_name}
                    </td>
                    <td className="py-3 pr-4 font-semibold text-gray-700">{row.asset_type}</td>
                    <td className="py-3 text-gray-700">
                      <span className="font-mono text-sm">{row.effective_available}</span>
                      {highlightAt && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                          Updated {relativeTime(highlightAt)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        to={`/dashboard/loans?connection_id=${encodeURIComponent(row.connection_id)}&asset_type=${encodeURIComponent(row.asset_type)}`}
                        className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        Book Loan
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
