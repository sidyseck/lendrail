// src/pages/agreements/AgreementPage.tsx
// Role dispatcher — renders the correct view based on role from AuthContext.
// Mirrors ConnectionsPage pattern exactly.

import { useParams, Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { SupplierAgreementView } from './SupplierAgreementView';
import { AgentAgreementView } from './AgentAgreementView';

export function AgreementPage() {
  const { role } = useAuth();
  const { connectionId } = useParams<{ connectionId: string }>();

  if (!connectionId) {
    return <Navigate to="/dashboard/connections" replace />;
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          to="/dashboard/connections"
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Back to Connections
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Lending Agreement</h1>
        <p className="mt-1 text-xs font-mono text-gray-500">Connection: {connectionId}</p>
      </div>

      {role === 'supplier' && <SupplierAgreementView connectionId={connectionId} />}
      {role === 'agent' && <AgentAgreementView connectionId={connectionId} />}
      {role !== 'supplier' && role !== 'agent' && (
        <p className="text-sm text-gray-500">
          Agreement management is not available for your role.
        </p>
      )}
    </div>
  );
}
