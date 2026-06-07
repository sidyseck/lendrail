# LendRail M1 — Cross-Spec Review

| Field | Value |
|---|---|
| Reviewed documents | `specs/M1-backend-techspec.md` (rev 2), `specs/M1-frontend-techspec.md` (draft rev 2) |
| Reviewer | Tech Lead |
| Review date | 2026-06-07 |
| Prior review ref | `specs/M1-backend-techspec-review.md` (all blockers/majors applied in rev 2) |
| Based on | FEATURES.md, M0 implementation (`backend/app/`, `frontend/src/`) |

---

## 1. Top-line verdict

**Backend (rev 2): APPROVED**

All BLOCKER and MAJOR findings from the prior review have been applied correctly. The spec is internally consistent, implements all assigned F-IDs (F-011–F-013, F-015, F-017–F-019), and is ready for implementation with the minor caveats noted in §4. No new blockers or majors are introduced by the rev 2 changes.

**Frontend (draft rev 2): NEEDS REVISION**

Two BLOCKERs and four MAJORs must be resolved before implementation. The spec has good structure and correctly models the component/hook patterns from M0, but it targets the wrong API surface (an endpoint that no longer exists as of backend rev 2), uses the wrong password constraint, sends an invalid `entity_type` value, and has two open decisions (D-1, D-3) that are actually blockers — not optional. The draft cannot be handed to an engineer until these are fixed.

---

## 2. Cross-cutting consistency checks

