# LendRail M2 — Frontend Tech Spec

| Field | Value |
|---|---|
| Milestone | M2 — Connection (frontend only) |
| Version | rev 1 |
| Date | 2026-06-08 |
| Status | Draft — awaiting tech-lead review |
| Author | Frontend engineering |
| Covers | F-027 (Connection management UI) |
| Architecture ref | ARCHITECTURE.md v0.2 |
| PRD ref | MASTER_PRD.md v0.1 |
| M1 spec ref | specs/M1-frontend-techspec.md (rev 2) |
| Backend contract ref | specs/M2-backend-techspec.md (rev 2) |

---

## §1 — Scope

This spec covers **F-027 — Connection management UI** exclusively. All M0/M1 pages and hooks remain unchanged.

**What F-027 delivers:**

Two role-specific views at the same route `/dashboard/connections`:

- **Supplier view** — list connections, invite an agent, register a custodian key once a connection is accepted, suspend or terminate a connection.
- **Agent view** — list connections, accept pending invitations.

The route is behind `ProtectedRoute`. The correct view is selected at runtime by reading the `role` claim from `AuthContext` (decoded from the in-memory JWT). The JWT is never read from or written to `localStorage`.

**What this spec does NOT cover:**

- Connection scope configuration UI (which custodian accounts/assets are in scope) — deferred per FEATURES.md.
- Key rotation UI — out of scope for M2.
- Any M3+ features.

---

## §2 — New Routes and Pages Added to App.tsx

### §2.1 — Updated `src/App.tsx`

`/dashboard/connections` is a protected route. It is added as a child of the existing `/dashboard` parent. `DashboardPage` is updated to render the connections sub-route. The `ProtectedRoute` wrapper already covers the `/dashboard` prefix — no additional wrapper is needed.

The cleanest M2 approach uses a nested route: `/dashboard/connections` is handled by a separate `<Route>` inside the `/dashboard` subtree. `DashboardPage` renders an `<Outlet />` so child routes render within the existing nav shell.

```tsx
// src/App.tsx — updated for M2

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SupplierRegisterPage } from './pages/SupplierRegisterPage';
import { AgentRegisterPage } from './pages/AgentRegisterPage';
import { ConnectionsPage } from './pages/connections/ConnectionsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register/supplier" element={<SupplierRegisterPage />} />
          <Route path="/register/agent" element={<AgentRegisterPage />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          >
            {/* M2: connections sub-route */}
            <Route path="connections" element={<ConnectionsPage />} />
          </Route>

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {/* Catch-all — must be last */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

### §2.2 — New Files

| File | Route | Purpose |
|---|---|---|
| `src/pages/connections/ConnectionsPage.tsx` | `/dashboard/connections` | Role-dispatch: renders `SupplierConnectionsPage` or `AgentConnectionsPage` based on `role` from `AuthContext` |
| `src/pages/connections/SupplierConnectionsPage.tsx` | — (rendered by ConnectionsPage) | Supplier connection list + invite + key registration + suspend/terminate |
| `src/pages/connections/AgentConnectionsPage.tsx` | — (rendered by ConnectionsPage) | Agent connection list + accept |
| `src/hooks/useConnections.ts` | — | Fetches `GET /api/connections`; returns list, loading, error |
| `src/hooks/useConnectionAction.ts` | — | Wraps all POST actions; handles loading + error envelope |
| `src/mocks/handlers/connections.ts` | — | MSW handlers for all connection endpoints |
| `src/test/SupplierConnectionsPage.test.tsx` | — | F-027 supplier acceptance criteria |
| `src/test/AgentConnectionsPage.test.tsx` | — | F-027 agent acceptance criteria |

### §2.3 — Updated Files

| File | Change |
|---|---|
| `src/App.tsx` | Add `/dashboard/connections` nested route (shown above) |
| `src/pages/DashboardPage.tsx` | Add `<Outlet />` and nav link to `/dashboard/connections` |
| `src/mocks/browser.ts` | Spread `connectionsHandlers` |
| `src/mocks/server.ts` | Spread `connectionsHandlers` |
| `frontend/openapi.json` | Add connection endpoint path items (§9) |
| `src/api/types.gen.ts` | Regenerate after `openapi.json` update |

---

## §3 — Shared Infrastructure

### §3.1 — `DashboardPage` update

`DashboardPage` must render `<Outlet />` to host the nested `/dashboard/connections` route. It also receives a nav link to connections (visible to both suppliers and agents).

```tsx
// src/pages/DashboardPage.tsx — M2 update

import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';

