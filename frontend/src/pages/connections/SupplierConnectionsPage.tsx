// src/pages/connections/SupplierConnectionsPage.tsx
//
// URL convention:
//   All fetch calls use API_BASE + path (e.g. API_BASE + '/connections/invite').
//   API_BASE = '<origin>/api' or '/api' in tests.
//   MSW intercepts '/api/connections/...' (full /api-prefixed path at network level).

import React, { useState } from 'react';
import { getToken } from '@/auth/tokenStore';
import { useConnections } from '@/hooks/useConnections';
import { useConnectionAction } from '@/hooks/useConnectionAction';
import { StatusBadge } from '@/components/StatusBadge';
import { validateEmail } from '@/lib/validators';
import type { Connection } from '@/types/connection';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ── InviteModal ───────────────────────────────────────────────────────────────

interface InviteModalProps {
  onClose: () => void;
  onSuccess201: (conn: Connection) => void;
  onSuccess202: (email: string) => void;
}

function InviteModal({ onClose, onSuccess201, onSuccess202 }: InviteModalProps) {
  const [inviteMode, setInviteMode] = useState<'email' | 'org_id'>('email');
  const [inviteValue, setInviteValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { execute, isLoading: actionLoading, error: actionError, clearError } =
    useConnectionAction<void>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    clearError();

    if (!inviteValue.trim()) {
      setValidationError(
        inviteMode === 'email' ? 'Email is required.' : 'Org ID is required.',
      );
      return;
    }
    if (inviteMode === 'email') {
      const emailErr = validateEmail(inviteValue, 'Agent email');
      if (emailErr) {
        setValidationError(emailErr);
        return;
      }
    }

    await execute(async () => {
      const body =
        inviteMode === 'email'
          ? { agent_email: inviteValue }
          : { agent_org_id: inviteValue };

      const response = await fetch(`${API_BASE}/connections/invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (response.status === 201) {
        const conn = (await response.json()) as Connection;
        onSuccess201(conn);
        return;
      }
      if (response.status === 202) {
        onSuccess202(inviteValue);
        return;
      }
      const errBody = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(errBody?.error?.message ?? 'Request failed. Please try again.');
    });
  }

  const displayError = validationError ?? actionError;

  return (
    <div role="dialog" aria-modal="true" aria-label="Invite Agent">
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Invite Agent</h2>

          <form onSubmit={handleSubmit}>
            <fieldset className="mb-4">
              <legend className="text-sm font-medium text-gray-700 mb-2">Invite by</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="inviteMode"
                    value="email"
                    checked={inviteMode === 'email'}
                    onChange={() => {
                      setInviteMode('email');
                      setInviteValue('');
                      setValidationError(null);
                    }}
                  />
                  By email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="inviteMode"
                    value="org_id"
                    checked={inviteMode === 'org_id'}
                    onChange={() => {
                      setInviteMode('org_id');
                      setInviteValue('');
                      setValidationError(null);
                    }}
                  />
                  By org ID
                </label>
              </div>
            </fieldset>

            {inviteMode === 'email' ? (
              <div className="mb-4">
                <label
                  htmlFor="invite-email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Agent email
                </label>
                <input
                  id="invite-email"
                  type="text"
                  inputMode="email"
                  value={inviteValue}
                  onChange={(e) => setInviteValue(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="agent@example.com"
                />
              </div>
            ) : (
              <div className="mb-4">
                <label
                  htmlFor="invite-org-id"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Agent org ID
                </label>
                <input
                  id="invite-org-id"
                  type="text"
                  value={inviteValue}
                  onChange={(e) => setInviteValue(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="org-uuid"
                />
              </div>
            )}

            {displayError && (
              <p role="alert" className="text-sm text-red-600 mb-4">
                {displayError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Sending…' : 'Send Invitation'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── RegisterKeyModal ──────────────────────────────────────────────────────────

interface RegisterKeyModalProps {
  connection: Connection;
  onClose: () => void;
  onSuccess: () => void;
}

function RegisterKeyModal({ connection, onClose, onSuccess }: RegisterKeyModalProps) {
  const [custodianId, setCustodianId] = useState('');
  const [accountRef, setAccountRef] = useState('');
  const [plaintextKey, setPlaintextKey] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { execute, isLoading: actionLoading, error: actionError, clearError } =
    useConnectionAction<void>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    clearError();

    if (!custodianId.trim()) {
      setValidationError('Custodian ID is required.');
      return;
    }
    if (!accountRef.trim()) {
      setValidationError('Account Reference is required.');
      return;
    }
    if (!plaintextKey.trim()) {
      setValidationError('API Key is required.');
      return;
    }

    await execute(async () => {
      const response = await fetch(
        `${API_BASE}/connections/${connection.connection_id}/custodian-key`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            custodian_id: custodianId,
            account_ref: accountRef,
            plaintext_key: plaintextKey,
          }),
        },
      );

      if (response.ok) {
        onSuccess();
        return;
      }

      const errBody = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      const code = errBody?.error?.code;
      if (code === 'custodian_key_invalid') {
        throw new Error('Key rejected by custodian. Check the key and try again.');
      }
      throw new Error(errBody?.error?.message ?? 'Failed to register key.');
    });
  }

  const displayError = validationError ?? actionError;

  return (
    <div role="dialog" aria-modal="true" aria-label="Register Custodian Key">
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Register Custodian Key
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Connection: {connection.connection_id}
          </p>

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label
                htmlFor="custodian-id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Custodian ID
              </label>
              <input
                id="custodian-id"
                type="text"
                value={custodianId}
                onChange={(e) => setCustodianId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-3">
              <label
                htmlFor="account-ref"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Account Reference
              </label>
              <input
                id="account-ref"
                type="text"
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-4">
              <label
                htmlFor="plaintext-key"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                API Key
              </label>
              {/* HARD CONSTRAINT: type="password" prevents browser from logging/autocompleting */}
              <input
                id="plaintext-key"
                type="password"
                autoComplete="new-password"
                value={plaintextKey}
                onChange={(e) => setPlaintextKey(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>

            {displayError && (
              <p role="alert" className="text-sm text-red-600 mb-4">
                {displayError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Registering…' : 'Register Key'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── SupplierConnectionsPage ───────────────────────────────────────────────────

export function SupplierConnectionsPage() {
  const { connections, isLoading, error, refetch } = useConnections();
  const {
    execute,
    isLoading: actionLoading,
    error: actionError,
  } = useConnectionAction<void>();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [registerKeyTarget, setRegisterKeyTarget] = useState<Connection | null>(
    null,
  );
  const [inviteBanner, setInviteBanner] = useState<string | null>(null);

  async function handleSuspend(connectionId: string) {
    const confirmed = window.confirm(
      'Suspend this connection? The connection can be reactivated by registering a key again.',
    );
    if (!confirmed) return;

    const result = await execute(async () => {
      const response = await fetch(
        `${API_BASE}/connections/${connectionId}/suspend`,
        { method: 'POST', headers: authHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Failed to suspend connection.');
      }
    });
    // refetch only on success
    if (result !== null) {
      await refetch();
    }
  }

  async function handleTerminate(connectionId: string) {
    const confirmed = window.confirm(
      'Terminate this connection? This cannot be undone. You must rotate the custodian API key manually.',
    );
    if (!confirmed) return;

    const result = await execute(async () => {
      const response = await fetch(
        `${API_BASE}/connections/${connectionId}/terminate`,
        { method: 'POST', headers: authHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Failed to terminate connection.');
      }
    });
    // refetch only on success
    if (result !== null) {
      await refetch();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Connections</h1>
        <button
          onClick={() => setInviteOpen(true)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Invite Agent
        </button>
      </div>

      {inviteBanner && (
        <div className="mb-4 rounded bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          {inviteBanner}
        </div>
      )}

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {actionError}
        </p>
      )}

      {isLoading && <p className="text-sm text-gray-500">Loading connections…</p>}

      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!isLoading && !error && connections.length === 0 && (
        <p className="text-sm text-gray-500">
          No connections yet. Invite an agent to get started.
        </p>
      )}

      {!isLoading && !error && connections.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Agent ID</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Status</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Created</th>
              <th className="py-2 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((conn) => (
              <tr key={conn.connection_id} className="border-b border-gray-100">
                <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                  {conn.agent_id.slice(0, 8)}…
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={conn.status} />
                </td>
                <td className="py-3 pr-4 text-gray-600">
                  {new Date(conn.created_at).toLocaleDateString()}
                </td>
                <td className="py-3 flex gap-2 flex-wrap">
                  {conn.status === 'accepted' && (
                    <button
                      onClick={() => setRegisterKeyTarget(conn)}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Register Custodian Key
                    </button>
                  )}
                  {conn.status === 'active' && (
                    <button
                      onClick={() => void handleSuspend(conn.connection_id)}
                      disabled={actionLoading}
                      className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  )}
                  {conn.status !== 'terminated' && (
                    <button
                      onClick={() => void handleTerminate(conn.connection_id)}
                      disabled={actionLoading}
                      className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      Terminate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onSuccess201={() => {
            setInviteOpen(false);
            void refetch();
          }}
          onSuccess202={(email) => {
            setInviteOpen(false);
            setInviteBanner(
              `Invite sent — we'll notify them when they sign up. (${email})`,
            );
            void refetch();
          }}
        />
      )}

      {registerKeyTarget && (
        <RegisterKeyModal
          connection={registerKeyTarget}
          onClose={() => setRegisterKeyTarget(null)}
          onSuccess={() => {
            setRegisterKeyTarget(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
