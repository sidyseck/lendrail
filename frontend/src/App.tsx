import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SupplierRegisterPage } from './pages/SupplierRegisterPage';
import { AgentRegisterPage } from './pages/AgentRegisterPage';
import { ConnectionsPage } from './pages/connections/ConnectionsPage';
import { OrganizationManagementPage } from './pages/OrganizationManagementPage';
import { AgreementPage } from './pages/agreements/AgreementPage';
import { AgentAgreementFormPage } from './pages/agreements/AgentAgreementFormPage';
import { AgreementHistoryPage } from './pages/agreements/AgreementHistoryPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register/supplier" element={<SupplierRegisterPage />} />
          <Route path="/register/agent" element={<AgentRegisterPage />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          >
            {/* M2: connections sub-route */}
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="organization" element={<OrganizationManagementPage />} />
            {/* M3: agreement sub-routes */}
            <Route path="connections/:connectionId/agreement" element={<AgreementPage />} />
            <Route path="connections/:connectionId/agreement/new" element={<AgentAgreementFormPage />} />
            <Route path="connections/:connectionId/agreement/history" element={<AgreementHistoryPage />} />
          </Route>

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {/* Catch-all — must be last */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
