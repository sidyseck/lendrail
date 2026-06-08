// src/mocks/handlers/custodians.ts

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { CustodianLink } from '@/api/custodiansApi';

const SUPPLIER_ORG_ID = 'org-001';

const INITIAL_CUSTODIANS: CustodianLink[] = [
  {
    custodian_link_id: 'clink-001',
    org_id: SUPPLIER_ORG_ID,
    custodian_id: 'fireblocks',
    account_ref: 'vault-123',
    status: 'active',
    created_at: '2026-06-01T00:00:00Z',
  },
];

let mockCustodians: CustodianLink[] = [...INITIAL_CUSTODIANS.map((c) => ({ ...c }))];

export function resetMockCustodians(): void {
  mockCustodians = [...INITIAL_CUSTODIANS.map((c) => ({ ...c }))];
}

export const custodiansHandlers = [
  // ── GET /api/custodians ────────────────────────────────────────────────────
  http.get('/api/custodians', async () => {
    await delay(20);
    return HttpResponse.json({ custodians: mockCustodians });
  }),

  // ── POST /api/custodians ───────────────────────────────────────────────────
  http.post('/api/custodians', async ({ request }) => {
    await delay(20);
    const body = (await request.json()) as {
      custodian_id?: string;
      account_ref?: string;
      plaintext_key?: string;
    };

    if (!body.custodian_id || !body.account_ref || !body.plaintext_key) {
      return mockError('validation_error', 'custodian_id, account_ref, and plaintext_key are required', 422);
    }

    if (body.plaintext_key === 'invalid-key') {
      return mockError('custodian_key_invalid', 'Key rejected by custodian', 422);
    }

    const newLink: CustodianLink = {
      custodian_link_id: `clink-${Date.now()}`,
      org_id: SUPPLIER_ORG_ID,
      custodian_id: body.custodian_id,
      account_ref: body.account_ref,
      status: 'active',
      created_at: new Date().toISOString(),
    };
    mockCustodians = [...mockCustodians, newLink];
    return HttpResponse.json(newLink, { status: 201 });
  }),
];
