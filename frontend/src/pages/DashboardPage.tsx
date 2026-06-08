import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useAllocationNotifications } from '@/hooks/useAllocationNotifications';

export function DashboardPage() {
  const { role, logout } = useAuth();
  const location = useLocation();
  const onConnections = location.pathname.startsWith('/dashboard/connections');
  const onLoans = location.pathname.startsWith('/dashboard/loans');
  const onOrganization = location.pathname.startsWith('/dashboard/organization');
  const onCustodians = location.pathname.startsWith('/dashboard/custodians');
  const onInventory = location.pathname.startsWith('/dashboard/inventory');
  const onAvailableInventory = location.pathname.startsWith('/dashboard/available-inventory');

  const { badgeCount } = useAllocationNotifications(onAvailableInventory);

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
            {(role === 'supplier' || role === 'agent') && (
              <Link
                to="/dashboard/loans"
                className={`text-sm ${onLoans ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
              >
                Loans
              </Link>
            )}
            <Link
              to="/dashboard/organization"
              className={`text-sm ${onOrganization ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Organization
            </Link>
            {role === 'supplier' && (
              <Link
                to="/dashboard/custodians"
                className={`text-sm ${onCustodians ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
              >
                Custodians
              </Link>
            )}
            {role === 'supplier' && (
              <Link
                to="/dashboard/inventory"
                className={`text-sm ${onInventory ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
              >
                Inventory
              </Link>
            )}
            {role === 'agent' && (
              <Link
                to="/dashboard/available-inventory"
                className={`relative text-sm ${onAvailableInventory ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
                aria-label="Available Inventory"
              >
                Available Inventory
                {badgeCount > 0 && (
                  <span className="absolute -right-3 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </Link>
            )}
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
