// src/api/agreementApi.ts
//
// Typed API wrappers for M3 agreement endpoints.
// Uses fetch + authHeaders() pattern (same as M2 connection pages).
// Switch to apiClient.GET/POST/PUT after npm run generate-client includes M3 schema.

import type { Agreement, AgreementHistoryResponse, AgreementTermsRequest } from '@/types/agreement';
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
    const err = (body as { error: { message?: unknown; code?: unknown } }).error;
    if (typeof err.message === 'string') return err.message;
    if (typeof err.code === 'string') return err.code;
  }
  return fallback;
}

function parseErrorCode(body: unknown): string | null {
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: unknown }).error !== null
  ) {
    const err = (body as { error: { code?: unknown } }).error;
    if (typeof err.code === 'string') return err.code;
  }
  return null;
}

/**
 * GET /connections/:connectionId/agreement
 * Returns the head (latest) agreement for the connection, or null if none exists (404).
 */
export async function getLatestAgreement(connectionId: string): Promise<Agreement | null> {
  const response = await fetch(`${API_BASE}/connections/${connectionId}/agreement`, {
    headers: authHeaders(),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load agreement.'));
  }
  return (await response.json()) as Agreement;
}

/**
 * GET /connections/:connectionId/agreement/history
 * Returns all agreement versions for the connection.
 */
export async function getAgreementHistory(connectionId: string): Promise<Agreement[]> {
  const response = await fetch(
    `${API_BASE}/connections/${connectionId}/agreement/history`,
    { headers: authHeaders() },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load agreement history.'));
  }
  const data = (await response.json()) as AgreementHistoryResponse;
  return data.agreements;
}

/**
 * POST /connections/:connectionId/agreement
 * Creates a new agreement. Returns 201 on success.
 * Throws on 403 | 409 | 422.
 */
export async function createAgreement(
  connectionId: string,
  body: AgreementTermsRequest,
): Promise<Agreement> {
  const response = await fetch(`${API_BASE}/connections/${connectionId}/agreement`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (response.status === 201) {
    return (await response.json()) as Agreement;
  }
  const errBody: unknown = await response.json().catch(() => null);
  throw new Error(parseErrorMessage(errBody, 'Failed to create agreement.'));
}

/**
 * POST /agreements/:agreementId/confirm
 * Confirms an agreement (supplier or agent). Returns 200 on success.
 * Throws on 403 | 409.
 * The error object includes a `code` field for caller-side handling of 409 variants.
 */
export async function confirmAgreement(agreementId: string): Promise<Agreement> {
  const response = await fetch(`${API_BASE}/agreements/${agreementId}/confirm`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (response.ok) {
    return (await response.json()) as Agreement;
  }
  const errBody: unknown = await response.json().catch(() => null);
  const code = parseErrorCode(errBody);
  const message = parseErrorMessage(errBody, 'Failed to confirm agreement.');
  const err = new Error(message);
  (err as Error & { code?: string }).code = code ?? undefined;
  throw err;
}

/**
 * PUT /agreements/:agreementId
 * Amends an existing agreement, creating a new version. Returns 201 on success.
 * Throws on 403 | 404 | 409 | 422.
 */
export async function amendAgreement(
  agreementId: string,
  body: AgreementTermsRequest,
): Promise<Agreement> {
  const response = await fetch(`${API_BASE}/agreements/${agreementId}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  // 201 is treated as success for amend
  if (response.ok || response.status === 201) {
    return (await response.json()) as Agreement;
  }
  const errBody: unknown = await response.json().catch(() => null);
  throw new Error(parseErrorMessage(errBody, 'Failed to amend agreement.'));
}
