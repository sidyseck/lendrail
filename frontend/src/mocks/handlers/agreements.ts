// src/mocks/handlers/agreements.ts
//
// MSW handler URL convention: paths must include the full /api prefix
// (e.g. '/api/connections/:id/agreement') because MSW intercepts at network level.

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { Agreement } from '@/types/agreement';

// ── Seed data ──────────────────────────────────────────────────────────────────

const INITIAL_AGREEMENTS: Agreement[] = [
  {
    agreement_id: 'agr-001',
    connection_id: 'conn-002',
    version: 1,
    assets_in_scope: ['BTC'],
    eligible_collateral: ['USDC'],
    initial_ltv_pct: '65.0000',
    margin_call_ltv_pct: '80.0000',
    liquidation_ltv_pct: '90.0000',
    recall_notice_days: 2,
    max_loan_days: 90,
    day_count_basis: 'actual_360',
    agent_fee_bps: 50,
    confirmed_by_supplier_at: null,
    confirmed_by_agent_at: null,
    status: 'pending_confirmation',
    created_at: '2026-06-08T00:00:00Z',
  },
];

let mockAgreements: Agreement[] = [...INITIAL_AGREEMENTS.map((a) => ({ ...a }))];
let nextVersion = 2;

export function resetMockAgreements(): void {
  mockAgreements = [...INITIAL_AGREEMENTS.map((a) => ({ ...a }))];
  nextVersion = 2;
}

// ── Handlers ───────────────────────────────────────────────────────────────────

