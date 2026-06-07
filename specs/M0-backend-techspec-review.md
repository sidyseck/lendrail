# M0 (Foundation) Backend Tech Spec — Technical Review

| Field | Value |
|---|---|
| Reviewer | Technical Lead |
| Date | 2026-06-05 |
| Spec under review | `specs/M0-backend-techspec.md` |
| Source docs | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2, FEATURES.md |

---

## Top-line verdict: **APPROVED WITH CHANGES**

The spec is strong: it is well-structured, honors the architecture's layer boundaries cleanly, builds each seam test-first, and explicitly surfaces its own risky decisions rather than burying them. It is implementable as written for most of M0. However, there are a small number of **Blocker** and **Major** issues that must be resolved before code is written — chiefly a security-relevant dependency choice (`python-jose`, effectively unmaintained), an internally inconsistent test-DB strategy versus the chosen `pytest-asyncio` pin, and an under-specified ARQ cron wiring whose acceptance criterion ("runs every 60 seconds") is left commented out. None of these are architectural; all are correctable with bounded changes.

---

## 1. Prioritized findings table

| # | Severity | Finding | F-ID / §ref | Recommendation |
|---|---|---|---|---|
| 1 | **Blocker** | `python-jose` is pinned for JWT, but it is effectively unmaintained (no substantive release since 2021; known unpatched advisories in its dependency surface). For a platform whose core value is custody-adjacent trust, shipping the auth layer on a dead JOSE library is a security liability that will be inherited by every later milestone. | §16 deps, F-004 | Replace `python-jose[cryptography]` with **`pyjwt>=2.8`**. API surface is a near drop-in (`jwt.encode`/`jwt.decode`); update `core/security.py` and the `JWTError` import in `deps.py` to `jwt.PyJWTError`. |
| 2 | **Blocker** | Test-DB strategy (decision 4: session-scoped engine + `alembic upgrade head` once, per-test outer-transaction rollback) is incompatible with the pinned `pytest-asyncio>=0.23,<0.24` without extra plumbing. 0.23 attaches a per-scope event loop and a session-scoped async fixture sharing a loop with function-scoped tests is exactly the breakage class that version introduced; `asyncio_default_fixture_loop_scope` is unset in `pyproject.toml`, which also emits deprecation warnings. As written the `conftest.py` will not run reliably. | §15, §16, F-002/F-003 | Either (a) bump to `pytest-asyncio>=0.24` (or 0.25/1.x) and set `asyncio_default_fixture_loop_scope = "session"` in `[tool.pytest.ini_options]`, or (b) make the engine fixture function-scoped. Spec must state the loop-scope config explicitly, not leave it implicit. |
| 3 | **Major** | F-007 acceptance requires the health-check job to "run every 60 seconds," but the spec leaves the `cron_jobs` entry **commented out** and notes the cadence is "informational in M0." As written, this acceptance criterion is not satisfied. | F-007, §9 | Uncomment and ship a real `cron(health_check_job, second=0)` (or `minute=set(range(60))` equivalent) so the job actually fires; add the import. Keep it test-asserted indirectly (job callable returns "ok") plus a documented manual/CI check that it fires. |
| 4 | **Major** | F-007 acceptance: "A failed job is logged at ERROR with the traceback; the worker does not crash." The spec relies on "ARQ's default behavior" and a test-only `failing_job`, but does not specify that ARQ logs the traceback at ERROR by default (it logs job failures, but the format/level guarantee is not verified) nor configure logging so the worker process captures it. Leaves an acceptance criterion to assumption. | F-007 | Specify explicit exception handling in the worker (or an ARQ `on_job_end`/result-logging hook) that logs `exc_info=True` at ERROR; assert it in `test_worker.py`. |
| 5 | **Major** | Secret-store decision (decision 3) is process-local in-memory. Acceptable for M0 in isolation, but the `EnvSecretStore` is wired as a **process singleton in `deps.py`** AND the api and worker run as **separate containers**. Any later cross-process retrieval (and even multi-worker uvicorn `--reload` reloads) will silently lose refs. M0 has no consumer, so not a Blocker, but the "swap to DB column in M2" must be a hard gate, not a footnote, because F-024's design depends on it. | §11, decision 3 | Approve in-memory for M0 **only if** the spec adds an explicit M2 entry/ticket making ciphertext-in-Postgres a precondition of F-024, and documents that the in-memory store is single-process and not shared api↔worker. |
| 6 | **Major** | AES key derivation (decision 7): `_derive_key` uses bare `SHA-256(secret)` with no salt/KDF. For a derived-from-`JWT_SECRET` local key this is tolerable, but the spec presents it as the encryption-at-rest mechanism custodian keys will use. A plain hash is not a password-based KDF; if `SECRET_STORE_KEY` is ever a low-entropy human secret in prod, this is weak. | §11, decision 7 | Approve for M0 local. Require the spec to (a) mandate a high-entropy random `SECRET_STORE_KEY` in non-local envs, and (b) note prod path uses Vault, not this primitive. Optionally switch derivation to HKDF for hygiene. |
| 7 | **Minor** | `passlib[bcrypt]>=1.7.4` — passlib 1.7.4 is itself unmaintained and reads `bcrypt.__about__`, which 4.1+ warns on / 5.x removed. The spec correctly pins `bcrypt<5`, which works, but passlib will emit a noisy warning against bcrypt 4.1+ and the combination is a known fragile pairing. | §16, F-012 (M1) | Accept the `bcrypt<5` pin for M0. Flag that M1/F-012 should consider using `bcrypt` directly (or `pwdlib`) instead of passlib to retire the dependency before it blocks a bcrypt 5 upgrade. |
| 8 | **Minor** | F-001 acceptance includes `curl http://localhost:5173` returning HTML and `docker compose down -v` / re-`up`. The spec scopes out the frontend (correctly) but the F-001 criterion is only fully satisfiable once F-010 lands. The spec should state that two F-001 criteria are jointly owned by F-010 and validated at integration, not in the backend test suite. | F-001, §3 | Add an explicit note that the Vite/HTML and full-compose criteria are deferred to F-010 integration; backend M0 owns `/healthz`, `.env.local.example`, and clean api/worker/postgres/redis boot. |
| 9 | **Minor** | Health path: spec standardizes `/healthz` (correct — it matches F-001 verbatim). The parenthetical "PRD/arch sometimes shows `/healthz`" is a typo (it compares `/healthz` to itself). ARCHITECTURE.md does not actually specify a health path, so there is no real conflict — but the muddled note should be cleaned so infra/frontend don't think there's ambiguity. | §3, decision 6 | Approve `/healthz`. Fix the self-referential note; state plainly that ARCHITECTURE.md is silent and `/healthz` is canonical. |
| 10 | **Minor** | Constant-time login (compare against a dummy hash on unknown email) is described in prose but not in the `AuthService.login` code shown, which returns early on `user is None`. The shown code has the enumeration timing leak the prose says it avoids. | §6.4 | Implement the dummy-hash verify in the actual code path; add a test asserting both branches call `verify_password`. |
| 11 | **Minor** | `get_session` commits on success at the request boundary, but ARQ jobs do not flow through `get_session`. The worker's transaction/commit boundary is unspecified. F-007 has no DB writes so M0 is fine, but the pattern must be defined before F-036/F-051 jobs write rows. | §5, §9 | Add a one-line note that worker jobs own their own session/commit boundary (e.g., an `async with SessionFactory()` context per job) to be specified at M4. |
| 12 | **Minor** | `python-multipart` is included "if login is form-encoded," but `LoginRequest` is a Pydantic JSON body, so multipart is unused in M0. Harmless, but dead dependency. | §16 | Drop `python-multipart` from M0 deps, or note it is pre-staged for later form endpoints. |

