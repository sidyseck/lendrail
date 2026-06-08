// src/api/inventoryApi.ts
//
// API wrappers for F-061/F-062/F-063 inventory endpoints:
//   GET  /custodians/{id}/inventory     — F-062 Section A (supplier only)
//   GET  /connections/{id}/inventory    — F-061, F-062 Section B, F-063
//   PUT  /connections/{id}/inventory-scope — F-061, F-062 Section C

import { getToken } from '@/auth/tokenStore';
import type {
  InventoryScopeSupplierResponse,
  InventoryScopeAgentResponse,
} from '@/types/connection';
import type { AllocationNotification } from '@/types/inventory';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function parseErrorMessage(body: unknown, fallback: string): string {
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: unknown }).error !== null
  ) {
    const err = (body as { error: { message?: unknown } }).error;
    if (typeof err.message === 'string') return err.message;
  }
  return fallback;
}

export interface CustodianInventoryPosition {
  asset_type: string;
  quantity: string;
  as_of: string;
}

export interface CustodianInventoryResponse {
  custodian_link_id: string;
  account_ref: string;
  positions: CustodianInventoryPosition[];
}

export async function getCustodianInventory(
  custodianLinkId: string,
): Promise<CustodianInventoryResponse> {
  const response = await fetch(`${API_BASE}/custodians/${custodianLinkId}/inventory`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(errBody, 'Failed to load custodian inventory.'));
  }
  return (await response.json()) as CustodianInventoryResponse;
}

export async function getConnectionInventorySupplier(
  connectionId: string,
): Promise<InventoryScopeSupplierResponse> {
  const response = await fetch(`${API_BASE}/connections/${connectionId}/inventory`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(errBody, 'Failed to load connection inventory.'));
  }
  return (await response.json()) as InventoryScopeSupplierResponse;
}

export async function getConnectionInventoryAgent(
  connectionId: string,
): Promise<InventoryScopeAgentResponse> {
  const response = await fetch(`${API_BASE}/connections/${connectionId}/inventory`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(errBody, 'Failed to load connection inventory.'));
  }
  return (await response.json()) as InventoryScopeAgentResponse;
}

export async function getAllocationNotifications(
  since?: string,
): Promise<AllocationNotification[]> {
  const params = new URLSearchParams({ event: 'supplier_allocation_changed' });
  if (since) params.set('since', since);
  const response = await fetch(`${API_BASE}/notifications?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (response.status === 404 || response.status === 405) return [];
  if (!response.ok) return [];
  const data = (await response.json()) as { notifications: AllocationNotification[] };
  return data.notifications ?? [];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
    method: 'POST',
    headers: authHeaders(),
  });
}

export async function setConnectionInventoryScope(
  connectionId: string,
  scope: Record<string, number>,
): Promise<void> {
  const response = await fetch(`${API_BASE}/connections/${connectionId}/inventory-scope`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ scope }),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(errBody, 'Failed to update inventory scope.'));
  }
}
