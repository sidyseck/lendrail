// src/mocks/handlers/custodians.ts

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { CustodianLink } from '@/api/custodiansApi';
import type { CustodianInventoryResponse } from '@/api/inventoryApi';

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

const STALE_THRESHOLD_MS = 3_600_000; // 1 hour — matches VITE_FEED_STALENESS_THRESHOLD_SECONDS default

const MOCK_INVENTORY: Record<string, CustodianInventoryResponse> = {
  'clink-001': {
    custodian_link_id: 'clink-001',
    account_ref: 'vault-123',
    positions: [
      {
        asset_type: 'BTC',
        quantity: '500.0',
        as_of: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago — fresh
      },
      {
        asset_type: 'ETH',
        quantity: '2000.0',
        as_of: new Date(Date.now() - 67 * 60 * 1000).toISOString(), // 67 min ago — stale
      },
    ],
  },
};

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

  // ── GET /api/custodians/:id/inventory ──────────────────────────────────────
  http.get('/api/custodians/:custodian_link_id/inventory', async ({ params }) => {
    await delay(20);
    const id = params.custodian_link_id as string;
    const link = mockCustodians.find((c) => c.custodian_link_id === id);
    if (!link) return mockError('not_found', 'Custodian link not found', 404);

    const data = MOCK_INVENTORY[id] ?? {
      custodian_link_id: id,
      account_ref: link.account_ref,
      positions: [],
    };
    return HttpResponse.json(data, { status: 200 });
  }),
];

export { STALE_THRESHOLD_MS };