export const agreementsHandlers = [
  // GET /api/connections/:connectionId/agreement — returns head (latest) agreement
  http.get('/api/connections/:connectionId/agreement', async ({ params }) => {
    await delay(20);
    const connectionId = params.connectionId as string;
    // Find the latest version for this connection
    const connectionAgreements = mockAgreements
      .filter((a) => a.connection_id === connectionId)
      .sort((a, b) => b.version - a.version);
    if (connectionAgreements.length === 0) {
      return mockError('not_found', 'No agreement found for this connection', 404);
    }
    return HttpResponse.json(connectionAgreements[0]);
  }),

  // POST /api/connections/:connectionId/agreement — create new agreement
  http.post('/api/connections/:connectionId/agreement', async ({ params, request }) => {
    await delay(20);
    const connectionId = params.connectionId as string;

    // 409 if agreement already exists
    const existing = mockAgreements.find((a) => a.connection_id === connectionId);
    if (existing) {
      return mockError(
        'pending_agreement_exists',
        'A pending agreement already exists for this connection',
        409,
      );
    }

    const body = (await request.json()) as {
      assets_in_scope?: unknown;
      eligible_collateral?: unknown;
      initial_ltv_pct?: unknown;
      margin_call_ltv_pct?: unknown;
      liquidation_ltv_pct?: unknown;
      recall_notice_days?: unknown;
      max_loan_days?: unknown;
      day_count_basis?: unknown;
      agent_fee_bps?: unknown;
    };

    if (!body.assets_in_scope || !body.day_count_basis) {
      return mockError('validation_error', 'Missing required fields', 422);
    }

    const newAgreement: Agreement = {
      agreement_id: `agr-${Date.now()}`,
      connection_id: connectionId,
      version: 1,
      assets_in_scope: body.assets_in_scope as string[],
      eligible_collateral: body.eligible_collateral as string[],
      initial_ltv_pct: String(body.initial_ltv_pct),
      margin_call_ltv_pct: String(body.margin_call_ltv_pct),
      liquidation_ltv_pct: String(body.liquidation_ltv_pct),
      recall_notice_days: Number(body.recall_notice_days),
      max_loan_days: Number(body.max_loan_days),
      day_count_basis: body.day_count_basis as 'actual_360' | 'actual_365',
      agent_fee_bps: Number(body.agent_fee_bps),
      confirmed_by_supplier_at: null,
      confirmed_by_agent_at: null,
      status: 'pending_confirmation',
      created_at: new Date().toISOString(),
    };
    mockAgreements = [...mockAgreements, newAgreement];
    return HttpResponse.json(newAgreement, { status: 201 });
  }),

  // POST /api/agreements/:agreementId/confirm — confirm agreement
  http.post('/api/agreements/:agreementId/confirm', async ({ params, request }) => {
    await delay(20);
    const agreementId = params.agreementId as string;

    // Read Authorization header to determine role
    const authHeader = (request.headers.get('Authorization') ?? '').toLowerCase();
    const isAgent = authHeader.includes('agent') || authHeader.length > 0; // simplified role detection

    const agreement = mockAgreements.find((a) => a.agreement_id === agreementId);
    if (!agreement) {
      return mockError('not_found', 'Agreement not found', 404);
    }

    // Use a simple heuristic: if already confirmed by both, it's superseded detection territory
    // For test purposes, check if specific test IDs are used
    if (agreementId === 'agr-already-confirmed') {
      return mockError('already_confirmed', 'You have already confirmed this agreement', 409);
    }
    if (agreementId === 'agr-superseded') {
      return mockError(
        'agreement_superseded',
        'This agreement has been superseded by a newer version',
        409,
      );
    }

    // Determine if this is a supplier or agent confirmation based on what's already set
    let updated: Agreement;
    if (agreement.confirmed_by_supplier_at === null) {
      updated = {
        ...agreement,
        confirmed_by_supplier_at: new Date().toISOString(),
      };
    } else {
      updated = {
        ...agreement,
        confirmed_by_agent_at: new Date().toISOString(),
      };
    }

    // If both confirmed, set to active
    if (updated.confirmed_by_supplier_at && updated.confirmed_by_agent_at) {
      updated = { ...updated, status: 'active' };
    }

    // Suppress unused variable warning — isAgent is kept for future role-based logic
    void isAgent;

    mockAgreements = mockAgreements.map((a) =>
      a.agreement_id === agreementId ? updated : a,
    );
    return HttpResponse.json(updated, { status: 200 });
  }),

  // PUT /api/agreements/:agreementId — amend agreement (creates new version)
  http.put('/api/agreements/:agreementId', async ({ params, request }) => {
    await delay(20);
    const agreementId = params.agreementId as string;
    const agreement = mockAgreements.find((a) => a.agreement_id === agreementId);

    if (!agreement) {
      return mockError('not_found', 'Agreement not found', 404);
    }

    const body = (await request.json()) as {
      assets_in_scope?: unknown;
      eligible_collateral?: unknown;
      initial_ltv_pct?: unknown;
      margin_call_ltv_pct?: unknown;
      liquidation_ltv_pct?: unknown;
      recall_notice_days?: unknown;
      max_loan_days?: unknown;
      day_count_basis?: unknown;
      agent_fee_bps?: unknown;
    };

    const newVersion: Agreement = {
      agreement_id: `agr-${Date.now()}`,
      connection_id: agreement.connection_id,
      version: nextVersion++,
      assets_in_scope: body.assets_in_scope as string[],
      eligible_collateral: body.eligible_collateral as string[],
      initial_ltv_pct: String(body.initial_ltv_pct),
      margin_call_ltv_pct: String(body.margin_call_ltv_pct),
      liquidation_ltv_pct: String(body.liquidation_ltv_pct),
      recall_notice_days: Number(body.recall_notice_days),
      max_loan_days: Number(body.max_loan_days),
      day_count_basis: body.day_count_basis as 'actual_360' | 'actual_365',
      agent_fee_bps: Number(body.agent_fee_bps),
      confirmed_by_supplier_at: null,
      confirmed_by_agent_at: null,
      status: 'pending_confirmation',
      created_at: new Date().toISOString(),
    };
    mockAgreements = [...mockAgreements, newVersion];
    return HttpResponse.json(newVersion, { status: 201 });
  }),

  // GET /api/connections/:connectionId/agreement/history — all versions
  http.get(
    '/api/connections/:connectionId/agreement/history',
    async ({ params }) => {
      await delay(20);
      const connectionId = params.connectionId as string;
      const connectionAgreements = mockAgreements
        .filter((a) => a.connection_id === connectionId)
        .sort((a, b) => a.version - b.version);
      return HttpResponse.json({ agreements: connectionAgreements });
    },
  ),
];
