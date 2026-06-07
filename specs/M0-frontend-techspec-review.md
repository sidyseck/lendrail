# LendRail M0 Frontend Tech Spec — Review

| Field | Value |
|---|---|
| Reviewer | Senior Tech Lead |
| Review date | 2026-06-06 |
| Spec reviewed | M0-frontend-techspec.md |
| Backend spec cross-referenced | M0-backend-techspec.md |
| Architecture ref | ARCHITECTURE.md v0.2 |
| PRD ref | MASTER_PRD.md v0.1 |

---

## 1. Top-line Verdict

**NEEDS REVISION**

The spec makes sound high-level choices (Vite + React 18 + shadcn/ui, in-memory token, openapi-typescript codegen, MSW for mocking) but has five concrete implementation errors that will cause runtime failures or silent security holes before a single feature ships. The most critical are: a broken 401 re-auth loop with no automatic retry, an incorrect openapi-typescript v7 CLI invocation, and a Vite proxy configuration that does **not** strip the `/api` prefix as claimed, causing every proxied request to return 404 from the backend. All three are blockers. Two additional major issues — missing JWT expiry check and MSW handlers that do not match the backend error envelope — must also be fixed before the test harness is trustworthy. No item in the must-fix list requires architectural rethink; they are all localized corrections.

---

## 2. Findings Table