| # | Severity | Area | Finding | Which spec to fix |
|---|---|---|---|---|
| C-1 | BLOCKER | Endpoint URL | **Frontend targets `POST /api/orgs/register` (single endpoint, dispatching on `role`). Backend rev 2 eliminated this endpoint entirely.** Backend §1, §7.1, §7.3 define two endpoints: `POST /orgs/register/supplier` and `POST /orgs/register/agent`. The frontend's `useRegistrationForm` hook (§3.2) calls `apiClient.POST('/orgs/register', ...)` and the MSW handler (§6.1) intercepts `POST /api/orgs/register`. Neither URL exists in the backend rev 2 contract. The proxy rewrite will forward `/api/orgs/register` → `POST /orgs/register` on the backend — a 404 or 405. | Frontend spec — change all call sites to `/orgs/register/supplier` and `/orgs/register/agent` respectively; remove the shared single-endpoint hook and MSW handler in favour of two endpoint-specific calls. |
| C-2 | BLOCKER | Request payload field — `role` | **Frontend §4.4 and §5.4 include `"role": "supplier"` / `"role": "agent"` in the request body. Neither `SupplierRegisterRequest` nor `AgentRegisterRequest` in backend §7.1 has a `role` field.** The backend routes are typed (`POST /orgs/register/supplier` implicitly means `role=supplier`). The `role` field is hardcoded in the service. Sending it does not cause an immediate error (Pydantic ignores extra fields by default), but it establishes a contract that doesn't exist. Once the backend enables `model_config = ConfigDict(extra="forbid")` (a common hardening step), `role` in the body will start returning 422. More immediately, `types.gen.ts` generated from the backend's OpenAPI schema will not include `role` in the request type — causing a TypeScript compilation error when §8.3's typed approach is adopted. | Frontend spec — remove `role` from both payload shapes (§4.4, §5.4). Route selection (supplier vs agent URL) is the mechanism; no `role` field is needed or accepted by the backend. |
| C-3 | BLOCKER | Request payload field — `entity_type` for agent | **Frontend §5.2, §5.4, and §5.6 hardcode `entity_type: "agent"` in the agent registration payload. This is rejected by the backend.** Backend §7.1 defines `EntityType = Literal["fund", "corporate_treasury", "foundation"]` — `"agent"` is explicitly excluded from the public schema (Decision 8 in backend §11). A payload with `entity_type: "agent"` will return HTTP 422 on the live backend. The backend §3.1 note confirms the DB ENUM retains `"agent"` but the public API schema does not expose it. Frontend open decision D-3 asks whether this is valid — **it is not, and the backend spec is definitive.** | Frontend spec — agent registration form must NOT hardcode `entity_type: "agent"`. Instead, the agent page must offer the same three entity_type options (Fund, Corporate Treasury, Foundation) as the supplier page, allowing the agent org to select their actual entity type. The disabled single-option select showing "Agent" must be removed. Update §5.1, §5.2, §5.3, §5.4, §5.6, and §7.2 accordingly. |
| C-4 | BLOCKER | Password minimum length | **Frontend validates `password.length < 8`; backend enforces `min_length=12`.** Frontend §3.1 `validatePassword` returns an error for passwords under 8 characters. Backend §7.1 (Decision 7, applied in rev 2) sets `Field(..., min_length=12, ...)` on both `SupplierRegisterRequest` and `AgentRegisterRequest`. A user who enters a 9–11 character password will pass client-side validation, the request will reach the backend, and the backend will return HTTP 422 (`"password: String should have at least 12 characters"`). The frontend hook handles this 422 correctly, but the client-side gate is wrong: the error message says "at least 8 characters" when the constraint is 12. The test helper `fillValidForm` uses `"password123"` (11 characters) — this will fail against the live backend. | Frontend spec — update `validatePassword` in §3.1 from `< 8` to `< 12`; update the error message from "at least 8 characters" to "at least 12 characters"; update `fillValidForm` in §7.1 and §7.2 to use a 12+ character password. |
| C-5 | MAJOR | Endpoint URL — MSW handler | **MSW handler in §6.1 intercepts `POST /api/orgs/register` and dispatches on `body.role`. This handler no longer matches the backend's route structure.** When C-1 is fixed and the frontend calls `/api/orgs/register/supplier` and `/api/orgs/register/agent`, the MSW handler will not intercept any requests. Two separate handlers are needed: `http.post('/api/orgs/register/supplier', ...)` and `http.post('/api/orgs/register/agent', ...)`. The `role`-based dispatch logic inside the single handler must be replaced by this URL split. | Frontend spec — split the single MSW handler into two URL-specific handlers. Update §6.1. |
| C-6 | MAJOR | MSW mock response shape — success | **MSW success response includes `org_id` and `access_token` (§6.1). The backend `OrgRegisterResponse` (§7.1) also includes `token_type: "bearer"`. The MSW mock is missing `token_type`.** The frontend `useRegistrationForm` (§3.2) does not read `token_type` from the response (only `access_token` is used), so this does not cause a runtime failure. However, `types.gen.ts` when regenerated from the backend schema will include `token_type` as a required field on the response type. Any strict type assertion on the response will then fail. The MSW handler should return the exact shape the backend returns. | Frontend spec — add `token_type: 'bearer'` to the MSW success response bodies in §6.1. |
| C-7 | MAJOR | 422 response handling — dual-format | **Frontend §3.2 explicitly handles two 422 shapes: `{ error: { code, message } }` (backend envelope) AND `{ detail: [{ msg }] }` (raw Pydantic shape).** Backend rev 2 §7.6 adds a `RequestValidationError` handler that standardizes ALL 422 responses to the `{ error: { code, message } }` envelope. The `detail` array path in the frontend hook is dead code against the rev 2 backend. The frontend spec open decision D-5 correctly identifies this but treats it as optional cleanup. It should be made definitive: the backend spec is settled on rev 2, so the fallback `errBody?.detail?.[0]?.msg` branch should be removed. If it is kept, the MSW 422 mock should not test it because it never occurs. | Frontend spec — update §3.2 to remove the `detail` array fallback. Update D-5 to close it as resolved. |
| C-8 | MAJOR | openapi.json schema — wrong path | **Frontend §8.1 proposes adding `POST /orgs/register` (singular endpoint) to `openapi.json`.** This is the pre-rev-2 endpoint that was eliminated. The two backend endpoints (`POST /orgs/register/supplier`, `POST /orgs/register/agent`) must be the two path items added to `openapi.json`. The `OrgRegisterRequest` unified union schema reference in §8.1 is also wrong — backend rev 2 has `SupplierRegisterRequest` and `AgentRegisterRequest` as separate schemas. | Frontend spec — update §8.1 to show two path items. Remove `OrgRegisterRequest` union reference. Update §8.3's type path to match the correct paths (`/orgs/register/supplier` and `/orgs/register/agent`). |
| C-9 | MAJOR | open decision D-1 is now a blocker | **Frontend §9 D-1 asks for backend confirmation of the discriminated union's OpenAPI shape. This question is moot.** Backend rev 2 eliminates the discriminated union entirely (BLOCKER #1 fix in backend §11). There are now two separate endpoints, each with its own typed model, and `/openapi.json` will be well-formed. D-1 should be closed as resolved, not left as an open question. | Frontend spec — close D-1 as resolved: two separate path items, no discriminated union. Update §8.1 accordingly. |
| C-10 | MAJOR | open decision D-3 is now a blocker | **Frontend §9 D-3 asks whether `entity_type="agent"` is valid for agent registration. The backend spec resolves this definitively: it is NOT valid (Decision 8, backend §11; `EntityType = Literal["fund", "corporate_treasury", "foundation"]`).** D-3 is described as "Backend tech lead must resolve §10.8 in the backend spec before M1 frontend ships" — but §10.8 does not exist in backend rev 2 (it was §10, item 8 in the draft, and was resolved as Decision 8 in §11). D-3 is already resolved. The frontend action is C-3 above. | Frontend spec — close D-3 as resolved: `entity_type` for agent orgs is one of `fund`, `corporate_treasury`, `foundation` — same options as supplier. Remove the hardcoded `"agent"` value and the disabled single-option select. |
| C-11 | MINOR | Success response — `AuthContext.login()` call | **Frontend §4.5 says `AuthContext.login(access_token)` sets `role = "supplier"` and `orgId = org_id`. But the M0 `AuthContext.login()` signature only takes `token: string` — it derives `role` and `orgId` by decoding the JWT.** Looking at `frontend/src/auth/AuthContext.tsx`, `login(token)` calls `decodeAndValidate(token)` which reads `role` and `org_id` from the JWT payload. The backend JWT always includes `role` and `org_id` after M1 registration. This is correct and will work. However, the spec prose in §4.5 step 3 is misleading — `login()` does not accept `role` or `orgId` as parameters; it infers them from the token. This is a documentation issue, not a code issue. | Frontend spec — fix prose in §4.5 step 3 to say: "`useRegistrationForm` calls `AuthContext.login(access_token)` — the `AuthContext` decodes the JWT to extract `role` and `orgId`." No code change. |
| C-12 | MINOR | Test passwords are too short | **The `fillValidForm` helpers in §7.1 and §7.2 type `"password123"` (11 characters).** This is below the backend's `min_length=12`. These tests will fail integration tests against the live backend (though they will pass unit tests using MSW because MSW does not validate the password field). The passwords should be 12+ characters to be accurate. | Frontend spec — update `fillValidForm` passwords to 12+ characters (e.g. `"password1234"` or `"Str0ngP@ss1!"`). This is the same requirement applied to backend test fixtures in backend §9. |
| C-13 | MINOR | F-014 acceptance criterion — password length not mapped | **F-014 has no explicit acceptance criterion about password length. However the backend enforces 12 characters, and a mismatch between client (8) and server (12) creates a gap.** The frontend §4.8 "Acceptance Criterion Mapping" table does not mention password length validation because FEATURES.md F-014 does not specify it. This is fine — it is an implementation detail not a product requirement — but the frontend spec should document the 12-character minimum as an implementation constraint so it isn't silently wrong. | Frontend spec — add a row in §4.2 and §5.2 noting the password minimum is 12 characters to match the backend `min_length=12`. |
| C-14 | MINOR | F-014 acceptance criterion — missing duplicate email handling for agent | **FEATURES.md F-014 lists "A duplicate email submission shows a user-readable error message ('Email already registered')" as an acceptance criterion. F-016 does NOT list this explicitly — it only lists: attestation error, ops email required, JWT stored, TypeScript.** The frontend spec for F-016 (§5.7) does include a 409 test and a 409 handler (inherited from the hook), so the behaviour is implemented. This is not a gap in implementation but is a gap in the §5.7 acceptance criterion mapping table — the 409 case is tested (§7.2) but not mapped to an acceptance criterion row in §5.7. | Frontend spec — add a 409/duplicate email row to the §5.7 acceptance criterion mapping table for completeness and auditability. |
| C-15 | MINOR | End-to-end register→JWT→redirect flow — test coverage | **The frontend tests in §7.1 and §7.2 test that `mockNavigate` is called with `/dashboard`. They do NOT verify that `AuthContext.login()` was called with a token, nor that the `AuthProvider` now reports `isAuthenticated = true` after registration.** This means the register→JWT→redirect flow is verified at the navigation level but not at the auth-state level. The supplier test line `expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })` confirms navigation but does not confirm that a protected route would subsequently work (because the auth state transition is not asserted). | Frontend spec — add a test assertion in §7.1's "stores JWT and navigates" test that checks `screen.queryByText(/creating account/i)` is gone and that `AuthContext` now has `isAuthenticated = true` (or use `screen.getByText` on a protected element to confirm auth state). Alternatively, add one integration-level test that renders `<App>` with `MemoryRouter` and asserts the user lands on the dashboard page content after registration. |

