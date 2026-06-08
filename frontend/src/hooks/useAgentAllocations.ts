// src/hooks/useAgentAllocations.ts
//
// Fetches active/suspended connections and their supplier-role inventory data.
// Used by the F-062 supplier inventory management screen (Section B+C).

import { useCallback, useEffect, useState } from 'react';
import { useConnections } from './useConnections';
import { getConnectionInventorySupplier } from '@/api/inventoryApi';
import type { InventoryScopeSupplierResponse } from '@/types/connection';
import type { Connection } from '@/types/connection';

export interface ConnectionAllocation {
  connection: Connection;
  inventory: InventoryScopeSupplierResponse | null;
  inventoryError: string | null;
  inventoryLoading: boolean;
}

export interface UseAgentAllocationsReturn {
  allocations: ConnectionAllocation[];
  isLoading: boolean;
  error: string | null;
  refetchConnection: (connectionId: string) => Promise<void>;
  refetchAll: () => void;
}

export function useAgentAllocations(): UseAgentAllocationsReturn {
  const { connections, isLoading: connectionsLoading, error: connectionsError } = useConnections();
  const [allocations, setAllocations] = useState<ConnectionAllocation[]>([]);
  const [tick, setTick] = useState(0);

  const refetchAll = useCallback(() => setTick((t) => t + 1), []);

  const activeConnections = connections.filter(
    (c) => c.status === 'active' || c.status === 'suspended',
  );

  useEffect(() => {
    if (connectionsLoading || connectionsError) return;
    let cancelled = false;

    setAllocations(
      activeConnections.map((conn) => ({
        connection: conn,
        inventory: null,
        inventoryError: null,
        inventoryLoading: true,
      })),
    );

    async function fetchAll() {
      const results = await Promise.allSettled(
        activeConnections.map((conn) => getConnectionInventorySupplier(conn.connection_id)),
      );

      if (cancelled) return;

      setAllocations(
        activeConnections.map((conn, i) => {
          const result = results[i];
          return {
            connection: conn,
            inventory: result.status === 'fulfilled' ? result.value : null,
            inventoryError:
              result.status === 'rejected'
                ? (result.reason instanceof Error
                    ? result.reason.message
                    : 'Failed to load inventory')
                : null,
            inventoryLoading: false,
          };
        }),
      );
    }

    void fetchAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsLoading, connectionsError, tick, connections.map((c) => c.connection_id).join(',')]);

  const refetchConnection = useCallback(async (connectionId: string) => {
    setAllocations((prev) =>
      prev.map((a) =>
        a.connection.connection_id === connectionId
          ? { ...a, inventoryLoading: true, inventoryError: null }
          : a,
      ),
    );
    try {
      const inv = await getConnectionInventorySupplier(connectionId);
      setAllocations((prev) =>
        prev.map((a) =>
          a.connection.connection_id === connectionId
            ? { ...a, inventory: inv, inventoryLoading: false }
            : a,
        ),
      );
    } catch (err) {
      setAllocations((prev) =>
        prev.map((a) =>
          a.connection.connection_id === connectionId
            ? {
                ...a,
                inventoryError: err instanceof Error ? err.message : 'Failed to refresh.',
                inventoryLoading: false,
              }
            : a,
        ),
      );
    }
  }, []);

  return {
    allocations,
    isLoading: connectionsLoading,
    error: connectionsError,
    refetchConnection,
    refetchAll,
  };
}