---

## 2. Completeness check (F-001 … F-009 + F-060)

Every backend M0 feature is covered. Mapping is clean:

| Feature | Covered? | Section | Notes |
|---|---|---|---|
| F-001 monorepo + compose | Yes (partial by design) | §3 | Frontend-dependent criteria deferred to F-010 — flag #8. |
| F-002 Alembic | Yes | §4 | Async `env.py` correct; up/down/round-trip addressed. |
| F-003 session + repo base | Yes | §5 | `NotFoundError`, flush-not-commit, conn-close all addressed. |
| F-004 JWT auth | Yes | §6 | Sound; see dep swap #1 and constant-time #10. |
| F-005 RBAC | Yes | §7 | `require_role` factory; ownership-check correctly deferred to later milestones. |
| F-006 notifications | Yes | §8 | Interface + console adapter + `notifications` table all present. |
| F-007 ARQ worker | Yes (gaps) | §9 | Cron commented out (#3), ERROR-logging assumed (#4). |
| F-008 mock adapters | Yes | §10 | Both adapters + factory + `NotImplementedError` path. |
| F-009 secret store | Yes (caveat) | §11 | In-memory store flagged (#5); key derivation (#6). |
| F-060 OpenAPI | Yes | §13 | Valid schema + stable operation_ids; client-gen correctly frontend. |

**F-060 backend obligations** (expose valid `/openapi.json`, stable operation IDs, declared response models) are fully met. The `npm run generate-client` half is correctly attributed to F-010.

**Nothing M0-backend is missing.** The `users` and `notifications` tables are the correct minimal schema. The decision to pull `users` forward from M1/F-012 is justified and correct (F-004 cannot exist without it).

---

## 3. Acceptance-criteria traceability — gaps

Criteria the spec does **not** clearly enable as written:

- **F-007**: "health check job runs every 60 seconds" — not satisfied; cron is commented out (finding #3).
- **F-007**: "a failed job is logged at ERROR with the traceback" — relies on unverified ARQ default (finding #4).
- **F-001**: "`curl localhost:5173` returns HTML" and "`docker compose down -v` then `up` rebuilds" — not satisfiable by backend alone (finding #8); needs explicit F-010 hand-off.
- **F-004**: enumeration-safe timing is claimed but the shown code returns early (finding #10). Acceptance doesn't require constant-time, so not a criterion gap — but the spec's own claim is unmet.

All other M0 acceptance criteria are satisfiable by what the spec describes.

---

## 4. Architectural consistency

**Compliant.** Verified against ARCHITECTURE.md §3/§5/§6:

- **Layer boundaries honored.** Domain services (`AuthService`) take `AuthUser` + typed inputs, raise typed domain errors, and import no FastAPI types. The `AuthUser` frozen dataclass is correctly the only type crossing API→service. Repositories own data access; no raw SQL in the service.
- **Adapters behind Protocols, env-swappable.** `interfaces.py` Protocols + `providers.py` factories switched by env var, with `NotImplementedError` for unwired real adapters — exactly the architecture's pattern.
- **DI via FastAPI `Depends`** with `dependency_overrides` for tests — consistent with arch §5 "DI container."
- **Error mapping** is in the API/`main.py` layer, keeping HTTP status out of services. Good.

One soft inconsistency, not a violation: ARCHITECTURE.md §6 references **Supabase Vault** and an encrypted DB column for custodian keys; the spec substitutes a process-local dict for M0. This is a deliberate, flagged simplification (decision 3) and acceptable for M0 provided the M2 gate in finding #5 is added.

---

## 5. Security review

| Surface | Verdict | Notes |
|---|---|---|
| Custodian key / password in logs | **Pass, with backstop** | No secret is passed to a logger in the shown paths; the §14 redaction `Filter` scrubbing `password`/`api_key`/`hashed_password`/`token` is a sound defense-in-depth. Recommend asserting the filter in a test (spec says it does for F-009/F-012). |
| Key in responses | **Pass** | `TokenResponse`/`/auth/me` never echo password/hash. `AuthService.login` returns only the token. |
| Plaintext at rest | **Pass for M0** | AES-256-**GCM** (authenticated) is the right primitive. Only the in-memory ciphertext exists in M0. See #6 on key derivation. |
| JWT library | **Fail → fix** | `python-jose` unmaintained (finding #1). This is the one security-grade defect. |
| Password hashing | **Pass** | bcrypt via passlib; raw password never logged (asserted). Retire passlib later (#7). |
| Timing / enumeration | **Minor** | Prose claims constant-time; code doesn't implement it (#10). |

No leak risk in the data model: only the vault **ref** is ever stored, never plaintext — consistent with PRD F1.4 and architecture §6.

---

## 6. Dependency / version sanity

Pins are broadly current and mutually compatible for Python 3.12, with these exceptions:

- **`python-jose` — replace** (Blocker #1). Unmaintained; use `pyjwt>=2.8,<3`.
- **`pytest-asyncio>=0.23,<0.24` — bump** (Blocker #2). 0.23 is the fragile transitional release for cross-scope loops; the chosen test-DB strategy needs ≥0.24 with `asyncio_default_fixture_loop_scope` set, or a function-scoped engine.
- **`passlib 1.7.4` + `bcrypt<5`** — works today but a known fragile, deprecated pairing (#7). Acceptable for M0.
- **`httpx>=0.27,<0.28`** — fine; pairs with `ASGITransport` as the spec uses it.
- **FastAPI `>=0.111,<0.116`, SQLAlchemy `>=2.0.30,<2.1` (async), asyncpg `>=0.29,<0.31`, alembic `>=1.13`, Pydantic `>=2.7,<3`, pydantic-settings `>=2.3`, cryptography `>=42,<44`, arq `>=0.26,<0.27`, redis `>=5,<6`** — all mutually compatible and current enough. Good.
- **`python-multipart`** — unused in M0 (#12).

No hard version conflicts beyond the two flagged.

---

## 7. Implementability — gaps that would force improvisation

An engineer could build ~90% of M0 from this spec unaided. Undocumented decisions they would otherwise have to improvise:

1. **ARQ cron registration** — the working cron line is commented out; engineer must guess the exact `cron()` invocation and whether to ship it (#3).
2. **`pytest-asyncio` loop-scope config** — `conftest.py` fixtures are given as signatures only; the session-vs-function loop reconciliation is the hardest part and is left implicit (#2).
3. **Worker transaction boundary** — undefined for jobs (#11); harmless in M0 but a guessing point.
4. **Alembic entrypoint** — "an entrypoint runs `alembic upgrade head`" but no entrypoint script is shown; engineer must write the wait-for-postgres + migrate wrapper.
5. **Constant-time login** — prose vs. code mismatch (#10) forces a judgment call.

These are bounded; with the must-fix list below resolved, the spec is fully implementable.

---

## Per-decision verdicts (the 7 flagged items)

**(1) `users` table in M0 with nullable `org_id`, FK deferred to M1 — APPROVE as-is.**
F-004 login provably cannot exist without a user table, and deferring all auth to M1 would block the whole foundation. A nullable `org_id` UUID with the FK added by M1's migration is the minimal, reversible seam. `role` on the user as the JWT source is reasonable; M1 can denormalize from the org. The only caveat is to ensure the M1 migration adds the FK **and** backfills/validates `org_id` before making it non-null — note that as an M1 obligation.

**(2) Sync vs async adapter Protocols — APPROVE with change.**
The spec keeps Protocols sync "to match the reference verbatim," but the architecture's own §5b adapter rules anticipate real network clients (Anchorage, market feeds) that are I/O-bound and belong on the event loop. Shipping sync Protocols now guarantees a breaking signature change across every call site later (services, workers, tests). Since there are zero real call sites in M0, the cost of making them `async def` now is near-zero and avoids a painful migration. Recommendation: **make the Protocols and mock methods `async def` in M0.** Update ARCHITECTURE.md §5 to match so they don't drift.

**(3) Process-local in-memory secret store in M0 — APPROVE with change.**
Fine in isolation, but two facts make it a trap if under-documented: the store is a per-process dict, and api/worker are separate containers, so it is not shared and does not survive reloads. M0 has no consumer, so it's safe — but approval is conditional on (a) an explicit hard M2 gate making ciphertext-in-Postgres a precondition of F-024, and (b) documenting the single-process limitation so no one builds against it. With those added, approve.

**(4) Transactional-rollback test DB strategy — APPROVE with change.**
The strategy itself (migrate once, outer transaction + rollback per test, migrations as schema source) is the correct, fast, well-isolated choice and properly exercises F-002. The defect is purely the version interaction: it is not reliable under the pinned `pytest-asyncio<0.24` and the spec never states the loop-scope config. Recommendation: keep the strategy, **bump pytest-asyncio to ≥0.24 (or 0.25/1.x) and pin `asyncio_default_fixture_loop_scope`** (session), or use a function-scoped engine. Make the conftest loop config explicit, not signatures-only.

**(5) Migrations auto-applied on api container start — APPROVE with change.**
Acceptable and convenient for local "clean checkout boots." But auto-migrate-on-start is a known prod foot-gun (race across multiple api replicas, no gating/rollback control). The spec already flags it; approval is conditional on the spec stating clearly that the entrypoint migrate step is **local-only** and prod uses a separate gated migration job. Also specify the entrypoint must wait-for-postgres before migrating.

**(6) `/healthz` as canonical health path — APPROVE as-is.**
Matches F-001 verbatim; ARCHITECTURE.md does not specify a competing path, so there is no real conflict to resolve. The only fix is editorial: the spec's note comparing "`/healthz`" to "`/healthz`" is a typo and should be cleaned so infra/frontend don't infer ambiguity. Decision itself is correct.

**(7) AES key derived from `JWT_SECRET` when `SECRET_STORE_KEY` unset — APPROVE with change.**
AES-256-GCM with a random 12-byte nonce is the right construction. Deriving the key from `JWT_SECRET` is acceptable for local dev only. Two changes: (a) the derivation is bare `SHA-256` — fine for a high-entropy machine secret but inappropriate if `SECRET_STORE_KEY` is ever a low-entropy human value, so mandate a high-entropy random `SECRET_STORE_KEY` outside local and document it in `.env.local.example`; (b) state explicitly that coupling secret-store key to `JWT_SECRET` means a JWT secret rotation also invalidates all stored ciphertext — call this out so rotation runbooks account for it. Prod path remains Vault, not this primitive.

---

## Must-fix before implementation (checklist)

Blocker + Major items resolved in spec rev 2 (2026-06-05):

- [x] **Replace `python-jose` with `pyjwt`** (Blocker #1) — `core/security.py`, `deps.py` import (`PyJWTError`), and the pin updated.
- [x] **Fix the test-DB / pytest-asyncio version interaction** (Blocker #2) — bumped to `>=0.24`, set `asyncio_default_fixture_loop_scope="session"`; loop requirement stated in §15.
- [x] **Ship a real ARQ cron** for `health_check_job` (Major #3) and **explicit ERROR+traceback logging** via `after_job_end` hook, asserted in `test_worker.py` (Major #4).
- [x] **Add the M2 gate** making custodian ciphertext-in-Postgres a precondition of F-024, plus documented single-process limitation (Major #5).
- [x] **Adapter Protocols made async now** (decision 2) — spec updated; ARCHITECTURE.md §5 update tracked separately.
- [x] **Constrain prod secret-store key** to high-entropy `SECRET_STORE_KEY`; documented JWT-rotation/ciphertext coupling (decision 7 / Major #6).
- [x] **Marked migrate-on-start as local-only**, added wait-for-postgres, noted prod gated migration job (decision 5).

Minor items deferred to implementation time (non-blocking, noted in spec §17):

- [ ] **Implement constant-time login** in code to match the prose claim (Minor #10).
- [ ] **Editorial**: ~~self-referential `/healthz` note~~ (fixed); state F-010-owned F-001 criteria; drop unused `python-multipart`.

---

*Sources consulted for dependency/version judgments:*
*[python-jose maintenance status (Snyk / PyPI / libhunt)](https://www.libhunt.com/r/pyjwt), [python-jose · PyPI](https://pypi.org/project/python-jose/), [pytest-asyncio 0.23 breaking change discussion](https://github.com/pytest-dev/pytest-asyncio/issues/706), [pytest-asyncio changelog](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html).*
