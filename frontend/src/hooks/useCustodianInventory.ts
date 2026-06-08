// src/hooks/useCustodianInventory.ts
//
// Fetches all custodian links for the calling org, then in parallel fetches
// inventory positions for each link from GET /custodians/{id}/inventory.

import { useCallback, useEffect, useState } from 'react';
import { listCustodians } from '@/api/custodiansApi';
import { getCustodianInventory } from '@/api/inventoryApi';
import type { CustodianLink } from '@/api/custodiansApi';
import type { CustodianInventoryResponse } from '@/api/inventoryApi';

export interface CustodianWithInventory {
  link: CustodianLink;
  inventory: CustodianInventoryResponse | null;
  inventoryError: string | null;
  inventoryLoading: boolean;
}

export interface UseCustodianInventoryReturn {
  items: CustodianWithInventory[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCustodianInventory(): UseCustodianInventoryReturn {
  const [items, setItems] = useState<CustodianWithInventory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const links = await listCustodians();
        if (cancelled) return;

        // Seed with loading state for each link
        setItems(
          links.map((link) => ({
            link,
            inventory: null,
            inventoryError: null,
            inventoryLoading: true,
          })),
        );

        // Fetch inventory for all links in parallel
        const results = await Promise.allSettled(
          links.map((link) => getCustodianInventory(link.custodian_link_id)),
        );

        if (cancelled) return;

        setItems(
          links.map((link, i) => {
            const result = results[i];
            return {
              link,
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
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load custodians.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { items, isLoading, error, refetch };
}
