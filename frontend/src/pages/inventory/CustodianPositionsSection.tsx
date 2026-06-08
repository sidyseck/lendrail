// src/pages/inventory/CustodianPositionsSection.tsx
//
// F-062 Section A — shows raw custodian balances per asset, with staleness flag.

import type { CustodianWithInventory } from '@/hooks/useCustodianInventory';
import { Link } from 'react-router-dom';

const STALENESS_THRESHOLD_MS =
  Number(import.meta.env.VITE_FEED_STALENESS_THRESHOLD_SECONDS ?? 3600) * 1000;

function isStale(asOfIso: string): boolean {
  return Date.now() - new Date(asOfIso).getTime() > STALENESS_THRESHOLD_MS;
}

interface Props {
  items: CustodianWithInventory[];
  isLoading: boolean;
  error: string | null;
}

export function CustodianPositionsSection({ items, isLoading, error }: Props) {
  if (isLoading) {
    return (
      <p className="text-sm text-gray-500" aria-label="loading custodian positions">
        Loading custodian data…
      </p>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No custodians registered.{' '}
        <Link to="/dashboard/custodians" className="text-blue-600 underline">
          Register a custodian
        </Link>{' '}
        to get started.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 rounded border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Custodian</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Account ref</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">Asset</th>
            <th className="px-4 py-3 text-right font-medium text-gray-700">Total balance</th>
            <th className="px-4 py-3 text-left font-medium text-gray-700">As of</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(({ link, inventory, inventoryLoading, inventoryError }) => {
            if (inventoryLoading) {
              return (
                <tr key={link.custodian_link_id}>
                  <td colSpan={5} className="px-4 py-2 text-gray-400 italic">
                    {link.custodian_id} — loading…
                  </td>
                </tr>
              );
            }
            if (inventoryError || !inventory) {
              return (
                <tr key={link.custodian_link_id}>
                  <td colSpan={5} className="px-4 py-2 text-red-600">
                    {link.custodian_id}: {inventoryError ?? 'No data'}
                  </td>
                </tr>
              );
            }
            if (inventory.positions.length === 0) {
              return (
                <tr key={link.custodian_link_id}>
                  <td className="px-4 py-2">{link.custodian_id}</td>
                  <td className="px-4 py-2">{link.account_ref}</td>
                  <td colSpan={3} className="px-4 py-2 text-gray-400 italic">
                    No positions reported
                  </td>
                </tr>
              );
            }
            return inventory.positions.map((pos) => {
              const stale = isStale(pos.as_of);
              return (
                <tr key={`${link.custodian_link_id}-${pos.asset_type}`}>
                  <td className="px-4 py-2">{link.custodian_id}</td>
                  <td className="px-4 py-2 font-mono text-xs">{link.account_ref}</td>
                  <td className="px-4 py-2 font-semibold">{pos.asset_type}</td>
                  <td className="px-4 py-2 text-right font-mono">{pos.quantity}</td>
                  <td className="px-4 py-2">
                    <span className="text-xs text-gray-500">
                      {new Date(pos.as_of).toLocaleString()}
                    </span>
                    {stale && (
                      <span
                        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                        aria-label="stale feed"
                      >
                        Stale feed
                      </span>
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
