import React, { useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';

type OrgType = 'supplier' | 'agent';
type AccountStatus = 'draft' | 'active';
type PermissionLevel = 'read' | 'write';

interface ManagedAccount {
  id: string;
  legalName: string;
  jurisdiction: string;
  type: OrgType;
  status: AccountStatus;
}

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  accountId: string;
  roleId: string;
}

interface ManagedRole {
  id: string;
  name: string;
  accountType: OrgType;
  permission: PermissionLevel;
}

const seedAccounts: ManagedAccount[] = [
  {
    id: 'acct-supplier-001',
    legalName: 'Northstar Digital Yield Fund',
    jurisdiction: 'Delaware, US',
    type: 'supplier',
    status: 'active',
  },
  {
    id: 'acct-agent-001',
    legalName: 'Atlas Agency Lending LLC',
    jurisdiction: 'New York, US',
    type: 'agent',
    status: 'draft',
  },
];

const seedRoles: ManagedRole[] = [
  {
    id: 'role-supplier-read',
    name: 'Supplier Viewer',
    accountType: 'supplier',
    permission: 'read',
  },
  {
    id: 'role-supplier-write',
    name: 'Supplier Operator',
    accountType: 'supplier',
    permission: 'write',
  },
  {
    id: 'role-agent-read',
    name: 'Agent Viewer',
    accountType: 'agent',
    permission: 'read',
  },
  {
    id: 'role-agent-write',
    name: 'Agent Operator',
    accountType: 'agent',
    permission: 'write',
  },
];

const seedUsers: ManagedUser[] = [
  {
    id: 'user-001',
    name: 'Avery Singh',
    email: 'avery@example.com',
    accountId: 'acct-supplier-001',
    roleId: 'role-supplier-write',
  },
];