| # | Severity | Section | Finding | Required action |
|---|---|---|---|---|
| 1 | **BLOCKER** | §4.2 — Axios interceptor / auth client | The 401 interceptor queues failed requests and calls `refreshToken()`, but no refresh endpoint is defined in the backend spec — the backend issues stateless JWTs with no refresh grant. The interceptor will call an endpoint that returns 404, swallow the error, and leave the user silently stuck with an expired token and a queue of unretried requests. There is no path back to the login screen except a hard browser reload. | Remove the phantom refresh call. On 401, clear the in-memory token, cancel any queued requests, and redirect to `/login`. Document this as the accepted re-auth behaviour (Decision 1). If a refresh endpoint is added to the backend later, wire it then. |
| 2 | **BLOCKER** | §6.1 — Code generation script | The codegen command is written as `openapi-typescript <schema_url> --output src/types/types.gen.ts`. In openapi-typescript **v7** the `--output` flag was removed; the tool writes to stdout only. The command as written will silently ignore the flag and print the generated types to the terminal rather than to the file. The CI drift check will always diff against a stale file and either always pass (if the file is never updated) or always fail (if the file is empty). | Fix the command to: `openapi-typescript <schema_url> > src/types/types.gen.ts`. Pipe stdout to the file. Verify with `openapi-typescript --version` in the CI step and pin to `^7.0.0` in devDependencies. |
| 3 | **BLOCKER** | §5.3 — Vite proxy configuration | The proxy block is: `proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } }`. This forwards `/api/loans` to `http://localhost:8000/api/loans`. The FastAPI backend mounts routes at `/loans`, `/auth/login`, etc. — **not** under an `/api` prefix (confirmed in ARCHITECTURE.md §3 and the backend router layout). Every proxied request will receive a 404. The spec claims the proxy "strips the prefix" but no `rewrite` rule is present. | Add a rewrite rule: `rewrite: (path) => path.replace(/^\/api/, '')`. The corrected block: `proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } }`. All frontend `fetch`/`axios` calls use `/api/...`; the proxy rewrites to `/...` before forwarding. |
| 4 | **MAJOR** | §4.1 — AuthContext | The context decodes the JWT with `jwtDecode(token)` to read `role` and `org_id` for UI rendering but never checks the `exp` claim. A token that has expired will continue to be used for UI gating even though the backend will reject it with 401. Combined with finding #1 (broken re-auth), an expired token leaves the user seeing a fully rendered, role-appropriate UI that silently fails every API call. | After decoding, add: `if (decoded.exp && decoded.exp * 1000 < Date.now()) { logout(); return; }`. Run this check on (a) initial mount when rehydrating from memory, and (b) inside the Axios request interceptor before attaching the `Authorization` header. |
| 5 | **MAJOR** | §7.2 — MSW handlers | The MSW handlers return error shapes as `{ message: 'Not found' }`. The backend error envelope defined in the backend spec is `{ "error": { "code": "<string>", "message": "<string>" } }`. Any component that reads `error.message` directly from an API error response will work against MSW but break against the real backend, defeating the purpose of contract-faithful mocking. This will mask integration bugs until the mock is removed. | Update all MSW error responses to match the envelope: `HttpResponse.json({ error: { code: 'not_found', message: 'Resource not found' } }, { status: 404 })`. Add a shared `mockError(code, message, status)` helper in `src/mocks/helpers.ts` so the shape is enforced in one place. |
| 6 | **MINOR** | §3.1 — Package versions | `react-router-dom` is pinned to `^6.8.0`. React Router v6.8 predates the `createBrowserRouter` + `RouterProvider` stable API (stabilized in v6.4 but the data router hooks like `useRouteError` had breaking changes up to v6.8). The spec uses `<BrowserRouter>` + `<Routes>` which is compatible, but the pin should be raised to `^6.22.0` (current stable) to pick up security patches and avoid the known v6.8 loader/action edge cases if data APIs are added later. React 18 + Router 6.22 + Vite 5 + MSW 2 are all mutually compatible. | Bump `react-router-dom` to `^6.22.0` in `package.json`. No API changes required for the existing `<BrowserRouter>` usage. |
| 7 | **MINOR** | §4.3 — ProtectedRoute | The implementation is: `if (!token) return <Navigate to="/login" replace />;`. This is correct React Router v6 idiom. However, it uses the raw `token` string from context, meaning any truthy string — including a malformed or expired one — passes the guard. This is a secondary concern given finding #4, but the guard should check `isAuthenticated` (a derived boolean) rather than the raw token string, so that the expiry check in finding #4 flows through automatically. | Replace the `token` check with an `isAuthenticated` boolean computed in `AuthContext` (true only when token is present AND not expired). `ProtectedRoute` reads `isAuthenticated` only — it has no opinion about token format. |
| 8 | **MINOR** | §6.2 — CI drift check | The drift check runs `openapi-typescript <schema_url>` and diffs against the committed `types.gen.ts`. This is correct in principle but the schema URL points to `http://localhost:8000/openapi.json`, which is not reachable in CI. The backend must be spun up in the CI job (or the OpenAPI schema must be committed as a JSON file and used as the source) for this check to work. | Either: (a) add a `docker compose up -d api` step before the drift check and wait for the healthcheck, or (b) commit `openapi.json` to the repo and use it as the codegen source: `openapi-typescript ./openapi.json > src/types/types.gen.ts`. Option (b) is simpler and avoids a live service dependency in CI. |
| 9 | **MINOR** | §5.2 — Tailwind config | The spec shows `tailwind.config.js` with `content: ['./src/**/*.{ts,tsx}']`. For Vite 5 with PostCSS, Tailwind v3 is configured via `postcss.config.js` — this part is correct. However the spec does not show `postcss.config.js` including `tailwindcss` and `autoprefixer` as plugins. Without those entries, Tailwind classes will not be processed and the UI will render unstyled. shadcn/ui components rely on these classes. | Ensure `postcss.config.js` contains: `plugins: { tailwindcss: {}, autoprefixer: {} }`. Add this file to the spec explicitly and to the project scaffold checklist. |
| 10 | **MINOR** | §4.1 — Security / token leakage | The spec stores the access token in a module-level variable (`let accessToken: string \| null = null`) inside `authClient.ts`, which is correct for XSS resistance. However, the spec also logs the decoded JWT payload to `console.debug` in development mode for diagnostic purposes. The decoded payload contains `org_id` and `role`. While not the token itself, this is unnecessary information leakage that is trivially captured by browser extensions or co-located scripts. | Remove the `console.debug(decoded)` call. If debug visibility is needed, log only `{ role: decoded.role, exp: decoded.exp }` — never `org_id` or `user_id`. |
| 11 | **NIT** | §2.1 — shadcn/ui approach | The spec correctly describes shadcn as a copy-into-your-project approach rather than an npm dependency. The scaffold instructions say `npx shadcn-ui@latest init`, which is the correct CLI invocation for shadcn v0.x. The CLI copies component source into `src/components/ui/`. This is the right pattern — no finding. Noted here for completeness because this is a common misunderstanding and the spec handles it correctly. | No action required. |
| 12 | **NIT** | §6.1 — generate-client script | The npm script is `"generate-client": "openapi-typescript http://localhost:8000/openapi.json --output src/types/types.gen.ts"`. Beyond the `--output` flag bug (finding #2), the script name `generate-client` is misleading — `openapi-typescript` generates types, not a client. A client would be generated by `openapi-fetch` or similar. Rename to `generate-types` to avoid confusion, especially since the spec separately discusses using `openapi-fetch` as the typed HTTP client layer. | Rename the script key to `"generate-types"` in `package.json`. Update all references in the spec and CI workflow file. |

---

## 3. Decision Verdicts

### Decision 1 — In-memory token → hard refresh forces re-login

**APPROVED WITH CONDITIONS.**

Storing the access token in a module-level JS variable (not `localStorage`, not `sessionStorage`) is the correct choice for a B2B SPA where XSS risk from third-party scripts is a real concern. The trade-off — the user must log in again after a hard browser refresh — is acceptable for this audience (agent lenders and suppliers who will keep tabs open during a working session, not bookmark a deep link and expect to resume).

The condition is finding #1: the current spec provides no working path back to the login screen when the token expires or is rejected. The re-auth flow must be: on 401 → clear token → redirect to `/login` with `?next=<current_path>` so the user can resume. The phantom refresh endpoint must be removed. Without this fix the decision is sound; the implementation is not.

### Decision 2 — `types.gen.ts` committed + CI drift check

**APPROVED WITH CONDITIONS.**

Committing generated types means reviewers can see type changes in PRs without running codegen locally — a good practice for a team where not everyone has the backend running. The CI drift check catches schema drift before it silently breaks the frontend.

The condition is finding #2 (broken `--output` flag) and finding #8 (localhost URL unreachable in CI). Fix the codegen command to use stdout redirect, and use a committed `openapi.json` as the source rather than a live backend URL. With those two corrections, the approach is sound.

### Decision 3 — `/api` Vite proxy with prefix-strip

**REJECTED AS WRITTEN — REQUIRES CORRECTION.**

The intent is correct: namespace all backend calls under `/api` in development so that frontend code never hard-codes `localhost:8000`, and strip the prefix before forwarding to the backend which does not use it. This is standard Vite practice.

The implementation is wrong: there is no `rewrite` rule in the proxy config (finding #3). The prefix is not stripped. Every request will 404. This is a one-line fix but it is a blocker. The decision itself (use a proxy with prefix-strip) is the right call — approve the decision, reject the current implementation.

### Decision 4 — Client-side unverified JWT decode for role/org_id UI hints

**APPROVED WITH CONDITIONS.**

Using `jwtDecode` (not `jwtVerify`) on the client for UI rendering decisions — showing/hiding nav items, selecting the correct dashboard layout — is correct. Signature verification on the client is meaningless because the public key would be shipped to the browser; the real authorization check happens server-side on every request. The JWT decode is appropriately labeled as "UI hints" in the spec.

The condition is finding #4: the `exp` claim must be checked after decoding. An unverified decode that ignores expiry is actively harmful — the UI shows a fully functional interface for a session the backend has already rejected. Add the expiry check. The architectural decision stands.

### Decision 5 — Conservative pins + shadcn vendored

**APPROVED.**

Pinning React at `^18.2.0`, Vite at `^5.0.0`, MSW at `^2.0.0`, and React Router at `^6.8.0` (with the minor version bump recommended in finding #6) gives a stable, mutually compatible baseline. The only adjustment is the Router version floor (raise to `^6.22.0`).

Vendoring shadcn components by copying source into `src/components/ui/` is correct — this is how shadcn is designed to be used. It avoids a runtime npm dependency on a library that does not publish one, gives full control over component variants, and makes Tailwind class purging straightforward. No concerns with this approach.

---

## 4. Must-Fix Checklist

- [ ] **[BLOCKER — §4.2]** Remove the phantom `refreshToken()` call from the 401 interceptor. Replace with: clear in-memory token, cancel queued requests, redirect to `/login?next=<path>`. No refresh endpoint exists on the backend.
- [ ] **[BLOCKER — §6.1]** Fix the openapi-typescript v7 codegen command: remove `--output` flag, pipe stdout to file — `openapi-typescript <source> > src/types/types.gen.ts`. Rename npm script from `generate-client` to `generate-types`.
- [ ] **[BLOCKER — §5.3]** Add `rewrite: (path) => path.replace(/^\/api/, '')` to the Vite proxy config so the `/api` prefix is actually stripped before forwarding to the backend.
- [ ] **[MAJOR — §4.1]** Add JWT `exp` claim check in `AuthContext` after `jwtDecode`. On expiry: call `logout()`, which clears the token and redirects to `/login`. Also check `exp` in the Axios request interceptor before attaching the `Authorization` header.
- [ ] **[MAJOR — §7.2]** Update all MSW error response bodies to match the backend envelope `{ "error": { "code": "...", "message": "..." } }`. Add a `mockError(code, message, status)` helper to enforce the shape in one place.

---

*Review complete. All five blockers and majors are localized fixes — none require architectural redesign. Resubmit after the must-fix checklist is addressed.*
