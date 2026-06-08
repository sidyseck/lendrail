// src/mocks/handlers/connections.ts

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { Connection, TerminateResponse, InviteUnknownAgentResponse } from '@/types/connection';

const SUPPLIER_ORG_ID = 'org-001';
const AGENT_ORG_ID    = 'org-002';

const INITIAL_CONNECTIONS: Connection[] = [
  {
    connection_id: 'conn-001',
    supplier_id:   SUPPLIER_ORG_ID,
    agent_id:      AGENT_ORG_ID,
    status:        'pending',
    created_at:    '2026-06-08T00:00:00Z',
    activated_at:  null,
    pending_agreement: false,
  },
  {
    connection_id: 'conn-002',
    supplier_id:   SUPPLIER_ORG_ID,
    agent_id:      'org-003',
    status:        'active',
    created_at:    '2026-06-01T00:00:00Z',
    activated_at:  '2026-06-02T00:00:00Z',
    pending_agreement: true,
  },
];

let mockConnections: Connection[] = [...INITIAL_CONNECTIONS.map(c => ({ ...c }))];

export function resetMockConnections(): void {
  mockConnections = [...INITIAL_CONNECTIONS.map(c => ({ ...c }))];
}

const UNKNOWN_AGENT_EMAIL = 'unknown@notregistered.test';
const TERMINATED_CONN_ID  = 'conn-terminated';

export const connectionsHandlers = [
  // ── GET /api/connections ───────────────────────────────────────────────────
  http.get('/api/connections', async () => {
    await delay(20);
    return HttpResponse.json({ connections: mockConnections });
  }),

  // ── POST /api/connections/invite ───────────────────────────────────────────
  http.post('/api/connections/invite', async ({ request }) => {
    await delay(20);
    const body = (await request.json()) as {
      agent_email?: string;
      agent_org_id?: string;
    };

    if (body.agent_email && body.agent_email === UNKNOWN_AGENT_EMAIL) {
      const resp: InviteUnknownAgentResponse = {
        message: 'Invitation logged; agent email is not yet registered on the platform',
        agent_email: body.agent_email,
      };
      return HttpResponse.json(resp, { status: 202 });
    }

    if (body.agent_org_id === AGENT_ORG_ID) {
      const existing = mockConnections.find(
        (c) => c.agent_id === AGENT_ORG_ID && c.status !== 'terminated',
      );
      if (existing) {
        return mockError('connection_already_exists', 'A connection between these organizations already exists', 409);
      }
    }

    if (!body.agent_email && !body.agent_org_id) {
      return mockError('validation_error', 'Provide either agent_org_id or agent_email', 422);
    }

    const newConn: Connection = {
      connection_id: `conn-${Date.now()}`,
      supplier_id:   SUPPLIER_ORG_ID,
      agent_id:      body.agent_org_id ?? 'org-unknown',
      status:        'pending',
      created_at:    new Date().toISOString(),
      activated_at:  null,
    };
    mockConnections = [...mockConnections, newConn];
    return HttpResponse.json(newConn, { status: 201 });
  }),

  // ── POST /api/connections/:id/accept — transitions pending → active ────────
  http.post('/api/connections/:connection_id/accept', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;
    const conn = mockConnections.find((c) => c.connection_id === id);

    if (!conn) return mockError('not_found', 'Connection not found', 404);
    if (conn.status !== 'pending') {
      return mockError('invalid_connection_status', `Connection is in '${conn.status}' status; only pending connections can be accepted`, 409);
    }

    const updated: Connection = {
      ...conn,
      status: 'active',
      activated_at: new Date().toISOString(),
    };
    mockConnections = mockConnections.map((c) => c.connection_id === id ? updated : c);
    return HttpResponse.json(updated, { status: 200 });
  }),

  // ── POST /api/connections/:id/suspend ──────────────────────────────────────
  http.post('/api/connections/:connection_id/suspend', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;

    if (id === TERMINATED_CONN_ID) {
      return mockError('invalid_connection_status', "Connection is in 'terminated' status; only active connections can be suspended", 409);
    }

    const conn = mockConnections.find((c) => c.connection_id === id);
    if (!conn) return mockError('not_found', 'Connection not found', 404);
    if (conn.status !== 'active') {
      return mockError('invalid_connection_status', `Connection is in '${conn.status}' status; only active connections can be suspended`, 409);
    }

    const updated: Connection = { ...conn, status: 'suspended' };
    mockConnections = mockConnections.map((c) => c.connection_id === id ? updated : c);
    return HttpResponse.json(updated, { status: 200 });
  }),

  // ── POST /api/connections/:id/reactivate ───────────────────────────────────
  http.post('/api/connections/:connection_id/reactivate', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;
    const conn = mockConnections.find((c) => c.connection_id === id);
    if (!conn) return mockError('not_found', 'Connection not found', 404);
    if (conn.status !== 'suspended') {
      return mockError('invalid_connection_status', `Connection is in '${conn.status}' status; only suspended connections can be reactivated`, 409);
    }

    const updated: Connection = { ...conn, status: 'active' };
    mockConnections = mockConnections.map((c) => c.connection_id === id ? updated : c);
    return HttpResponse.json(updated, { status: 200 });
  }),

  // ── POST /api/connections/:id/terminate ────────────────────────────────────
  http.post('/api/connections/:connection_id/terminate', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;
    const conn = mockConnections.find((c) => c.connection_id === id);
    if (!conn) return mockError('not_found', 'Connection not found', 404);
    if (conn.status === 'terminated') {
      return mockError('connection_already_terminated', 'Connection is already terminated', 409);
    }

    const updated: Connection = { ...conn, status: 'terminated' };
    mockConnections = mockConnections.map((c) => c.connection_id === id ? updated : c);

    const resp: TerminateResponse = {
      connection_id: id,
      status: 'terminated',
      flagged_loan_ids: [],
      message: 'Connection terminated.',
    };
    return HttpResponse.json(resp, { status: 200 });
  }),
];
