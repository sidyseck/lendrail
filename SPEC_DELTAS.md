# Spec Deltas

Known intentional deviations from FEATURES.md. Each entry records what the spec says,
what the implementation does, and why.

---

## SD-001 — Connection `accept` introduces `accepted` intermediate status

| Field | Value |
|---|---|
| Feature | F-023 — Agent accepts connection invitation API |
| Milestone | M2 |
| Discovered | 2026-06-07 |

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

**Resolution options (if alignment with spec is required):**
1. Collapse `accepted` back to `pending` and use a separate boolean `agent_accepted_at` timestamp on the connection row to distinguish the two waiting states.
2. Update FEATURES.md F-021 and F-023 to canonize the `accepted` status (preferred — the implementation is more explicit).

---
