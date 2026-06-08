# Spec Deltas

Known intentional deviations from FEATURES.md. Each entry records what the spec says,
what the implementation does, and why.

---

## SD-001 — Connection `accept` intermediate `accepted` status (RESOLVED)

| Field | Value |
|---|---|
| Feature | F-023 — Agent accepts connection invitation API |
| Milestone | M2 |
| Discovered | 2026-06-07 |
| **Resolved** | **2026-06-07 — migration 0010 removes `accepted`; `accept` now transitions directly `pending → active`** |

**Spec (F-023):**
> `POST /connections/{id}/accept` … returns HTTP 200 with `{ "connection_id": "...", "status": "pending" }`.

The spec also defines the connection status ENUM (F-021) as: `pending`, `active`, `suspended`, `terminated`.

**Implementation:**
The connection status ENUM includes a fifth value: `accepted`. After `POST /connections/{id}/accept` the connection transitions `pending → accepted`, not `pending → pending`. It advances to `active` only when the supplier subsequently registers the custodian API key (F-024).

The full lifecycle as implemented:

```
pending  →  accepted  →  active  →  suspended | terminated
  (invite)   (accept)   (key reg.)
```

**Why:**
`pending` after acceptance is semantically ambiguous — "pending invitation response" vs "pending key registration" are distinct waiting states. The extra `accepted` state makes the connection's progress unambiguous in the UI and simplifies service-layer branching.

**Impact on downstream features:**
- F-029 (`create_agreement`) guards on `connection.status == "active"`. No change needed.
- F-024 (`register_custodian_key`) transitions `accepted → active`. The service currently checks `status in ("pending", "accepted")` before allowing key registration; suppliers cannot register a key on a connection the agent hasn't accepted.
- Any code or test that asserts `status == "pending"` after acceptance will fail. Tests in `test_connections.py` use `"accepted"` to match the implementation.
- The `ConnectionResponse` schema returns `status` as a plain `str`; the frontend renders it via `StatusBadge` which already handles `"accepted"`.

**Resolution:** Applied option 1 variant — `accepted` was removed entirely. `accept` sets `activated_at` and transitions directly `pending → active`. FEATURES.md updated to reflect this.

---

## SD-002 — F-024 custodian management moved to org level

| Field | Value |
|---|---|
| Feature | F-024 — Supplier registers custodian API key |
| Milestone | M2 |
| Discovered | 2026-06-07 |
| Status | Intentional redesign |

**Spec (F-024):** `POST /connections/{id}/custodian-key` attaches a custodian key to a specific connection and transitions that connection to `active`.

**Implementation:** Custodian API keys are managed at the org level via `POST /custodians` and `GET /custodians`. The `connections` table has no `custodian_link_id` column. Connection activation happens at `accept` (F-023), not at key registration.

**Why:** A supplier may lend from the same inventory pool to multiple agent connections simultaneously. The same collateral can be managed by different custodians. Binding a custodian key to a single connection prevents a supplier from managing multiple custodian relationships independently of their connection portfolio.

**Impact:** FEATURES.md F-024 fully rewritten. F-025 updated to add `reactivate` endpoint (previously re-keying served as implicit reactivation).

---

## SD-003 — F-031 amend is agent-only (spec said "Supplier, Agent")

| Field | Value |
|---|---|
| Feature | F-031 — Agreement term change and re-confirmation flow API |
| Milestone | M3 |
| Discovered | 2026-06-07 |
| Status | Intentional, not a bug |

**Spec (F-031):** Actor listed as "Supplier, Agent".

**Implementation:** `PUT /agreements/{id}` requires agent JWT. Supplier JWT returns HTTP 403.

**Why:** Consistent with F-029 (agent proposes terms). The supplier's role in the agreement flow is to review and confirm terms proposed by the agent, not to draft them. Allowing the supplier to amend would create ambiguity about whose proposed terms govern the program.

---

## SD-004 — F-035 `below_minimum_size` deferred until agreement model has minimum size

| Field | Value |
|---|---|
| Feature | F-035 — Loan booking API endpoint |
| Milestone | M4 |
| Discovered | 2026-06-07 |
| Status | Deferred acceptance criterion |

**Spec (F-035):** Booking with `quantity` below the agreement minimum returns HTTP 422 with code `"below_minimum_size"`.

**Implementation:** The M3 `lending_agreements` table and agreement schemas do not contain a `minimum_loan_size` field. M4 validates quantity is positive, validates max fixed-term days, validates asset/collateral scope, validates approved borrower, validates agreement confirmation, and checks mock custodian inventory, but it does not enforce `below_minimum_size`.

**Why:** Adding a hidden default or new agreement term in M4 would change the already-confirmed M3 agreement contract. The criterion should be implemented when agreement terms are explicitly extended with `minimum_loan_size` and both agreement UI plus agreement versioning include that field.

**Impact:** F-035 is complete except for the `below_minimum_size` branch. Any tests for that branch should remain skipped/absent until the agreement model is extended.

---
