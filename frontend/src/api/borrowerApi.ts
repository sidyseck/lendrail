import { getToken } from '@/auth/tokenStore';
import type {
  ApprovedBorrower,
  ApprovedBorrowerListResponse,
  BorrowerCreateRequest,
  BorrowerCreateResponse,
} from '@/types/borrower';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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

export async function listApprovedBorrowers(connectionId: string): Promise<ApprovedBorrower[]> {
  const response = await fetch(`${API_BASE}/connections/${connectionId}/approved-borrowers`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load borrowers.'));
  }
  const data = (await response.json()) as ApprovedBorrowerListResponse;
  return data.borrowers;
}

export async function createBorrower(body: BorrowerCreateRequest): Promise<BorrowerCreateResponse> {
  const response = await fetch(`${API_BASE}/borrowers`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(errBody, 'Failed to create borrower.'));
  }
  return (await response.json()) as BorrowerCreateResponse;
}
