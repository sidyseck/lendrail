import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';

// Tokens below are 3-segment JWTs with a decodable payload (far-future exp).
// Header: { alg: HS256, typ: JWT }
const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // { sub: "user-001", org_id: "org-001", role: "agent", exp: 9999999999 }
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-signature';

const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // { sub: "user-002", org_id: "org-002", role: "supplier", exp: 9999999999 }
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-signature';

export const authHandlers = [
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };

    // Small artificial latency so callers can observe the in-flight (loading) state.
    await delay(20);

    if (body.email === 'agent@lendrail.test' && body.password === 'password') {
      return HttpResponse.json(
        { access_token: AGENT_TOKEN, token_type: 'bearer' },
        { status: 200 },
      );
    }

    if (
      body.email === 'supplier@lendrail.test' &&
      body.password === 'password'
    ) {
      return HttpResponse.json(
        { access_token: SUPPLIER_TOKEN, token_type: 'bearer' },
        { status: 200 },
      );
    }

    // FIX 5: wrong credentials — MUST mirror the backend response exactly.
    // The real API returns { error: { code: "unauthorized", message: "invalid_credentials" } }
    // (verified against backend/app/core/errors.py + auth_service AuthError).
    return mockError('unauthorized', 'invalid_credentials', 401);
  }),
];
