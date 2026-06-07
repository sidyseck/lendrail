// src/mocks/handlers/register.ts

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';

// Mock JWTs with far-future exp for both roles.
const SUPPLIER_REG_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // { sub: "user-003", org_id: "org-003", role: "supplier", exp: 9999999999 }
  'eyJzdWIiOiJ1c2VyLTAwMyIsIm9yZ19pZCI6Im9yZy0wMDMiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-signature';

const AGENT_REG_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // { sub: "user-004", org_id: "org-004", role: "agent", exp: 9999999999 }
  'eyJzdWIiOiJ1c2VyLTAwNCIsIm9yZ19pZCI6Im9yZy0wMDQiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-signature';

const DUPLICATE_EMAIL = 'duplicate@lendrail.test';
const TRIGGER_422_EMAIL = 'invalid422@lendrail.test';

export const registerHandlers = [
  // POST /api/orgs/register/supplier
  http.post('/api/orgs/register/supplier', async ({ request }) => {
    await delay(20);

    const body = (await request.json()) as Record<string, unknown>;

    if (body.contact_email === DUPLICATE_EMAIL) {
      return mockError('duplicate_email', 'An organization with that email already exists', 409);
    }

    if (body.contact_email === TRIGGER_422_EMAIL) {
      return mockError('validation_error', 'Validation failed on one or more fields', 422);
    }

    return HttpResponse.json(
      {
        org_id: 'org-003',
        access_token: SUPPLIER_REG_TOKEN,
        token_type: 'bearer',
      },
      { status: 201 },
    );
  }),

  // POST /api/orgs/register/agent
  http.post('/api/orgs/register/agent', async ({ request }) => {
    await delay(20);

    const body = (await request.json()) as Record<string, unknown>;

    if (body.contact_email === DUPLICATE_EMAIL) {
      return mockError('duplicate_email', 'An organization with that email already exists', 409);
    }

    if (body.contact_email === TRIGGER_422_EMAIL) {
      return mockError('validation_error', 'Validation failed on one or more fields', 422);
    }

    if (body.regulatory_status_attested === false) {
      return mockError(
        'attestation_required',
        'Regulatory status attestation is required for agent registration',
        422,
      );
    }

    return HttpResponse.json(
      {
        org_id: 'org-004',
        access_token: AGENT_REG_TOKEN,
        token_type: 'bearer',
      },
      { status: 201 },
    );
  }),
];
