// src/pages/inventory/AgentAllocationPanels.tsx
//
// F-062 Sections B+C — per-connection allocation panels with inline edit controls.

import { useState } from 'react';
import { setConnectionInventoryScope } from '@/api/inventoryApi';
import type { ConnectionAllocation } from '@/hooks/useAgentAllocations';
import type { InventoryScopeEntrySupplier } from '@/types/connection';

interface Props {
  allocations: ConnectionAllocation[];
  onSaved: (connectionId: string) => void;
}

interface EditState {
  [asset: string]: string;
}

function AllocationPanel({
  allocation,
  onSaved,
}: {
  allocation: ConnectionAllocation;
  onSaved: (connectionId: string) => void;
}) {
  const { connection, inventory, inventoryLoading, inventoryError } = allocation;
  const entries: InventoryScopeEntrySupplier[] = inventory?.entries ?? [];
  const publishedEntries = entries.filter(
    (e) => parseFloat(e.published_quantity) > 0,
  );

  const [editState, setEditState] = useState<EditState>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmZeroAsset, setConfirmZeroAsset] = useState<string | null>(null);
  const [showPublishForm, setShowPublishForm] = useState(false);

  async function handleSave(asset: string, rawValue: string) {
    const qty = parseFloat(rawValue);
    if (!Number.isFinite(qty) || qty < 0) {
      setSaveError('Quantity must be a non-negative number.');
      return;
    }
    if (qty === 0) {
      setConfirmZeroAsset(asset);
      return;
    }
    await doSave(asset, qty);
  }

  async function doSave(asset: string, qty: number) {
    setSaving(true);
    setSaveError(null);
    setConfirmZeroAsset(null);
    try {
      const currentScope: Record<string, number> = {};
      for (const e of entries) {
        if (e.asset_type === asset) {
          currentScope[e.asset_type] = qty;
        } else {
          currentScope[e.asset_type] = parseFloat(e.published_quantity);
        }
      }
      if (!(asset in currentScope)) {
        currentScope[asset] = qty;
      }
      await setConnectionInventoryScope(connection.connection_id, currentScope);
      setEditState((prev) => {
        const next = { ...prev };
        delete next[asset];
        return next;
      });
      onSaved(connection.connection_id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (inventoryLoading) {
    return (
      <div className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-400 italic">
        Loading…
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      {/* Panel header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="font-semibold text-gray-900">
            Agent connection <span className="font-mono text-xs">{connection.connection_id}</span>
          </span>
          <span
            className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${
              connection.status === 'active'
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {connection.status}
          </span>
        </div>
      </div>

      {inventoryError && (
        <div role="alert" className="mb-2 text-sm text-red-600">
          {inventoryError}
        </div>
      )}

      {saveError && (
        <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {publishedEntries.length === 0 ? (
        <div className="text-sm text-gray-500">
          No inventory published.{' '}
          <button
            className="text-blue-600 underline"
            onClick={() => setShowPublishForm(true)}
          >
            + Publish
          </button>
        </div>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase text-gray-500">
              <th className="py-1 pr-4">Asset</th>
              <th className="py-1 pr-4 text-right">Total at custodian</th>
              <th className="py-1 pr-4 text-right">Published</th>
              <th className="py-1 pr-4 text-right">On loan</th>
              <th className="py-1 pr-4 text-right">Remaining</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {publishedEntries.map((entry) => {
              const onLoan = parseFloat(entry.already_booked);
              const remaining = parseFloat(entry.effective_available);
              const editValue =
                editState[entry.asset_type] ?? entry.published_quantity;
              const isEditing = entry.asset_type in editState;
              const wouldGoBelowOnLoan =
                isEditing && parseFloat(editValue) < onLoan && onLoan > 0;

              return (
                <tr key={entry.asset_type}>
                  <td className="py-1.5 pr-4 font-semibold">{entry.asset_type}</td>
                  <td className="py-1.5 pr-4 text-right font-mono text-xs">
                    {entry.custodian_balance}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <input
                        aria-label={`published quantity for ${entry.asset_type}`}
                        type="number"
                        min="0"
                        step="any"
                        value={editValue}
                        onChange={(e) =>
                          setEditState((prev) => ({
                            ...prev,
                            [entry.asset_type]: e.target.value,
                          }))
                        }
                        className="w-28 rounded border border-gray-300 px-2 py-0.5 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      {wouldGoBelowOnLoan && (
                        <span className="text-xs text-amber-600">
                          Below on-loan amount. Existing loans are not affected.
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono text-xs">
                    {entry.already_booked}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono text-xs">
                    {remaining.toFixed(2)}
                  </td>
                  <td className="py-1.5">
                    {isEditing && (
                      <button
                        disabled={saving}
                        onClick={() => void handleSave(entry.asset_type, editValue)}
                        className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showPublishForm && (
        <NewPublicationForm
          connectionId={connection.connection_id}
          onSaved={() => {
            setShowPublishForm(false);
            onSaved(connection.connection_id);
          }}
          onCancel={() => setShowPublishForm(false)}
        />
      )}

      {/* Zero-confirmation dialog */}
      {confirmZeroAsset && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        >
          <div className="w-80 rounded-lg bg-white p-5 shadow-xl">
            <p className="mb-3 text-sm text-gray-700">
              Setting this to zero will block new bookings for{' '}
              <strong>{confirmZeroAsset}</strong> on this connection.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                onClick={() => setConfirmZeroAsset(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
                onClick={() => void doSave(confirmZeroAsset, 0)}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewPublicationForm({
  connectionId,
  onSaved,
  onCancel,
}: {
  connectionId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [asset, setAsset] = useState('');
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(qty);
    if (!asset.trim()) { setError('Asset type is required.'); return; }
    if (!Number.isFinite(parsed) || parsed < 0) { setError('Quantity must be >= 0.'); return; }
    setSaving(true);
    setError(null);
    try {
      await setConnectionInventoryScope(connectionId, { [asset.trim()]: parsed });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 flex items-end gap-2 border-t pt-3">
      <div>
        <label className="mb-0.5 block text-xs text-gray-600">Asset type</label>
        <input
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          placeholder="BTC"
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-0.5 block text-xs text-gray-600">Quantity</label>
        <input
          type="number"
          min="0"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="100"
          className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="submit"
        disabled={saving}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Publish'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
      >
        Cancel
      </button>
    </form>
  );
}

export function AgentAllocationPanels({ allocations, onSaved }: Props) {
  if (allocations.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No active or suspended agent connections. Connect with an agent to publish inventory.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {allocations.map((allocation) => (
        <AllocationPanel
          key={allocation.connection.connection_id}
          allocation={allocation}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}
