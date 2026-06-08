// src/hooks/useInventoryScope.ts

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/auth/tokenStore';
import type {
  InventoryScopeAgentResponse,
  InventoryScopeSupplierResponse,
} from '@/types/connection';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

type InventoryScopeResult =
  | InventoryScopeSupplierResponse
  | InventoryScopeAgentResponse
  | null;

function authHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export interface UseInventoryScopeReturn {
  data: InventoryScopeResult;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useInventoryScope(connectionId: string): UseInventoryScopeReturn {
  const [data, setData] = useState<InventoryScopeResult>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(async () => {
    if (!connectionId) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/connections/${connectionId}/inventory`,
        { headers: authHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? 'Failed to load inventory scope.');
        return;
      }

      const body = (await response.json()) as InventoryScopeResult;
      setData(body);
    } catch {
      setError('An unexpected error occurred while loading inventory scope.');
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void fetchInventory();
  }, [fetchInventory]);

  return { data, isLoading, error, refetch: fetchInventory };
}