function getWriteMeaning(type: OrgType): string {
  if (type === 'supplier') {
    return 'Supplier write: manage inventory scope, approve borrowers, confirm program terms, issue supplier-side instructions.';
  }
  return 'Agent lender write: onboard borrowers, book loans, reconcile collateral, and initiate settlement instructions.';
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function OrganizationManagementPage() {
  const { role: orgRole, orgId } = useAuth();
  const [organizationName, setOrganizationName] = useState(seedAccounts[0].legalName);
  const [organizationType, setOrganizationType] = useState<OrgType>(
    orgRole === 'agent' ? 'agent' : 'supplier',
  );
  const [accounts, setAccounts] = useState<ManagedAccount[]>(seedAccounts);
  const [roles] = useState<ManagedRole[]>(seedRoles);
  const [users, setUsers] = useState<ManagedUser[]>(seedUsers);
  const [accountForm, setAccountForm] = useState({
    legalName: '',
    jurisdiction: '',
    type: orgRole === 'agent' ? 'agent' : ('supplier' as OrgType),
  });
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    accountId: seedAccounts[0]?.id ?? '',
    roleId: seedRoles[0]?.id ?? '',
  });

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const roleById = useMemo(
    () => new Map(roles.map((managedRole) => [managedRole.id, managedRole])),
    [roles],
  );
  const selectedAccount = accountById.get(userForm.accountId);
  const availableRoles = roles.filter(
    (managedRole) => managedRole.accountType === selectedAccount?.type,
  );

  function saveOrganization(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationName.trim()) return;
  }

  function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountForm.legalName.trim() || !accountForm.jurisdiction.trim()) return;

    const account: ManagedAccount = {
      id: makeId('acct'),
      legalName: accountForm.legalName.trim(),
      jurisdiction: accountForm.jurisdiction.trim(),
      type: accountForm.type,
      status: 'draft',
    };
    setAccounts((current) => [...current, account]);
    setAccountForm({ legalName: '', jurisdiction: '', type: accountForm.type });
    setUserForm((current) => ({ ...current, accountId: account.id }));
  }

  function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (
      !userForm.name.trim() ||
      !userForm.email.trim() ||
      !userForm.accountId ||
      !userForm.roleId
    ) {
      return;
    }

    const user: ManagedUser = {
      id: makeId('user'),
      name: userForm.name.trim(),
      email: userForm.email.trim(),
      accountId: userForm.accountId,
      roleId: userForm.roleId,
    };
    setUsers((current) => [...current, user]);
    setUserForm((current) => ({ ...current, name: '', email: '' }));
  }

  function handleUserAccountChange(accountId: string) {
    const account = accountById.get(accountId);
    const nextRole =
      roles.find((managedRole) => managedRole.accountType === account?.type)?.id ?? '';
    setUserForm((current) => ({ ...current, accountId, roleId: nextRole }));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Organization Management
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Placeholder workspace for creating an organization, managing legal
            entity accounts, assigning users, and mapping roles to read or write
            permissions.
          </p>
        </div>
        <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
          Placeholder
        </span>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <form
          onSubmit={saveOrganization}
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-base font-semibold text-gray-900">Organization</h2>
          <p className="mt-1 text-sm text-gray-600">
            The first account creates the workspace. The creator is the admin
            user and can edit this name later.
          </p>
          <div className="mt-4 rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium uppercase text-gray-500">Organization ID</p>
            <p className="mt-1 break-all text-sm font-medium text-gray-900">
              {orgId ?? 'Generated after onboarding'}
            </p>
          </div>
          <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium uppercase text-gray-500">Admin user</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              Initial creator
            </p>
          </div>
          <label htmlFor="organization-name" className="mt-4 block text-sm font-medium text-gray-700">
            Workspace name
          </label>
          <input
            id="organization-name"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <label htmlFor="organization-type" className="mt-3 block text-sm font-medium text-gray-700">
            Default org type
          </label>
          <select
            id="organization-type"
            value={organizationType}
            onChange={(e) => setOrganizationType(e.target.value as OrgType)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="supplier">Supplier</option>
            <option value="agent">Agent lender</option>
          </select>
          <button
            type="submit"
            className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Save Organization Name
          </button>
        </form>

        <form
          onSubmit={createAccount}
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-base font-semibold text-gray-900">Accounts</h2>
          <p className="mt-1 text-sm text-gray-600">
            Accounts are actual legal entities attached to the workspace.
          </p>
          <label htmlFor="account-name" className="mt-4 block text-sm font-medium text-gray-700">
            Legal entity name
          </label>
          <input
            id="account-name"
            value={accountForm.legalName}
            onChange={(e) =>
              setAccountForm((current) => ({
                ...current,
                legalName: e.target.value,
              }))
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Entity LLC"
          />
          <label htmlFor="account-jurisdiction" className="mt-3 block text-sm font-medium text-gray-700">
            Jurisdiction
          </label>
          <input
            id="account-jurisdiction"
            value={accountForm.jurisdiction}
            onChange={(e) =>
              setAccountForm((current) => ({
                ...current,
                jurisdiction: e.target.value,
              }))
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Delaware, US"
          />
          <label htmlFor="account-type" className="mt-3 block text-sm font-medium text-gray-700">
            Account type
          </label>
          <select
            id="account-type"
            value={accountForm.type}
            onChange={(e) =>
              setAccountForm((current) => ({
                ...current,
                type: e.target.value as OrgType,
              }))
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="supplier">Supplier</option>
            <option value="agent">Agent lender</option>
          </select>
          <button
            type="submit"
            className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Create Account
          </button>
        </form>

        <form
          onSubmit={createUser}
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-base font-semibold text-gray-900">Users</h2>
          <p className="mt-1 text-sm text-gray-600">
            Users are attached to accounts and receive a role for that account.
          </p>
          <label htmlFor="user-name" className="mt-4 block text-sm font-medium text-gray-700">
            Full name
          </label>
          <input
            id="user-name"
            value={userForm.name}
            onChange={(e) =>
              setUserForm((current) => ({ ...current, name: e.target.value }))
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Jordan Lee"
          />
          <label htmlFor="user-email" className="mt-3 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="user-email"
            type="email"
            value={userForm.email}
            onChange={(e) =>
              setUserForm((current) => ({ ...current, email: e.target.value }))
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="jordan@example.com"
          />
          <label htmlFor="user-account" className="mt-3 block text-sm font-medium text-gray-700">
            Account
          </label>
          <select
            id="user-account"
            value={userForm.accountId}
            onChange={(e) => handleUserAccountChange(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.legalName}
              </option>
            ))}
          </select>
          <label htmlFor="user-role" className="mt-3 block text-sm font-medium text-gray-700">
            Role
          </label>
          <select
            id="user-role"
            value={userForm.roleId}
            onChange={(e) =>
              setUserForm((current) => ({ ...current, roleId: e.target.value }))
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {availableRoles.map((managedRole) => (
              <option key={managedRole.id} value={managedRole.id}>
                {managedRole.name} ({managedRole.permission})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Create User
          </button>
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Account Directory</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-3">Legal entity</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Jurisdiction</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-5 py-4 font-medium text-gray-900">
                      {account.legalName}
                    </td>
                    <td className="px-5 py-4 capitalize text-gray-600">
                      {account.type === 'agent' ? 'Agent lender' : account.type}
                    </td>
                    <td className="px-5 py-4 text-gray-600">{account.jurisdiction}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700">
                        {account.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Role Model</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {roles.map((managedRole) => (
              <div key={managedRole.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{managedRole.name}</p>
                    <p className="mt-1 text-sm capitalize text-gray-600">
                      {managedRole.accountType === 'agent'
                        ? 'Agent lender'
                        : managedRole.accountType}{' '}
                      account
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium capitalize text-blue-700">
                    {managedRole.permission}
                  </span>
                </div>
                {managedRole.permission === 'write' && (
                  <p className="mt-3 text-sm text-gray-600">
                    {getWriteMeaning(managedRole.accountType)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">User Assignments</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Account</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Permission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {users.map((user) => {
                const account = accountById.get(user.accountId);
                const assignedRole = roleById.get(user.roleId);
                return (
                  <tr key={user.id}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{user.name}</p>
                      <p className="mt-1 text-gray-600">{user.email}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {account?.legalName ?? 'Unassigned'}
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {assignedRole?.name ?? 'Unassigned'}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700">
                        {assignedRole?.permission ?? 'none'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