export function DashboardPage() {
  const { role, logout } = useAuth();
  const location = useLocation();
  const onConnections = location.pathname.startsWith('/dashboard/connections');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">LendRail</span>
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard/connections"
              className={`text-sm ${onConnections ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Connections
            </Link>
            {role && (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-600">
                {role}
              </span>
            )}
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Child routes render here; fallback content for /dashboard itself */}
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

### §3.2 — TypeScript types

The shared connection type derived from `ConnectionResponse` in the backend schema (`app/schemas/connections.py`). Field names must match exactly:

```ts
// src/types/connection.ts — shared across supplier and agent pages

export interface Connection {
  connection_id: string;         // UUID
  supplier_id: string;           // UUID
  agent_id: string;              // UUID
  status: ConnectionStatus;
  custodian_link_present: boolean;
  created_at: string;            // ISO-8601
  activated_at: string | null;   // ISO-8601 or null
}

export type ConnectionStatus =
  | 'pending'
  | 'accepted'
  | 'active'
  | 'suspended'
  | 'terminated';

// HTTP 202 response for unknown-agent invite
export interface InviteUnknownAgentResponse {
  message: string;
  agent_email: string;
}

// HTTP 201 response for known-agent invite — same shape as ConnectionResponse
// (connection_id, supplier_id, agent_id, status, custodian_link_present, created_at, activated_at)

export interface TerminateResponse {
  connection_id: string;
  status: 'terminated';
  flagged_loan_ids: string[];
  message: string;
}
```

### §3.3 — `useConnections()` hook

```ts
// src/hooks/useConnections.ts

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { Connection } from '@/types/connection';

export interface UseConnectionsReturn {
  connections: Connection[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useConnections(): UseConnectionsReturn {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: apiError, response } = await apiClient.GET('/connections');
      if (!response.ok || apiError || !data) {
        const errBody = apiError as { error?: { message?: string } } | undefined;
        setError(errBody?.error?.message ?? 'Failed to load connections.');
        return;
      }
      setConnections(
        (data as { connections: Connection[] }).connections ?? [],
      );
    } catch {
      setError('An unexpected error occurred while loading connections.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  return { connections, isLoading, error, refetch: fetchConnections };
}
```

**Key design decisions:**

| Decision | Rationale |
|---|---|
| `refetch` returned from hook | Callers (pages) call `refetch()` after a successful action to update the list without a full page reload |
| Loading starts `true` | Avoids empty-list flash on first render before the first fetch resolves |
| Error extracted from `{error:{code,message}}` envelope | Matches backend hard constraint — all errors use this shape |

### §3.4 — `useConnectionAction()` hook

Wraps all POST actions. Returns `{ execute, isLoading, error, clearError }`. Callers supply a callback to run after a successful action (typically `refetch`).

```ts
// src/hooks/useConnectionAction.ts

import { useState } from 'react';

export interface UseConnectionActionReturn<T> {
  execute: (fn: () => Promise<T>) => Promise<T | null>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useConnectionAction<T = void>(): UseConnectionActionReturn<T> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function execute(fn: () => Promise<T>): Promise<T | null> {
    setIsLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  return { execute, isLoading, error, clearError: () => setError(null) };
}
```

The calling page wraps each API call in a helper function that throws on error (extracts message from the `{error:{code,message}}` envelope before throwing), then passes that function to `execute()`. This keeps envelope-parsing in one place per action call site, not in the generic hook.

**Action helper pattern** used inside page components:

```ts
async function callApi(
  fn: () => Promise<Response>,
): Promise<void> {
  const response = await fn();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const msg = body?.error?.message ?? 'Request failed.';
    throw new Error(msg);
  }
}
```

In practice the pages use `apiClient.POST(...)` which returns `{ data, error, response }`. Error extraction is done inline within each page action before calling `execute()`. See §4 and §5 for the concrete implementations.

---

## §4 — SupplierConnectionsPage (`/dashboard/connections` for suppliers)

### §4.1 — Component Tree

```
SupplierConnectionsPage
├── <h1>Connections</h1>
├── <Button> "Invite Agent" → opens InviteModal
├── {isLoading} → loading spinner / skeleton
├── {error} → <p role="alert">{error}</p>
├── <ConnectionTable>
│   └── per connection row:
│       ├── agent_id (truncated UUID or org name if available)
│       ├── <StatusBadge status={connection.status} />
│       ├── created_at (formatted date)
│       ├── {status === 'accepted'} → <Button>"Register Custodian Key"</Button>
│       │   → opens RegisterKeyModal for this connection
│       ├── {status === 'active' || 'accepted'} → <Button>"Suspend"</Button>
│       └── {status !== 'terminated'} → <Button>"Terminate"</Button>
├── <InviteModal> (conditionally rendered)
└── <RegisterKeyModal> (conditionally rendered, one per open dialog)
```

`InviteModal` and `RegisterKeyModal` are local components defined in `SupplierConnectionsPage.tsx` (not separate files) to keep F-027 changes self-contained.

### §4.2 — StatusBadge Component

A pure presentational component. Defined in `src/components/StatusBadge.tsx` so it can be reused by the agent page and future M3+ pages.

```tsx
// src/components/StatusBadge.tsx

import type { ConnectionStatus } from '@/types/connection';

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  pending:    'bg-yellow-100 text-yellow-800',
  accepted:   'bg-blue-100 text-blue-800',
  active:     'bg-green-100 text-green-800',
  suspended:  'bg-orange-100 text-orange-800',
  terminated: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
```

**Status badge colour mapping:**

| Status | Background | Text |
|---|---|---|
| `pending` | yellow-100 | yellow-800 |
| `accepted` | blue-100 | blue-800 |
| `active` | green-100 | green-800 |
| `suspended` | orange-100 | orange-800 |
| `terminated` | red-100 | red-800 |

### §4.3 — Invite Modal: agent_email XOR agent_org_id

The backend `InviteConnectionRequest` requires exactly one of `agent_email` or `agent_org_id` (enforced by `model_validator`). The UI presents a radio toggle so the user picks which identifier to supply. Only one input field is shown at a time.

```
InviteModal
├── <h2>Invite Agent</h2>
├── Radio group:
│   ├── ○ "By email"      → shows agent_email <Input>
│   └── ○ "By org ID"     → shows agent_org_id <Input>
├── {actionError} → <p role="alert">{actionError}</p>
├── <Button type="submit" disabled={isActionLoading}>Send Invitation</Button>
└── <Button onClick={closeModal}>Cancel</Button>
```

**Validation (client-side, on submit):**
- The active input must be non-empty.
- If `agent_email` mode: validate email format (reuse `validateEmail` from `src/lib/validators.ts`).
- If `agent_org_id` mode: must be a non-empty string (UUID format check is optional — the backend validates).

**Submit flow:**

```
POST /api/connections/invite
  body: { agent_email: string }         (email mode)
  OR    { agent_org_id: string }        (org ID mode)

→ 201: ConnectionResponse — close modal, refetch, add new row to list
→ 202: InviteUnknownAgentResponse — close modal, show banner:
         "Invite sent to {agent_email}. They will receive instructions when they register."
→ 409: Show error in modal: extracted error.message
→ 422: Show error in modal: extracted error.message
→ other: "Request failed. Please try again."
```

The 201 and 202 paths are distinguished by `response.status`. The `202` case never creates a connection row (no `connection_id` returned), so `refetch` is called but the list is unchanged.

### §4.4 — Register Key Modal

Shown when the supplier clicks "Register Custodian Key" on a connection with `status === 'accepted'`. Scoped to a specific `connection_id`.

```
RegisterKeyModal
├── <h2>Register Custodian Key</h2>
├── <p>Connection: {connection_id}</p>
├── FormField: custodian_id (text, label "Custodian ID")
├── FormField: account_ref (text, label "Account Reference")
├── FormField: plaintext_key (PASSWORD INPUT — type="password", label "API Key")
│   autoComplete="new-password"
│   NOTE: type="password" prevents browser password manager from logging/auto-filling
├── {actionError} → <p role="alert">{actionError}</p>
├── <Button type="submit" disabled={isActionLoading}>Register Key</Button>
└── <Button onClick={closeModal}>Cancel</Button>
```

**HARD CONSTRAINT:** `plaintext_key` input MUST use `type="password"`. This prevents the browser from autocompleting from saved passwords, logging the value in browser history, or surfacing it in autofill dropdowns. `autoComplete="new-password"` is also set.

**Validation (client-side):**
- `custodian_id`: required, non-empty.
- `account_ref`: required, non-empty.
- `plaintext_key`: required, non-empty (the backend requires `min_length=1`).

**Submit flow:**

```
POST /api/connections/{connection_id}/custodian-key
  body: { custodian_id, account_ref, plaintext_key }

→ 200: ConnectionResponse (status="active") — close modal, refetch
→ 422: code="custodian_key_invalid" → show "Key rejected by custodian. Check the key and try again."
→ 409: code="invalid_connection_status" → show error.message
→ other: extracted error.message or generic fallback
```

### §4.5 — Suspend / Terminate Confirmation

**Design decision:** Use `window.confirm()` for the MVP confirmation step. This avoids adding a third modal component. An inline confirm pattern (show a confirmation row inline) is explicitly called out as a future UX improvement in §10 (Open Decisions).

```ts
// Suspend action
async function handleSuspend(connectionId: string) {
  const ok = window.confirm(
    'Suspend this connection? The connection can be reactivated by registering a key again.',
  );
  if (!ok) return;
  await execute(async () => {
    const { response, error: apiError } = await apiClient.POST(
      '/connections/{connection_id}/suspend' as never,
      { params: { path: { connection_id: connectionId } } },
    );
    if (!response.ok) {
      const body = apiError as { error?: { message?: string } } | undefined;
      throw new Error(body?.error?.message ?? 'Failed to suspend connection.');
    }
  });
  refetch();
}

// Terminate action
async function handleTerminate(connectionId: string) {
  const ok = window.confirm(
    'Terminate this connection? This cannot be undone. You must rotate the custodian API key manually.',
  );
  if (!ok) return;
  await execute(async () => {
    const { response, error: apiError } = await apiClient.POST(
      '/connections/{connection_id}/terminate' as never,
      { params: { path: { connection_id: connectionId } } },
    );
    if (!response.ok) {
      const body = apiError as { error?: { message?: string } } | undefined;
      throw new Error(body?.error?.message ?? 'Failed to terminate connection.');
    }
  });
  refetch();
}
```

The `window.confirm` calls are mockable in tests via `vi.spyOn(window, 'confirm').mockReturnValue(true)`.

### §4.6 — Button Visibility Rules

| Connection status | "Register Key" shown | "Suspend" shown | "Terminate" shown |
|---|---|---|---|
| `pending` | No | No | Yes |
| `accepted` | Yes | No | Yes |
| `active` | No | Yes | Yes |
| `suspended` | No | No | Yes |
| `terminated` | No | No | No |

**Rationale:** `pending` connections can be terminated (abandoned) but not suspended (no active relationship yet). `accepted` connections need a key before they are active. `suspended` connections cannot be re-suspended but can be terminated. `terminated` connections are done — no further actions.

### §4.7 — Full SupplierConnectionsPage Outline

```tsx
// src/pages/connections/SupplierConnectionsPage.tsx

// State:
// - inviteOpen: boolean
// - registerKeyTarget: Connection | null  (which connection's modal is open)
// - inviteBanner: string | null           (202 "invite sent" message)
// - inviteMode: 'email' | 'org_id'
// - inviteValue: string
// - keyFields: { custodian_id, account_ref, plaintext_key }

// Hooks:
// - useConnections() → { connections, isLoading, error, refetch }
// - useConnectionAction() → { execute, isLoading: actionLoading, error: actionError }

// Renders:
// 1. Page header + "Invite Agent" button
// 2. inviteBanner (if set)
// 3. Loading / error states for the list
// 4. Table: one row per connection (fields: agent_id, status badge, created_at, action buttons)
// 5. InviteModal (if inviteOpen)
// 6. RegisterKeyModal (if registerKeyTarget !== null)
```

---

## §5 — AgentConnectionsPage (`/dashboard/connections` for agents)

### §5.1 — Component Tree

```
AgentConnectionsPage
├── <h1>Connections</h1>
├── {isLoading} → loading spinner / skeleton
├── {error} → <p role="alert">{error}</p>
└── <ConnectionTable>
    └── per connection row:
        ├── supplier_id (truncated UUID)
        ├── <StatusBadge status={connection.status} />
        ├── created_at (formatted date)
        └── {status === 'pending'} → <Button>"Accept"</Button>
```

### §5.2 — Accept Flow

```
POST /api/connections/{connection_id}/accept

→ 200: ConnectionResponse (status="accepted") — refetch list
→ 409: code="invalid_connection_status" → inline error below the row
→ 403: "You are not authorized to accept this connection."
→ other: extracted error.message or generic fallback
```

**Error display:** Rather than a global error panel, action errors for agent accept are displayed as a `<p role="alert">` immediately below the row's accept button. This is more precise than a page-level error when the table has multiple rows. Implemented via per-row `errorMap: Record<string, string>` state.

### §5.3 — Full AgentConnectionsPage Outline

```tsx
// src/pages/connections/AgentConnectionsPage.tsx

// State:
// - rowErrors: Record<string, string>  (connection_id → error message)

// Hooks:
// - useConnections() → { connections, isLoading, error, refetch }
// - useConnectionAction() → { execute, isLoading: actionLoading }

// Per-row accept handler:
async function handleAccept(connectionId: string) {
  const result = await execute(async () => {
    const { response, error: apiError } = await apiClient.POST(
      '/connections/{connection_id}/accept' as never,
      { params: { path: { connection_id: connectionId } } },
    );
    if (!response.ok) {
      const body = apiError as { error?: { message?: string } } | undefined;
      throw new Error(body?.error?.message ?? 'Failed to accept connection.');
    }
  });
  if (result !== null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
    refetch();
  }
}
```

---

## §6 — Role-Based Routing

### §6.1 — `ConnectionsPage` (role dispatcher)

```tsx
// src/pages/connections/ConnectionsPage.tsx

import { useAuth } from '@/auth/AuthContext';
import { SupplierConnectionsPage } from './SupplierConnectionsPage';
import { AgentConnectionsPage } from './AgentConnectionsPage';

export function ConnectionsPage() {
  const { role } = useAuth();

  if (role === 'supplier') return <SupplierConnectionsPage />;
  if (role === 'agent') return <AgentConnectionsPage />;

  // Admin or unknown role — connections UI not defined for M2
  return (
    <p className="text-sm text-gray-500">
      Connection management is not available for your role.
    </p>
  );
}
```

**Design constraints:**
- `role` is read from `AuthContext`, which decodes it from the in-memory JWT using `jwtDecode`. The JWT is **never** read from `localStorage`.
- `AuthContext` already provides `role: 'supplier' | 'agent' | 'admin' | null`.
- The dispatch is a simple if/else — no complex routing or RBAC library needed for M2.
- `ProtectedRoute` already guards `/dashboard/*`, so an unauthenticated user will never reach `ConnectionsPage`.
- If `role` is `null` (which `ProtectedRoute` already blocks), the fallback message is shown defensively.

---

## §7 — MSW Handlers for Connection Endpoints

### §7.1 — `src/mocks/handlers/connections.ts`

All success responses include every field from the backend `ConnectionResponse` schema. All error responses use `mockError(code, message, status)` from `src/mocks/helpers.ts`.

**Seed data:**

```ts
// src/mocks/handlers/connections.ts

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { Connection, TerminateResponse, InviteUnknownAgentResponse } from '@/types/connection';

// ── Seed connections ──────────────────────────────────────────────────────────

const SUPPLIER_ORG_ID = 'org-001';
const AGENT_ORG_ID    = 'org-002';

// Mutable in-memory store so action handlers can mutate state
// and the list handler reflects changes within the same MSW session.
let mockConnections: Connection[] = [
  {
    connection_id: 'conn-001',
    supplier_id:   SUPPLIER_ORG_ID,
    agent_id:      AGENT_ORG_ID,
    status:        'pending',
    custodian_link_present: false,
    created_at:    '2026-06-08T00:00:00Z',
    activated_at:  null,
  },
  {
    connection_id: 'conn-002',
    supplier_id:   SUPPLIER_ORG_ID,
    agent_id:      'org-003',
    status:        'active',
    custodian_link_present: true,
    created_at:    '2026-06-01T00:00:00Z',
    activated_at:  '2026-06-02T00:00:00Z',
  },
];

// Email that triggers the 202 "unknown agent" path
const UNKNOWN_AGENT_EMAIL = 'unknown@notregistered.test';
// Connection ID that triggers 409 on suspend/terminate (already terminated)
const TERMINATED_CONN_ID  = 'conn-terminated';
// Connection ID that triggers 422 on custodian-key (key rejected)
const INVALID_KEY_CONN_ID = 'conn-key-invalid';

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

    // 202 unknown agent path
    if (body.agent_email && body.agent_email === UNKNOWN_AGENT_EMAIL) {
      const resp: InviteUnknownAgentResponse = {
        message: 'Invitation logged; agent email is not yet registered on the platform',
        agent_email: body.agent_email,
      };
      return HttpResponse.json(resp, { status: 202 });
    }

    // 409 duplicate
    if (body.agent_org_id === AGENT_ORG_ID) {
      const existing = mockConnections.find(
        (c) => c.agent_id === AGENT_ORG_ID && c.status !== 'terminated',
      );
      if (existing) {
        return mockError('connection_already_exists', 'A connection between these organizations already exists', 409);
      }
    }

    // 422 missing both fields
    if (!body.agent_email && !body.agent_org_id) {
      return mockError('validation_error', 'Provide either agent_org_id or agent_email', 422);
    }

    // 201 success — create and add to mock list
    const newConn: Connection = {
      connection_id: `conn-${Date.now()}`,
      supplier_id:   SUPPLIER_ORG_ID,
      agent_id:      body.agent_org_id ?? 'org-unknown',
      status:        'pending',
      custodian_link_present: false,
      created_at:    new Date().toISOString(),
      activated_at:  null,
    };
    mockConnections = [...mockConnections, newConn];
    return HttpResponse.json(newConn, { status: 201 });
  }),

  // ── POST /api/connections/:id/accept ───────────────────────────────────────
  http.post('/api/connections/:connection_id/accept', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;
    const conn = mockConnections.find((c) => c.connection_id === id);

    if (!conn) {
      return mockError('not_found', 'Connection not found', 404);
    }
    if (conn.status !== 'pending') {
      return mockError('invalid_connection_status', `Connection is in '${conn.status}' status; only pending connections can be accepted`, 409);
    }

    const updated: Connection = { ...conn, status: 'accepted' };
    mockConnections = mockConnections.map((c) =>
      c.connection_id === id ? updated : c,
    );
    return HttpResponse.json(updated, { status: 200 });
  }),

  // ── POST /api/connections/:id/custodian-key ────────────────────────────────
  http.post('/api/connections/:connection_id/custodian-key', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;

    if (id === INVALID_KEY_CONN_ID) {
      return mockError('custodian_key_invalid', 'The provided API key was rejected by the custodian', 422);
    }

    const conn = mockConnections.find((c) => c.connection_id === id);
    if (!conn) {
      return mockError('not_found', 'Connection not found', 404);
    }
    if (conn.status !== 'accepted' && conn.status !== 'suspended') {
      return mockError('invalid_connection_status', `Connection is in '${conn.status}' status; cannot register a key`, 409);
    }

    const updated: Connection = {
      ...conn,
      status: 'active',
      custodian_link_present: true,
      activated_at: new Date().toISOString(),
    };
    mockConnections = mockConnections.map((c) =>
      c.connection_id === id ? updated : c,
    );
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
    if (!conn) {
      return mockError('not_found', 'Connection not found', 404);
    }
    if (conn.status !== 'active') {
      return mockError('invalid_connection_status', `Connection is in '${conn.status}' status; only active connections can be suspended`, 409);
    }

    const updated: Connection = { ...conn, status: 'suspended' };
    mockConnections = mockConnections.map((c) =>
      c.connection_id === id ? updated : c,
    );
    return HttpResponse.json(updated, { status: 200 });
  }),

  // ── POST /api/connections/:id/terminate ────────────────────────────────────
  http.post('/api/connections/:connection_id/terminate', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;

    const conn = mockConnections.find((c) => c.connection_id === id);
    if (!conn) {
      return mockError('not_found', 'Connection not found', 404);
    }
    if (conn.status === 'terminated') {
      return mockError('connection_already_terminated', 'Connection is already terminated', 409);
    }

    const updated: Connection = { ...conn, status: 'terminated' };
    mockConnections = mockConnections.map((c) =>
      c.connection_id === id ? updated : c,
    );

    const resp: TerminateResponse = {
      connection_id: id,
      status: 'terminated',
      flagged_loan_ids: [],
      message:
        'Connection terminated. You must rotate the custodian API key at the custodian to revoke agent access.',
    };
    return HttpResponse.json(resp, { status: 200 });
  }),
];
```

### §7.2 — Updated `src/mocks/browser.ts`

```ts
import { setupWorker } from 'msw/browser';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';

export const worker = setupWorker(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
);
```

### §7.3 — Updated `src/mocks/server.ts`

```ts
import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';

export const server = setupServer(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
);
```

**Note on mutable `mockConnections`:** The in-memory array is reset at the module level on each Vitest test file load. If cross-test state leakage is observed, add a `beforeEach` reset in `src/test/setup.ts` by exporting a `resetMockConnections()` function from the handler file. This is called out in §10 (Open Decisions, D-4).

---

## §8 — Tests (Vitest + RTL)

Both test files follow the same patterns established in M1: `MemoryRouter`, `useNavigate` mocked via `vi.mock`, `AuthProvider` wrapper, `userEvent.setup()`, `waitFor` for async assertions. MSW server lifecycle is already in `src/test/setup.ts`.

**Auth wrapper helper** (shared by both test files via a local helper):

```tsx
function renderWithAuth(ui: React.ReactElement, role: 'supplier' | 'agent') {
  // Inject a mock token into tokenStore so AuthContext hydrates with the given role
  const payload = btoa(
    JSON.stringify({ sub: 'user-001', org_id: 'org-001', role, exp: 9999999999 }),
  );
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.mock-sig`;
  // tokenStore.setToken is called before render so AuthContext initializes correctly
  import('@/auth/tokenStore').then(({ setToken }) => setToken(token));

  return render(
    <MemoryRouter initialEntries={['/dashboard/connections']}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}
```

### §8.1 — `src/test/SupplierConnectionsPage.test.tsx`

```
describe('SupplierConnectionsPage', () => {

  // F-027 AC: Supplier dashboard lists all connections with their current status
  it('renders connection list with status badges')
  it('shows loading state before connections load')
  it('shows error state when GET /connections fails')

  // F-027 AC: Supplier can click "Invite Agent" → enters agent email → sees new pending row
  it('opens invite modal when "Invite Agent" is clicked')
  it('shows validation error when invite submitted with no value')
  it('shows validation error for invalid email format in email mode')
  it('adds a new pending connection row after successful 201 invite (by email)')
  it('adds a new pending connection row after successful 201 invite (by org ID)')
  it('shows 202 banner message when invite sent to unknown agent email')
  it('shows 409 error inside modal for duplicate invite')

  // F-027 AC: After agent accepts, supplier sees "Register Custodian Key" prompt
  it('shows "Register Custodian Key" button only for accepted connections')
  it('does not show "Register Custodian Key" for pending connections')

  // F-027 AC: Entering key and submitting shows "Active" when validation succeeds
  it('opens register key modal when "Register Custodian Key" is clicked')
  it('plaintext_key input has type="password"')
  it('transitions connection to "active" after successful key registration')
  it('shows custodian_key_invalid error inside modal on 422 response')
  it('does not show plaintext_key value in any rendered text after submission')

  // Suspend
  it('shows Suspend button on active connections')
  it('does not show Suspend button on pending connections')
  it('calls suspend endpoint and updates status to "suspended" after confirm')
  it('does not call suspend endpoint if window.confirm returns false')
  it('shows error when suspend returns 409')

  // Terminate
  it('shows Terminate button on non-terminated connections')
  it('does not show Terminate button on terminated connections')
  it('calls terminate endpoint and updates status to "terminated" after confirm')
  it('does not call terminate endpoint if window.confirm returns false')
  it('shows error when terminate returns 409 (already terminated)')
})
```

### §8.2 — `src/test/AgentConnectionsPage.test.tsx`

```
describe('AgentConnectionsPage', () => {

  // F-027 AC: Agent dashboard shows pending invitations and an "Accept" button
  it('renders connection list with supplier name/ID and status badges')
  it('shows "Accept" button only for pending connections')
  it('does not show "Accept" button for accepted, active, or terminated connections')

  // F-027 AC: Accept button calls accept endpoint and status becomes "accepted"
  it('calls accept endpoint when "Accept" is clicked')
  it('transitions pending connection to "accepted" after successful accept')
  it('shows inline error when accept returns 409 (already accepted)')
  it('shows inline error when accept returns 403 (wrong org)')
  it('disables accept button while request is in flight')
})
```

### §8.3 — F-027 Acceptance Criterion Mapping

| F-027 criterion | Test(s) |
|---|---|
| Supplier dashboard lists all connections with `status` | "renders connection list with status badges" |
| Supplier clicks "Invite Agent" → enters email → sees new pending row | invite modal open + "adds a new pending connection row after 201 invite" |
| After agent accepts, supplier sees "Register Custodian Key" prompt | "shows Register Custodian Key button only for accepted connections" |
| Entering key + submitting shows "Active" when mock validation succeeds | "transitions connection to active after successful key registration" |
| Agent dashboard shows pending invitations + Accept button | "renders connection list" + "shows Accept button only for pending connections" |
| TypeScript compiles with zero errors | Covered by `tsc --noEmit` in CI (not a runtime test) |

---

## §9 — openapi.json Additions and generate-types Note

### §9.1 — New Path Items Required in `frontend/openapi.json`

The backend team must provide the exact OpenAPI path items from `GET http://localhost:8000/openapi.json` after M2 is deployed. The frontend team commits these to `frontend/openapi.json` and regenerates types.

**New paths:**

```json
"/connections": {
  "get": {
    "operationId": "list_connections",
    "summary": "List connections for the calling org (admin sees all)",
    "responses": {
      "200": {
        "description": "Successful",
        "content": {
          "application/json": {
            "schema": { "$ref": "#/components/schemas/ConnectionListResponse" }
          }
        }
      }
    }
  }
},
"/connections/invite": {
  "post": {
    "operationId": "invite_connection",
    "summary": "Supplier sends connection invitation to an agent",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": { "$ref": "#/components/schemas/InviteConnectionRequest" }
        }
      }
    },
    "responses": {
      "201": {
        "description": "Known agent invited",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ConnectionResponse" } } }
      },
      "202": {
        "description": "Unknown agent — invite logged",
        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/InviteUnknownAgentResponse" } } }
      },
      "409": { "description": "Connection already exists" },
      "422": { "description": "Validation error" }
    }
  }
},
"/connections/{connection_id}/accept": {
  "post": {
    "operationId": "accept_connection",
    "summary": "Agent accepts a pending connection invitation",
    "parameters": [{ "name": "connection_id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
    "responses": {
      "200": { "description": "Accepted", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ConnectionResponse" } } } },
      "403": { "description": "Forbidden" },
      "404": { "description": "Not found" },
      "409": { "description": "Invalid status" }
    }
  }
},
"/connections/{connection_id}/custodian-key": {
  "post": {
    "operationId": "register_custodian_key",
    "summary": "Supplier registers custodian API key for a connection",
    "parameters": [{ "name": "connection_id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
    "requestBody": {
      "required": true,
      "content": { "application/json": { "schema": { "$ref": "#/components/schemas/RegisterCustodianKeyRequest" } } }
    },
    "responses": {
      "200": { "description": "Active", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ConnectionResponse" } } } },
      "403": { "description": "Forbidden" },
      "404": { "description": "Not found" },
      "409": { "description": "Invalid status" },
      "422": { "description": "Key invalid" }
    }
  }
},
"/connections/{connection_id}/suspend": {
  "post": {
    "operationId": "suspend_connection",
    "summary": "Suspend a connection (supplier or agent)",
    "parameters": [{ "name": "connection_id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
    "responses": {
      "200": { "description": "Suspended", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ConnectionResponse" } } } },
      "403": { "description": "Forbidden" },
      "404": { "description": "Not found" },
      "409": { "description": "Invalid status" }
    }
  }
},
"/connections/{connection_id}/terminate": {
  "post": {
    "operationId": "terminate_connection",
    "summary": "Terminate a connection (supplier or agent)",
    "parameters": [{ "name": "connection_id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }],
    "responses": {
      "200": { "description": "Terminated", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/TerminateResponse" } } } },
      "403": { "description": "Forbidden" },
      "404": { "description": "Not found" },
      "409": { "description": "Already terminated" }
    }
  }
}
```

**New component schemas required:**
- `ConnectionResponse`: `{ connection_id: UUID, supplier_id: UUID, agent_id: UUID, status: string, custodian_link_present: boolean, created_at: string, activated_at: string | null }`
- `ConnectionListResponse`: `{ connections: ConnectionResponse[] }`
- `InviteConnectionRequest`: `{ agent_org_id?: UUID | null, agent_email?: string | null }` (exactly one must be non-null — enforced by backend model_validator)
- `InviteUnknownAgentResponse`: `{ message: string, agent_email: string }`
- `RegisterCustodianKeyRequest`: `{ custodian_id: string, account_ref: string, plaintext_key: string }`
- `TerminateResponse`: `{ connection_id: UUID, status: "terminated", flagged_loan_ids: string[], message: string }`

### §9.2 — Regenerating `src/api/types.gen.ts`

After updating `frontend/openapi.json`:

```sh
npm run generate-types
```

This runs `openapi-typescript ./openapi.json > src/api/types.gen.ts` (M0/M1 convention). Commit both the updated `openapi.json` and the regenerated `types.gen.ts`. The CI drift check will fail if they are out of sync.

### §9.3 — Type usage after generation

Once types are regenerated, the `as never` cast in `apiClient.POST(...)` calls can be replaced with typed paths:

```ts
import type { paths } from '@/api/types.gen';

type ConnectionResponse =
  paths['/connections/{connection_id}/accept']['post']['responses']['200']['content']['application/json'];
```

Until the backend provides the updated `openapi.json`, the interim `as never` cast (M1 pattern) is acceptable.

---

## §10 — Open Decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| **D-1** | **Nested route vs flat `/dashboard/connections` route** | Open | This spec uses nested routes (`<Route path="connections">` as child of `/dashboard`). Flat routes (`<Route path="/dashboard/connections">` at top level) would avoid the `<Outlet />` change to `DashboardPage` but lose the shared nav shell inheritance. Flag for tech-lead to confirm nested approach is preferred. |
| **D-2** | **Agent display name (agent_id vs org name)** | Open | `ConnectionResponse` returns `agent_id` (UUID) and `supplier_id` (UUID). The UI currently displays truncated UUIDs. A richer display would fetch org names — this requires a `GET /orgs/{id}` endpoint not specified in M2. Options: (a) display UUID, (b) add a batch org-name lookup, (c) wait for M3 which may introduce a directory endpoint. Flag for product/design. |
| **D-3** | **Inline confirm vs window.confirm for suspend/terminate** | Open | This spec uses `window.confirm()` (simplest, mockable in tests). An inline confirm pattern (toggle a "Are you sure?" row inline) would be more polished. Non-blocking — can be replaced in a UX pass. |
| **D-4** | **MSW mock state reset between tests** | Open | The `mockConnections` array is module-level in `connections.ts`. If test files run in the same Vitest worker context, state from one test may leak into another. Resolution: export `resetMockConnections()` from the handler file and call it in `beforeEach` in the test setup. Flag if test flakiness is observed. |
| **D-5** | **`useConnectionAction` generic vs per-action hooks** | Open | This spec uses a single generic `useConnectionAction<T>()` hook that callers wrap with their own `execute()` call. An alternative is to define named hooks per action (`useInviteConnection`, `useAcceptConnection`, etc.) for better TS inference. The generic approach is leaner for M2's limited number of actions. Revisit when M3 adds more actions. |
| **D-6** | **Admin role on `/dashboard/connections`** | Open | Admin users see a "not available for your role" message. If the product requires admins to view all connections, `ConnectionsPage` should render a third admin-specific view (or reuse SupplierConnectionsPage with all connections visible). Not in M2 scope per FEATURES.md F-027. |

---

Status: **Implemented — rev 2**

---

## §11 — Resolution Log (tech-lead review applied 2026-06-08)

| Finding | Severity | Resolution |
|---|---|---|
| **BLOCKER 1 & 2** — apiClient base URL / path prefix inconsistency | BLOCKER | Resolved. Clarified in §3 and §3.3: `apiClient` baseUrl already includes `/api`, so hook and page calls use NO `/api` prefix. Implementation uses raw `fetch` with explicit `API_BASE` constant (computed from `window.location.origin + '/api'` or `/api` in Node) to avoid `openapi-fetch` typed-path limitations for unregistered M2 endpoints. MSW handlers all use `/api/connections/...` (full path at network level). |
| **MAJOR 3** — Empty state missing | MAJOR | Resolved. Both `SupplierConnectionsPage` and `AgentConnectionsPage` render empty-state messages: "No connections yet. Invite an agent to get started." and "No pending invitations." Tests added: `shows empty state when no connections exist` in each test file. |
| **MAJOR 4** — Admin role dead-end | MAJOR | Resolved. `AdminConnectionsPage` implemented as a read-only table showing all connections with no action buttons. `ConnectionsPage` dispatches `role === 'admin'` to `AdminConnectionsPage`. Satisfies F-026 AC "Admin JWT can call GET /connections and receives all connections." |
| **MAJOR 5** — `refetch()` called unconditionally on error | MAJOR | Resolved. `handleSuspend` and `handleTerminate` gate `refetch()` on `result !== null` (matching the `handleAccept` pattern in AgentConnectionsPage). |
| **MINOR D-4** — MSW state leakage | MINOR | Promoted to required. `resetMockConnections()` exported from `src/mocks/handlers/connections.ts`. Called in `beforeEach()` in both `SupplierConnectionsPage.test.tsx` and `AgentConnectionsPage.test.tsx`. |
| **MINOR (finding 6)** — Missing negative test for Register Key button | MINOR | Resolved. Added `does not show "Register Custodian Key" for active or suspended connections` test. |
| **D-1** — Nested route approach | Open | Confirmed: nested routes with `<Outlet />` implemented as specced. |
| **D-6** — Admin UI | Closed | Implemented `AdminConnectionsPage` (read-only). |
