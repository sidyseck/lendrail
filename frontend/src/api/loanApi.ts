import { getToken } from '@/auth/tokenStore';
import type {
  CollateralSubstitutionRequest,
  Loan,
  LoanBookingRequest,
  LoanCreateResponse,
  LoanListResponse,
  LoanState,
} from '@/types/loan';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
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

async function requestLoan(path: string, init?: RequestInit, fallback = 'Loan request failed.'): Promise<Loan> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, fallback));
  }
  return (await response.json()) as Loan;
}

export async function listLoans(state?: LoanState): Promise<Loan[]> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  const response = await fetch(`${API_BASE}/loans${qs}`, { headers: authHeaders() });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load loans.'));
  }
  const data = (await response.json()) as LoanListResponse;
  return data.loans;
}

export async function getLoan(loanId: string): Promise<Loan> {
  return requestLoan(`/loans/${loanId}`, undefined, 'Failed to load loan.');
}

export async function bookLoan(body: LoanBookingRequest): Promise<LoanCreateResponse> {
  const response = await fetch(`${API_BASE}/loans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody: unknown = await response.json().catch(() => null);
    const code = parseErrorCode(errBody);
    const message = parseErrorMessage(errBody, 'Failed to book loan.');
    const err = new Error(message);
    (err as Error & { code?: string }).code = code ?? undefined;
    throw err;
  }
  return (await response.json()) as LoanCreateResponse;
}

export async function recallLoan(loanId: string): Promise<Loan> {
  return requestLoan(
    `/loans/${loanId}/recall`,
    { method: 'POST' },
    'Failed to recall loan.',
  );
}

export async function returnLoan(loanId: string): Promise<Loan> {
  return requestLoan(
    `/loans/${loanId}/return`,
    { method: 'POST' },
    'Failed to return assets.',
  );
}

export async function substituteCollateral(
  loanId: string,
  body: CollateralSubstitutionRequest,
): Promise<Loan> {
  return requestLoan(
    `/loans/${loanId}/collateral-substitution`,
    { method: 'POST', body: JSON.stringify(body) },
    'Failed to substitute collateral.',
  );
}