---

## 3. Remaining open decisions

The frontend spec §9 lists six open decisions. Rulings below:

**D-1 — `openapi.json` discriminated union shape**

**CLOSED — RESOLVED.** Backend rev 2 eliminated the discriminated union. There are two separate path items: `POST /orgs/register/supplier` and `POST /orgs/register/agent`. No union shape question exists. The frontend team must update `openapi.json` with two clean path items (each with one request model) once the backend is running. Remove D-1 from the open decisions list.

**D-2 — Agent `entity_type` UX (disabled select vs hidden field)**

**CLOSED — MOOT.** Backend rev 2 Decision 8 means `entity_type="agent"` is not a valid value for agent registration. The agent registration form must offer the same three entity type options as the supplier form. The UX question about "disabled single-option 'Agent' select vs hidden field" is now irrelevant. The field must be a standard user-selectable dropdown. Update the spec accordingly (see C-3 above).

**D-3 — Whether `entity_type="agent"` is valid for agent registration**

**CLOSED — RESOLVED.** Backend spec Decision 8 (§11, applied in rev 2): `EntityType = Literal["fund", "corporate_treasury", "foundation"]`. The `"agent"` value is excluded from the public API schema. Agent orgs register with one of the three entity types that describe their legal structure. Remove D-3 from the open decisions list.

