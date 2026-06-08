// src/hooks/useConnections.ts
//
// URL path convention:
//   apiClient has baseUrl = '<origin>/api' (or '/api' in Node test environment)
//   So apiClient.GET('/connections') sends to <origin>/api/connections.
//   MSW handlers must be registered as '/api/connections' (full path at network level)
//   because MSW intercepts before the Vite proxy strips the prefix.

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/auth/tokenStore';
import type { Connection } from '@/types/connection';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

export interface UseConnectionsReturn {
  connections: Connection[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useConnections(): UseConnectionsReturn {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE}/connections`, { headers });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? 'Failed to load connections.');
        return;
      }
      const data = (await response.json()) as { connections: Connection[] };
      setConnections(data.connections ?? []);
    } catch {
      setError('An unexpected error occurred while loading connections.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  return { connections, isLoading, error, refetch: fetchConnections };
}
