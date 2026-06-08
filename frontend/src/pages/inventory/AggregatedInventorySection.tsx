// src/pages/inventory/AggregatedInventorySection.tsx — F-063 Section A
//
// Shows total effective_available per asset type, summed across all active connections.
// "On loan" column omitted (per OD-1): the agent JWT response does not include already_booked.

import type { AggregatedAssetRow } from '@/types/inventory';

interface Props {
  aggregated: AggregatedAssetRow[];
  isLoading: boolean;
  error: string | null;
}

export function AggregatedInventorySection({ aggregated, isLoading, error }: Props) {
  return (
    <section aria-labelledby="aggregated-inventory-heading">
      <h2
        id="aggregated-inventory-heading"
        className="mb-4 text-lg font-semibold text-gray-900"
      >
        Totals
      </h2>

      {isLoading && (
        <p className="text-sm text-gray-500" aria-label="loading inventory">
          Loading…
        </p>
      )}

      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!isLoading && !error && aggregated.length === 0 && (
        <p className="text-sm text-gray-500">
          No inventory available. Check that your supplier connections are active.
        </p>
      )}

      {!isLoading && !error && aggregated.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset type</th>
                <th className="py-2 text-left font-medium text-gray-600">Total available</th>
              </tr>
            </thead>
            <tbody>
              {aggregated.map((row) => (
                <tr key={row.asset_type} className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-semibold text-gray-700">{row.asset_type}</td>
                  <td className="py-3 font-mono text-sm text-gray-700">{row.total_available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
