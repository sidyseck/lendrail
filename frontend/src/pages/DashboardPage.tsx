import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';

export function DashboardPage() {
  const { role, logout } = useAuth();
  const location = useLocation();
  const onConnections = location.pathname.startsWith('/dashboard/connections');
  const onOrganization = location.pathname.startsWith('/dashboard/organization');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">LendRail</span>
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard/connections"
              className={`text-sm ${onConnections ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Connections
            </Link>
            <Link
              to="/dashboard/organization"
              className={`text-sm ${onOrganization ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Organization
            </Link>
            {role && (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-600">
                {role}
              </span>
            )}
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Child routes render here via Outlet */}
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
