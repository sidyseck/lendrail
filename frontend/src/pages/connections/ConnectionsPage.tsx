// src/pages/connections/ConnectionsPage.tsx
// Role dispatcher — renders the correct page based on role from AuthContext.

import { useAuth } from '@/auth/AuthContext';
import { SupplierConnectionsPage } from './SupplierConnectionsPage';
import { AgentConnectionsPage } from './AgentConnectionsPage';
import { AdminConnectionsPage } from './AdminConnectionsPage';

export function ConnectionsPage() {
  const { role } = useAuth();

  if (role === 'supplier') return <SupplierConnectionsPage />;
  if (role === 'agent') return <AgentConnectionsPage />;
  if (role === 'admin') return <AdminConnectionsPage />;

  // Unknown role — defensive fallback (ProtectedRoute already guards unauthenticated users)
  return (
    <p className="text-sm text-gray-500">
      Connection management is not available for your role.
    </p>
  );
}
