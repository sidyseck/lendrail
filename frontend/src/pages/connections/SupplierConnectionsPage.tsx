// src/pages/connections/SupplierConnectionsPage.tsx
//
// URL convention:
//   All fetch calls use API_BASE + path (e.g. API_BASE + '/connections/invite').
//   API_BASE = '<origin>/api' or '/api' in tests.
//   MSW intercepts '/api/connections/...' (full /api-prefixed path at network level).

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '@/auth/tokenStore';
import { useConnections } from '@/hooks/useConnections';
import { useConnectionAction } from '@/hooks/useConnectionAction';
import { useInventoryScope } from '@/hooks/useInventoryScope';
import { StatusBadge } from '@/components/StatusBadge';
import { AgreementStatusBadge } from '@/components/agreements/AgreementStatusBadge';
import { validateEmail } from '@/lib/validators';
import type { Connection, InventoryScopeEntrySupplier } from '@/types/connection';

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

// ── InventoryScopeModal ───────────────────────────────────────────────────────

interface InventoryScopeModalProps {
  connectionId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function isSupplierEntry(
  entry: { asset_type: string; effective_available: string },
): entry is InventoryScopeEntrySupplier {
  return 'published_quantity' in entry && 'custodian_balance' in entry;
}

function InventoryScopeModal({
  connectionId,
  onClose,
  onSaved,
}: InventoryScopeModalProps) {
  const { data, isLoading, error, refetch } = useInventoryScope(connectionId);
  const {
    execute,
    isLoading: saveLoading,
    error: saveError,
    clearError,
  } = useConnectionAction<void>();
  const [editScope, setEditScope] = useState<Record<string, string>>({});
  const [assetInput, setAssetInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const entries = (data?.entries ?? []).filter(isSupplierEntry);

  useEffect(() => {
    if (!data) return;

    const nextScope: Record<string, string> = {};
    for (const entry of data.entries) {
      if (!isSupplierEntry(entry)) continue;

      if (Number(entry.published_quantity) > 0) {
        nextScope[entry.asset_type] = entry.published_quantity;
      }
    }
    setEditScope(nextScope);
  }, [data]);

  function validateQuantity(asset: string, quantity: string): string | null {
    const parsed = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(parsed) || parsed < 0) {
      return `Invalid quantity for ${asset}`;
    }
    return null;
  }

  function handleAddAsset() {
    clearError();
    setFormError(null);

    const asset = assetInput.trim();
    const quantity = quantityInput.trim();
    if (!asset) {
      setFormError('Asset type is required.');
      return;
    }
    const quantityError = validateQuantity(asset, quantity);
    if (quantityError) {
      setFormError(quantityError);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(editScope, asset)) {
      setFormError(`${asset} is already in scope.`);
      return;
    }

    setEditScope((prev) => ({ ...prev, [asset]: quantity }));
    setAssetInput('');
    setQuantityInput('');
  }

  async function handleSaveScope() {
    clearError();
    setFormError(null);

    const scope: Record<string, string> = {};
    for (const [asset, quantity] of Object.entries(editScope)) {
      const trimmedAsset = asset.trim();
      const trimmedQuantity = quantity.trim();
      if (!trimmedAsset) {
        setFormError('Asset type is required.');
        return;
      }
      const quantityError = validateQuantity(trimmedAsset, trimmedQuantity);
      if (quantityError) {
        setFormError(quantityError);
        return;
      }
      scope[trimmedAsset] = trimmedQuantity;
    }

    const result = await execute(async () => {
      const response = await fetch(
        `${API_BASE}/connections/${connectionId}/inventory-scope`,
        {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ scope }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Failed to save inventory scope.');
      }
    });

    if (result !== null) {
      await refetch();
      await onSaved();
      onClose();
    }
  }

  const displayError = formError ?? saveError;

  return (
    <div role="dialog" aria-modal="true" aria-label="Manage Inventory">
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Published Inventory</h2>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
            >
              Close
            </button>
          </div>

          {isLoading && (
            <p className="text-sm text-gray-500 mb-4">Loading inventory…</p>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 mb-4">
              {error}
            </p>
          )}

          {!isLoading && !error && (
            <div className="mb-6 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset</th>
                    <th className="py-2 pr-4 text-left font-medium text-gray-600">
                      Custodian Balance
                    </th>
                    <th className="py-2 pr-4 text-left font-medium text-gray-600">
                      Published
                    </th>
                    <th className="py-2 pr-4 text-left font-medium text-gray-600">
                      Already Booked
                    </th>
                    <th className="py-2 text-left font-medium text-gray-600">
                      Effective Available
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-3 text-gray-500">
                        No inventory published.
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => (
                      <tr key={entry.asset_type} className="border-b border-gray-100">
                        <td className="py-2 pr-4 font-mono text-xs text-gray-700">
                          {entry.asset_type}
                        </td>
                        <td className="py-2 pr-4 text-gray-700">
                          {entry.custodian_balance}
                        </td>
                        <td className="py-2 pr-4 text-gray-700">
                          {entry.published_quantity}
                        </td>
                        <td className="py-2 pr-4 text-gray-700">
                          {entry.already_booked}
                        </td>
                        <td className="py-2 text-gray-700">
                          {entry.effective_available}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Scope</h3>

            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-4">
              <div>
                <label htmlFor="inventory-asset" className="sr-only">
                  Asset type
                </label>
                <input
                  id="inventory-asset"
                  type="text"
                  value={assetInput}
                  onChange={(event) => setAssetInput(event.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="Asset type"
                />
              </div>
              <div>
                <label htmlFor="inventory-quantity" className="sr-only">
                  Quantity
                </label>
                <input
                  id="inventory-quantity"
                  type="text"
                  inputMode="decimal"
                  value={quantityInput}
                  onChange={(event) => setQuantityInput(event.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  placeholder="Quantity"
                />
              </div>
              <button
                type="button"
                onClick={handleAddAsset}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
              >
                Add Asset
              </button>
            </div>

            <div className="space-y-2 mb-4">
              {Object.entries(editScope).length === 0 ? (
                <p className="text-sm text-gray-500">No assets in scope.</p>
              ) : (
                Object.entries(editScope).map(([asset, quantity]) => (
                  <div
                    key={asset}
                    className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
                  >
                    <span className="font-mono text-xs text-gray-700">{asset}</span>
                    <input
                      aria-label={`${asset} quantity`}
                      type="text"
                      inputMode="decimal"
                      value={quantity}
                      onChange={(event) =>
                        setEditScope((prev) => ({
                          ...prev,
                          [asset]: event.target.value,
                        }))
                      }
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEditScope((prev) => {
                          const next = { ...prev };
                          delete next[asset];
                          return next;
                        })
                      }
                      className="px-3 py-2 text-sm text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
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
                type="button"
                onClick={() => void handleSaveScope()}
                disabled={saveLoading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saveLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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
  const [inviteBanner, setInviteBanner] = useState<string | null>(null);
  const [inventoryConnectionId, setInventoryConnectionId] = useState<string | null>(null);

  async function handleSuspend(connectionId: string) {
    const confirmed = window.confirm('Suspend this connection?');
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

  async function handleReactivate(connectionId: string) {
    const result = await execute(async () => {
      const response = await fetch(
        `${API_BASE}/connections/${connectionId}/reactivate`,
        { method: 'POST', headers: authHeaders() },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Failed to reactivate connection.');
      }
    });
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
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Agent</th>
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
                  {conn.agent_name || conn.agent_id.slice(0, 8) + '…'}
                </td>
                <td className="py-3 pr-4">
                  <StatusBadge status={conn.status} />
                </td>
                <td className="py-3 pr-4 text-gray-600">
                  {new Date(conn.created_at).toLocaleDateString()}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    {conn.status === 'active' && (
                      <Link
                        to={`/dashboard/connections/${conn.connection_id}/agreement`}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 inline-block"
                      >
                        Manage Agreement
                      </Link>
                    )}
                    {conn.pending_agreement === true && (
                      <AgreementStatusBadge status="pending_confirmation" />
                    )}
                  </div>
                </td>
                <td className="py-3 flex gap-2 flex-wrap">
                  {(conn.status === 'active' || conn.status === 'suspended') && (
                    <button
                      onClick={() => setInventoryConnectionId(conn.connection_id)}
                      className="px-3 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-800"
                    >
                      Manage Inventory
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
                  {conn.status === 'suspended' && (
                    <button
                      onClick={() => void handleReactivate(conn.connection_id)}
                      disabled={actionLoading}
                      className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      Reactivate
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

      {inventoryConnectionId && (
        <InventoryScopeModal
          connectionId={inventoryConnectionId}
          onClose={() => setInventoryConnectionId(null)}
          onSaved={refetch}
        />
      )}

    </div>
  );
}
