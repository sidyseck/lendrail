// src/hooks/useAgentInventory.ts — F-063
//
// Fetches inventory from all active connections (agent JWT view) and computes:
//   - aggregated: total effective_available per asset type across all connections
//   - breakdown: per-connection × per-asset rows for Section B

import { useCallback, useEffect, useState } from 'react';
import { useConnections } from '@/hooks/useConnections';
import { getConnectionInventoryAgent } from '@/api/inventoryApi';
import type { AggregatedAssetRow, SupplierBreakdownRow } from '@/types/inventory';

export interface UseAgentInventoryReturn {
  aggregated: AggregatedAssetRow[];
  breakdown: SupplierBreakdownRow[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAgentInventory(): UseAgentInventoryReturn {
  const {
    connections,
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch: refetchConnections,
  } = useConnections();

  const [aggregated, setAggregated] = useState<AggregatedAssetRow[]>([]);
  const [breakdown, setBreakdown] = useState<SupplierBreakdownRow[]>([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);

  const activeConns = connections.filter((c) => c.status === 'active');

  const fetchInventory = useCallback(async (connIds: { id: string; supplier_id: string; supplier_name: string }[]) => {
    if (connIds.length === 0) {
      setAggregated([]);
      setBreakdown([]);
      return;
    }

    setIsLoadingInventory(true);

    const results = await Promise.allSettled(
      connIds.map((c) => getConnectionInventoryAgent(c.id)),
    );

    const allBreakdownRows: SupplierBreakdownRow[] = [];

    connIds.forEach((conn, i) => {
      const result = results[i];
      if (result.status === 'fulfilled') {
        for (const entry of result.value.entries) {
          if (Number(entry.effective_available) > 0) {
            allBreakdownRows.push({
              connection_id: conn.id,
              supplier_id: conn.supplier_id,
              supplier_name: conn.supplier_name,
              asset_type: entry.asset_type,
              effective_available: entry.effective_available,
            });
          }
        }
      }
    });

    const totals: Record<string, number> = {};
    for (const row of allBreakdownRows) {
      totals[row.asset_type] = (totals[row.asset_type] ?? 0) + Number(row.effective_available);
    }

    const aggregatedRows: AggregatedAssetRow[] = Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([asset_type, total]) => ({ asset_type, total_available: String(total) }));

    setAggregated(aggregatedRows);
    setBreakdown(allBreakdownRows);
    setIsLoadingInventory(false);
  }, []);

  useEffect(() => {
    if (isLoadingConnections || connectionsError) return;
    void fetchInventory(activeConns.map((c) => ({ id: c.connection_id, supplier_id: c.supplier_id, supplier_name: c.supplier_name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingConnections, connectionsError, activeConns.map((c) => c.connection_id).join(',')]);

  const refetch = useCallback(async () => {
    await refetchConnections();
  }, [refetchConnections]);

  return {
    aggregated,
    breakdown,
    isLoading: isLoadingConnections || isLoadingInventory,
    error: connectionsError,
    refetch,
  };
}
