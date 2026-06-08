// src/pages/connections/AgentConnectionsPage.tsx
//
// URL convention: fetch calls use API_BASE + path (no /api duplication in path).
// MSW intercepts '/api/connections/...' at network level.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '@/auth/tokenStore';
import { useConnections } from '@/hooks/useConnections';
import { useConnectionAction } from '@/hooks/useConnectionAction';
import { useInventoryScope } from '@/hooks/useInventoryScope';
import { StatusBadge } from '@/components/StatusBadge';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

interface EffectiveAvailableRowProps {
  connectionId: string;
}

function EffectiveAvailableRow({ connectionId }: EffectiveAvailableRowProps) {
  const { data, isLoading, error } = useInventoryScope(connectionId);
  const available = (data?.entries ?? []).filter(
    (entry) => Number(entry.effective_available) > 0,
  );

  if (isLoading) {
    return <span className="text-xs text-gray-500">Available: loading…</span>;
  }

  if (error) {
    return (
      <span role="alert" className="text-xs text-red-600">
        {error}
      </span>
    );
  }

  if (available.length === 0) {
    return (
      <span className="text-xs text-gray-500">
        Available: — (no inventory published)
      </span>
    );
  }

  return (
    <span className="text-xs text-gray-600">
      Available:{' '}
      {available.map((entry) => `${entry.asset_type} ${entry.effective_available}`).join('  ')}
    </span>
  );
}

export function AgentConnectionsPage() {
  const { connections, isLoading, error, refetch } = useConnections();
  const { execute, isLoading: actionLoading } = useConnectionAction<void>();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  async function handleAccept(connectionId: string) {
    const result = await execute(async () => {
      const response = await fetch(
        `${API_BASE}/connections/${connectionId}/accept`,
        { method: 'POST', headers: authHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        const msg = body?.error?.message ?? 'Failed to accept connection.';
        setRowErrors((prev) => ({ ...prev, [connectionId]: msg }));
        throw new Error(msg);
      }
    });
    if (result !== null) {
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[connectionId];
        return next;
      });
      await refetch();
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Connections</h1>

      {isLoading && <p className="text-sm text-gray-500">Loading connections…</p>}

      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!isLoading && !error && connections.length === 0 && (
        <p className="text-sm text-gray-500">No pending invitations.</p>
      )}

      {!isLoading && !error && connections.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-medium text-gray-600">
                Supplier
              </th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Status</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Created</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Agreement</th>
              <th className="py-2 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((conn) => (
              <tr key={conn.connection_id} className="border-b border-gray-100">
                <td className="py-3 pr-4 text-gray-700">
                  <div>{conn.supplier_name || conn.supplier_id.slice(0, 8) + '…'}</div>
                  {conn.status === 'active' && (
                    <div className="mt-1 font-sans">
                      <EffectiveAvailableRow connectionId={conn.connection_id} />
                    </div>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={conn.status} />
                </td>
                <td className="py-3 pr-4 text-gray-600">
                  {new Date(conn.created_at).toLocaleDateString()}
                </td>
                <td className="py-3 pr-4">
                  {conn.status === 'active' && (
                    <Link
                      to={`/dashboard/connections/${conn.connection_id}/agreement`}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 inline-block"
                    >
                      Manage Agreement
                    </Link>
                  )}
                </td>
                <td className="py-3">
                  {conn.status === 'pending' && (
                    <div>
                      <button
                        onClick={() => void handleAccept(conn.connection_id)}
                        disabled={actionLoading}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      {rowErrors[conn.connection_id] && (
                        <p role="alert" className="text-xs text-red-600 mt-1">
                          {rowErrors[conn.connection_id]}
                        </p>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
