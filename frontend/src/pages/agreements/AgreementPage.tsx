// src/pages/agreements/AgreementPage.tsx
// Role dispatcher — renders the correct view based on role from AuthContext.
// Mirrors ConnectionsPage pattern exactly.

import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { SupplierAgreementView } from './SupplierAgreementView';
import { AgentAgreementView } from './AgentAgreementView';

export function AgreementPage() {
  const { role } = useAuth();
  const { connectionId } = useParams<{ connectionId: string }>();

  if (!connectionId) {
    return <Navigate to="/dashboard/connections" replace />;
  }

  if (role === 'supplier') return <SupplierAgreementView connectionId={connectionId} />;
  if (role === 'agent') return <AgentAgreementView connectionId={connectionId} />;

  return (
    <p className="text-sm text-gray-500">
      Agreement management is not available for your role.
    </p>
  );
}