**D-4 — Redirect-if-authenticated on registration routes**

**DEFERRED — ACCEPTED.** No redirect-if-authenticated guard is required by FEATURES.md for M1. The current behaviour (authenticated users can still visit registration pages) is acceptable for an internal MVP. Flag for M2 UX polish. No action in M1.

**D-5 — Pydantic 422 body format inconsistency**

**CLOSED — RESOLVED.** Backend rev 2 §7.6 adds the `RequestValidationError` handler that standardizes all 422 responses to `{ error: { code, message } }`. The `detail` fallback in `useRegistrationForm` is dead code. Remove the `detail` path from the hook and close D-5.

**D-6 — Navigation destination post-registration**

**DEFERRED — ACCEPTED.** Always navigate to `/dashboard` for M1. If role-specific onboarding is added in M2, the hook gains a role-check before `navigate()`. No action in M1.

---

## 4. Must-fix checklist (BLOCKER/MAJOR only)

### Blockers — must be fixed before frontend implementation begins

- [ ] **frontend spec**: C-1 — Change `useRegistrationForm` and all call sites from `POST /orgs/register` to `POST /orgs/register/supplier` and `POST /orgs/register/agent` respectively. The single shared hook must become either two hooks or accept the target URL as a parameter. (§3.2, §4.4, §5.4)
- [ ] **frontend spec**: C-2 — Remove `role` field from both payload shapes. It is not a field in either `SupplierRegisterRequest` or `AgentRegisterRequest`. (§4.4, §5.4, §4.7, §5.6)
- [ ] **frontend spec**: C-3 — Remove hardcoded `entity_type: "agent"` from agent registration. The agent form must offer the same three entity type options (Fund, Corporate Treasury, Foundation) as the supplier form. Update §5.1, §5.2, §5.3, §5.4, §5.6, and the `AgentRegisterPage.test.tsx` entity type test (§7.2). Close D-2 and D-3 as moot/resolved.
- [ ] **frontend spec**: C-4 — Update `validatePassword` threshold from `< 8` to `< 12`, update the error message to "at least 12 characters", and update all `fillValidForm` helpers to use 12+ character passwords. (§3.1, §7.1, §7.2)

