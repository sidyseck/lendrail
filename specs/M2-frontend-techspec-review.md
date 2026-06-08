# M2 Frontend Tech Spec Review — F-027 Connection Management UI

| Field | Value |
|---|---|
| Spec under review | `specs/M2-frontend-techspec.md` rev 1 |
| Backend contract | `specs/M2-backend-techspec.md` rev 2 |
| Schema source | `backend/app/schemas/connections.py` |
| Reviewer | Tech lead |
| Date | 2026-06-08 |

---

## 1. Top-line verdict

**APPROVED WITH CHANGES**

The spec is structurally sound. Field names in the TypeScript types and MSW seed data match the backend `ConnectionResponse` schema exactly. The MSW handler URLs correctly use the `/api/` prefix aligned with Vite proxy convention. The major gap is a missing empty-state render path, two BLOCKER-level URL/routing inconsistencies in the MSW handlers and `useConnections` hook, and incomplete admin-path test coverage. All blockers are small surgical fixes; no architectural rethink is needed.

---

## 2. Findings Table

| # | Severity | Section | Finding | Required action |
|---|---|---|---|---|
| 1 | BLOCKER | §3.3 `useConnections` | Hook calls `apiClient.GET('/connections')` — no `/api/` prefix. All other spec sections correctly use `/api/connections`. If `apiClient` base URL does not already include `/api`, this call will hit the wrong path and bypass the Vite proxy. | Clarify whether `apiClient` sets a base URL of `/api`. If not, change the path to `'/api/connections'` to match the MSW handler at `http.get('/api/connections', ...)`. |
| 2 | BLOCKER | §7.1 MSW handlers | The accept, custodian-key, suspend, and terminate handlers are registered with the MSW path pattern `'/api/connections/:connection_id/...'` but the `useConnections` hook and action handlers inside pages use `'/connections/{connection_id}/...'` (no `/api/` prefix in the `apiClient.POST(...)` call strings in §4.5 and §5.2). If `apiClient` prepends `/api` automatically, MSW `/api/...` handlers are correct. If not, there is a mismatch that will cause all action tests to fail (MSW never intercepts). The spec never states `apiClient` base URL explicitly. | Explicitly document `apiClient` base URL in §3 (Shared Infrastructure). Confirm all `apiClient.POST/GET` path literals either carry or omit the `/api/` prefix consistently, matching the MSW handler registration. |
| 3 | MAJOR | §3.3, §5, §8 | Spec does not specify the empty-list render path. When `GET /api/connections` returns `{ connections: [] }`, `useConnections` sets `connections = []` but no test or component outline describes what the UI renders (e.g., "No connections yet" empty state). Both supplier and agent pages fall through to an empty `<ConnectionTable>` with no rows — which is acceptable but not spec'd. F-027 AC "Supplier dashboard lists all connections" implicitly requires a defined zero-state. | Add an empty-state description (even just a `<p>No connections yet.</p>`) to §4.1 and §5.1 component trees, and add one test case per page: `it('shows empty state when no connections exist')`. |
| 4 | MAJOR | §6.1 `ConnectionsPage`, §10 D-6 | The spec renders a "not available for your role" message for admin users and notes this is open (D-6). However, the backend (F-026, `GET /connections` with admin JWT) returns all connections and explicitly requires admin visibility per `FEATURES.md F-026` AC: "Admin JWT can call `GET /connections` and receives all connections (no filter)." Admin-side read access is a shipped backend feature in M2, not a deferred product decision. Leaving admin with a dead-end page means there is no way to exercise or verify F-026's admin path from the UI. | Either (a) render an admin view in `ConnectionsPage` that displays all connections read-only (reuse the connection table with no action buttons), or (b) escalate to product and get explicit sign-off that admin UI is out of scope for M2 with a corresponding FEATURES.md note. Currently the spec silently drops an already-implemented backend capability. |
| 5 | MAJOR | §4.5 Suspend/Terminate | `handleSuspend` and `handleTerminate` call `refetch()` unconditionally after `execute(...)`, even when `execute` returned `null` (meaning the action failed). This means the list refetches on error, which is harmless but also means the error displayed briefly disappears and re-renders. More importantly, the spec does not call `refetch()` inside the `execute()` callback on success — it calls it after `execute()` returns regardless. Compare §5.2 `handleAccept` which correctly gates `refetch()` on `result !== null`. | Move `refetch()` inside the execute callback (after the `if (!response.ok)` throw), or at minimum gate it on `result !== null` to be consistent with the agent accept pattern. |
| 6 | MINOR | §8.1 Supplier tests | Test `it('shows "Register Custodian Key" button only for accepted connections')` does not have a symmetric counterpart explicitly testing that the button is absent for `active` and `suspended` connections (only `pending` is called out in the sibling test). §4.6 Button Visibility Rules table specifies those states clearly but the test list does not cover them. | Add: `it('does not show "Register Custodian Key" for active or suspended connections')`. |
| 7 | MINOR | §4.3 Invite Modal | The spec says "If `agent_org_id` mode: must be a non-empty string (UUID format check is optional)." The backend `InviteConnectionRequest.agent_org_id` is typed `UUID` (strict). Submitting a non-UUID string to the real backend returns a 422 that the modal already handles. However, the MSW handler accepts any string for `agent_org_id`, so tests pass even with invalid UUIDs. The spec's "optional" framing is fine for M2/mock, but should note this is a client-side UX gap to address before production. | Add a note in §4.3 that UUID format validation on the org ID field is a deferred UX item (add to §10 Open Decisions). |
| 8 | MINOR | §7.1 MSW handlers | `mockConnections` is module-level mutable state. The spec acknowledges this in §7.3 but defers the `resetMockConnections()` fix to "if flakiness is observed" (D-4). Because Vitest runs test files in the same worker by default and module-level state is shared across `describe` blocks in the same file, the invite test that pushes a new connection into `mockConnections` will affect subsequent tests in `SupplierConnectionsPage.test.tsx`. This is not theoretical — it will cause the "renders connection list" test to see 3 rows if it runs after the invite test. | Promote D-4 from deferred to required: export `resetMockConnections()` and call it in `beforeEach` in `src/test/setup.ts`. Do not leave this to "if flakiness is observed." |
| 9 | MINOR | §8.3 F-027 AC mapping | The test mapping table lists 5 of the 6 F-027 acceptance criteria but omits TypeScript compilation. That AC is noted as "covered by `tsc --noEmit` in CI" which is correct, but the table entry should reference the CI job name or step so it is traceable. | Add a row: `TypeScript compiles with zero errors \| Enforced by \`tsc --noEmit\` step in CI (see `.github/workflows/...`)`. |
| 10 | NIT | §4.4 Register Key Modal | `autoComplete="new-password"` is noted as preventing password manager auto-fill. In practice, `autoComplete="off"` is more reliable across browsers for API keys, which are not passwords. `"new-password"` is for credential creation forms. This is a minor browser-behaviour nuance with no functional impact on tests. | Consider `autoComplete="off"` or `autoComplete="one-time-code"` for the API key field. |
| 11 | NIT | §9.1 openapi.json | The `openapi.json` snippet for `/connections` (GET) is missing a `security` field. All protected endpoints must carry `bearerAuth` in the security requirement, otherwise `openapi-typescript` will not type the Authorization header dependency correctly in the generated client. | Add `"security": [{ "bearerAuth": [] }]` to each new path item's operation object, consistent with M1 endpoints. |

---

## 3. Must-Fix Checklist (BLOCKER and MAJOR only)

- [ ] **spec §3.3**: Document `apiClient` base URL. If it does not include `/api`, change `apiClient.GET('/connections')` to `apiClient.GET('/api/connections')`.
- [ ] **spec §7.1**: Confirm all MSW handler URL strings (`/api/connections/...`) match all `apiClient.POST/GET` call strings in page and hook code. Add a one-line note at the top of `connections.ts` stating the assumed `apiClient` base URL to prevent future drift.
- [ ] **spec §4.1, §5.1, §8**: Add empty-state render to both page component trees and add one empty-state test per page.
- [ ] **spec §6.1**: Either implement a read-only admin connection list view or get explicit product sign-off that admin UI is out of scope for M2 and annotate FEATURES.md F-026 accordingly.
- [ ] **spec §4.5**: Gate `refetch()` on action success (consistent with `handleAccept` pattern in §5.2); do not call `refetch()` unconditionally after a failed action.
- [ ] **spec §7.1/§7.3**: Promote D-4 to required — export `resetMockConnections()` and wire it into `beforeEach` in test setup before this spec is implemented.
