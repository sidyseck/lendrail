// src/api/custodiansApi.ts
//
// Typed API wrappers for org-level custodian management endpoints.
// POST /custodians  — register a new custodian link
// GET  /custodians  — list custodian links for the caller's org

import { getToken } from '@/auth/tokenStore';

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

export interface CustodianLink {
  custodian_link_id: string;
  org_id: string;
  custodian_id: string;
  account_ref: string;
  status: string;
  created_at: string;
}

export interface RegisterCustodianInput {
  custodian_id: string;
  account_ref: string;
  plaintext_key: string;
}

export async function registerCustodian(data: RegisterCustodianInput): Promise<CustodianLink> {
  const response = await fetch(`${API_BASE}/custodians`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (response.status === 201) {
    return (await response.json()) as CustodianLink;
  }
  const errBody: unknown = await response.json().catch(() => null);
  throw new Error(parseErrorMessage(errBody, 'Failed to register custodian.'));
}

export async function listCustodians(): Promise<CustodianLink[]> {
  const response = await fetch(`${API_BASE}/custodians`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(errBody, 'Failed to load custodians.'));
  }
  const data = (await response.json()) as { custodians: CustodianLink[] };
  return data.custodians;
}