### Majors — must be fixed before frontend implementation begins

- [ ] **frontend spec**: C-5 — Split the single MSW handler at `POST /api/orgs/register` into two handlers: `POST /api/orgs/register/supplier` and `POST /api/orgs/register/agent`. Remove `role`-based dispatch. (§6.1)
- [ ] **frontend spec**: C-6 — Add `token_type: 'bearer'` to MSW success response bodies so they match the backend `OrgRegisterResponse` shape exactly. (§6.1)
- [ ] **frontend spec**: C-7 — Remove `errBody?.detail?.[0]?.msg` fallback from `useRegistrationForm`. Backend rev 2 standardizes all 422s to the `{ error: { code, message } }` envelope. Close D-5. (§3.2, §9)
- [ ] **frontend spec**: C-8 — Update §8.1 to describe two path items in `openapi.json` (`/orgs/register/supplier` and `/orgs/register/agent`). Remove `OrgRegisterRequest` unified schema reference. Update §8.3 type paths. Close D-1. (§8.1, §8.3, §9)

---

## 5. Implementation gate

**Backend (rev 2): APPROVED to proceed to implementation immediately.**

All blockers and majors from the prior review were correctly applied. The backend spec is internally consistent with the M0 implementation, covers all assigned F-IDs, has a complete test plan, and has ruled on all open decisions. Assigned engineer can begin.

**Frontend (draft rev 2): BLOCKED — NEEDS REVISION before implementation.**

The frontend spec must be revised to address the four BLOCKER and four MAJOR findings above before an engineer picks it up. The core problem is a stale dependency: the draft was written against the original backend draft (single `POST /orgs/register` discriminated union, `password min_length=8`, `entity_type="agent"` for agents), but the backend rev 2 changed all three of these. The revision is mechanical — no architectural rethink — but it is wide enough that handing the current draft to an engineer would produce code that fails against the live backend at every integration point.

**Recommended order:**

1. Backend implementation proceeds in parallel with frontend spec revision.
2. Frontend spec revision is estimated at <1 day (all four BLOCKERs are field/URL corrections; MAJORs are handler/schema updates).
3. Frontend implementation begins after the revised spec is approved. The backend `POST /orgs/register/supplier` and `POST /orgs/register/agent` endpoints are the single dependency; the frontend can use MSW for the full development cycle.
4. Integration testing (frontend against live backend) runs after both are implemented.

No backend spec changes are required. All changes are confined to `specs/M1-frontend-techspec.md`.
