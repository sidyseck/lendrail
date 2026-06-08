// src/pages/connections/AdminConnectionsPage.tsx
// Read-only admin view — shows all connections, no action buttons.
// Satisfies F-026 AC: "Admin JWT can call GET /connections and receives all connections."

import { useConnections } from '@/hooks/useConnections';
import { StatusBadge } from '@/components/StatusBadge';

export function AdminConnectionsPage() {
  const { connections, isLoading, error } = useConnections();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">All Connections (Admin)</h1>

      {isLoading && (
        <p className="text-sm text-gray-500">Loading connections…</p>
      )}

      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!isLoading && !error && connections.length === 0 && (
        <p className="text-sm text-gray-500">No connections found.</p>
      )}

      {!isLoading && !error && connections.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Connection ID</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Supplier ID</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Agent ID</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Status</th>
              <th className="py-2 text-left font-medium text-gray-600">Created</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((conn) => (
              <tr key={conn.connection_id} className="border-b border-gray-100">
                <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                  {conn.connection_id.slice(0, 8)}…
                </td>
                <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                  {conn.supplier_id.slice(0, 8)}…
                </td>
                <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                  {conn.agent_id.slice(0, 8)}…
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={conn.status} />
                </td>
                <td className="py-3 text-gray-600">
                  {new Date(conn.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
