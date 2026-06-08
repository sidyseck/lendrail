# LendRail — PRD Delta: Inventory Management Screens

| Field | Value |
|---|---|
| Delta ID | PRD-D-001 |
| Amends | MASTER_PRD.md v0.1 |
| Related features | F-061 (inventory scope), F-048 (in-app notifications) |
| Date | 2026-06-08 |
| Status | Draft — awaiting product sign-off |

---

## 1. What the original PRD says (and what it does not)

The original PRD references inventory in two places:

- **F1.4** names an *inventory feed* as a data source for validating loan bookings and populating "the supplier's availability list." It defines the feed structure but never defines what the availability list looks like as a user-facing screen.
- **F2** states "once connected, the agent can see the supplier's availability list and program parameters." Again, the phrase "availability list" appears but is never given a screen definition, data shape, or actor workflow.
- **F5** (Risk Cockpit) includes portfolio-level metrics such as "total assets on loan" and "concentration per borrower." That surface answers *are my loans safe right now?* It is a monitoring view, not an inventory management view.

**What is not defined anywhere in the PRD or FEATURES.md:**

1. A dedicated supplier screen for viewing custodian positions and managing per-agent allocations.
2. A dedicated agent screen for viewing available inventory across their connected suppliers.
3. The supplier action of publishing or reducing an inventory allocation from the platform UI (F-061 defines the API and data model; neither the PRD nor any existing feature defines the screen).
4. Any concept of the agent being notified in-platform when a supplier changes their allocation.
5. The breakdown of "available" inventory by supplier on the agent side.

This delta defines those surfaces.

---

## 2. Delta scope

This delta adds one new feature area — **F7 — Inventory Management** — to the MASTER_PRD. It does not change any existing feature area.

---

## F7 — Inventory Management

### Philosophy

The inventory management surface is the supplier's command center for their lending program before and apart from loan-level activity. The risk cockpit (F5) tells the supplier whether their active loans are healthy. The inventory management screen tells the supplier what they own, where it sits, how much they have made available to each agent, and how much of that is currently deployed on loan. The supplier acts here — not at the loan level — to adjust capacity.

The agent's counterpart is an availability dashboard: a read-only view of how much lending capacity each of their connected suppliers has made available, broken down by asset type and supplier. The agent uses this screen to understand what they can offer borrowers before booking a loan.

These two screens are the primary surfaces where the supplier-agent relationship becomes visible as an inventory flow rather than a legal/compliance construct.

---

### F7.1 — Supplier Inventory Management Screen

**Actor:** Supplier

**Where:** A top-level dashboard page, separate from the risk cockpit and the connections page. Suggested route: `/dashboard/inventory`.

**Mental model:** The supplier is looking at their entire asset estate — not just what is on loan. The screen answers three questions at once:

1. *What do I own, and where is it held?*
2. *How much have I made available to each of my agents?*
3. *How much of what I made available is currently on loan?*

#### What the screen shows

**Section A — Custodian positions (read-only)**

One row per custodian account × asset type. Pulled live from the custodian inventory feed.

| Column | Description |
|---|---|
| Custodian | Name of the custodian holding this balance (e.g., Anchorage, mock) |
| Account ref | The custodian account identifier |
| Asset type | e.g., BTC, ETH |
| Total balance | Raw quantity held at this custodian account |
| As of | Timestamp of the last feed refresh |

The total balance shown here is the ground truth from custody. It does not change based on how much the supplier has chosen to publish — it reflects actual holdings.

**Section B — Allocation to agents**

One panel per active connection. Each panel shows the supplier's allocation decisions for that specific agent.

| Column | Description |
|---|---|
| Agent | Agent organization name |
| Asset type | One row per asset type in the connection's inventory scope |
| Total at custodian | Raw balance for this asset (same as Section A; repeated here for decision context) |
| Published to agent | Quantity the supplier has chosen to make available to this agent |
| On loan via this agent | Quantity currently outstanding in non-terminal loans through this connection |
| Remaining available | Published − On loan. What the agent can still draw on. |

The supplier can see all their agent connections side by side, so they can make allocation decisions with full context (e.g., "I've given Agent A 100 BTC and Agent B 50 BTC; my total balance is 200 BTC; I still have 50 unpublished").

**Section C — Allocation controls (inline edit)**

Directly on each agent panel row, the supplier can:

- **Increase published quantity:** enter a new, higher quantity and save. Takes effect immediately.
- **Reduce published quantity:** enter a lower quantity and save. If the new quantity is below the current on-loan amount, the platform warns the supplier ("You are reducing below the currently on-loan quantity. Existing loans are not affected.") but does not block the action.
- **Set to zero:** removes the allocation for that asset type. Blocks all new loan bookings for this asset on this connection. Existing loans continue to run.

**Important constraint:** The supplier sets allocations per connection. The platform does not enforce that the sum of all allocations across agents is ≤ the total custodian balance — the supplier is responsible for that arithmetic. The platform will not double-book: at loan-booking time, available inventory is checked against both the custodian balance and the published allocation (whichever is lower). But the supplier is not prevented from publishing the same inventory to two agents simultaneously.

> **Design rationale:** In practice, a supplier may legitimately publish the same pool to two agents if they are confident that demand will not exceed total holdings. Enforcing hard exclusivity would require complex reservation logic and would constrain legitimate use cases. The platform surfaces the information; the supplier makes the decision.

#### What the screen does NOT show

- Loan-level detail (that is the risk cockpit, F5)
- LTV or collateral information (F5)
- Borrower identity (F5)
- Fee accrual or statements (F6)

#### Acceptance criteria

- [ ] Supplier can navigate to `/dashboard/inventory` from the main dashboard nav.
- [ ] Section A shows one row per custodian × asset type returned by the inventory feed, with balance and as-of timestamp.
- [ ] Section B shows one panel per active or suspended connection.
- [ ] Each panel shows published quantity, on-loan quantity, and remaining available per asset.
- [ ] Supplier can edit published quantity inline and save. The change is reflected immediately (optimistic UI or refetch).
- [ ] Reducing below the on-loan amount displays a warning, but the save is not blocked.
- [ ] Setting a quantity to zero displays a confirmation prompt: "Setting this to zero will block new bookings for [asset] on this connection."
- [ ] A connection with no published inventory shows "No inventory published. Click + to publish."
- [ ] Connections in `pending` or `terminated` status are not shown in Section B (only `active` and `suspended`).
- [ ] Each Section A balance shows an as-of timestamp. If the feed is stale (beyond the configured threshold), the row is flagged with a staleness indicator (reuse the pattern from F5/F-046).

---

### F7.2 — Agent Available Inventory Screen

**Actor:** Agent

**Where:** A top-level dashboard page. Suggested route: `/dashboard/available-inventory`.

**Mental model:** The agent is preparing to book loans. They need to know how much capacity they have access to — the total available, and which supplier each chunk of capacity comes from. This screen is their sourcing view before loan booking.

#### What the screen shows

**Section A — Total available by asset type**

Aggregated across all active supplier connections.

| Column | Description |
|---|---|
| Asset type | e.g., BTC |
| Total available | Sum of `effective_available` across all connected suppliers for this asset type |
| On loan | Sum of outstanding non-terminal loan quantity for this asset type across all connections |
| Net remaining | Total available − On loan |

This gives the agent a single number to answer "how much BTC can I lend right now?"

**Section B — Breakdown by supplier**

One row per active connection × asset type.

| Column | Description |
|---|---|
| Supplier | Supplier organization name |
| Asset type | |
| Available from this supplier | `effective_available` for this connection and asset |
| On loan via this supplier | Non-terminal loan quantity for this connection and asset |

The agent does not see the supplier's total custodian balance or their raw published quantity — only the effective available after the supplier's allocation and existing loans are accounted for.

**Allocation change notifications (in-screen)**

When a supplier changes their inventory allocation for a connection this agent is on, the agent's available inventory screen updates to reflect the new effective available. Additionally:

- A badge appears on the `/dashboard/available-inventory` nav link indicating that one or more supplier allocations have changed since the agent last viewed the screen.
- The affected supplier row in Section B is highlighted (e.g., a "Updated" chip with a relative timestamp: "Updated 5 min ago") until the agent acknowledges it by viewing the screen.
- An in-app notification (F-048) is also sent with event `"supplier_allocation_changed"`, containing the supplier name, asset type, and the new effective available quantity.

> **Why in-screen notification matters:** The agent may have been counting on a particular supplier's capacity when preparing a loan booking. If that capacity changes — either increased (new opportunity) or decreased (constraint) — the agent needs to know before they reach the booking form and get a validation error. Surfacing it on the inventory screen, rather than only in a notification bell, puts the information where the agent is most likely to be when it is actionable.

#### Acceptance criteria

- [ ] Agent can navigate to `/dashboard/available-inventory` from the main dashboard nav.
- [ ] Section A shows one row per asset type with total available, on loan, and net remaining.
- [ ] Section B shows one row per active connection × asset type where `effective_available > 0`.
- [ ] Connections with no published inventory for any asset type are not shown in Section B.
- [ ] Supplier's total custodian balance is NOT shown anywhere on the agent screen.
- [ ] Supplier's raw published quantity is NOT shown anywhere on the agent screen (only effective_available).
- [ ] When a supplier changes their allocation, the affected row in Section B is highlighted with a relative timestamp.
- [ ] A badge count on the nav link reflects the number of allocation changes since last visit.
- [ ] Clicking the row or visiting the screen clears the badge and removes the highlight.
- [ ] An in-app notification `"supplier_allocation_changed"` is sent to all users of the agent org when a connected supplier changes their allocation. The notification payload includes: `supplier_org_id`, `connection_id`, `asset_type`, `new_effective_available`.
- [ ] TypeScript compiles with zero errors.

---

## 3. Impact on existing features

| Feature | Impact |
|---|---|
| **F-061** (inventory scope API) | This delta defines the UI surfaces that expose F-061's `PUT /connections/{id}/inventory-scope` and `GET /connections/{id}/inventory` endpoints. No API changes. |
| **F-024** (custodian API key) | The supplier inventory screen (Section A) sources its data from the same custodian adapter call used in F-024 and F-035. No new API. |
| **F-026** (connection list API) | The supplier inventory screen's Section B is driven by the connection list. No new endpoint needed — the existing `GET /connections` plus `GET /connections/{id}/inventory` per connection are sufficient. |
| **F-046** (risk cockpit UI) | Risk cockpit remains focused on loan health (LTV, margin calls). The inventory screen is a separate route. Navigation should make the distinction clear: "Inventory" vs. "Risk Cockpit." |
| **F-048** (in-app notifications) | The `"supplier_allocation_changed"` event must be added to the notification service. It fires from `ConnectionService.set_inventory_scope()` when the scope is updated on an active connection. Recipients are all users of the agent org on that connection. |
| **F-027** (connection management UI) | The `PUT /connections/{id}/inventory-scope` action is removed from the connection detail view (if it was placed there) and lives exclusively on the inventory management screen. The connection detail continues to show connection status and agreement status only. |

---

## 4. What this delta does NOT include

- **Multi-custodian aggregation across accounts for the same asset:** If a supplier has BTC at two custodian accounts (e.g., two separate Anchorage accounts), the screen shows two rows in Section A. Aggregation across accounts is deferred — the platform does not combine balances across custodian links in MVP.
- **Reservation/earmarking:** The platform does not hard-reserve inventory for a specific agent. Publishing is advisory. The effective check happens at loan booking time.
- **Real-time push updates:** The agent screen refreshes when the user navigates to it or manually refreshes. WebSocket / server-sent events for live updates are deferred.
- **Historical allocation changes:** The screen shows the current allocation only. An audit log of past allocation changes is deferred.
- **Cross-program aggregation:** If the supplier has connections to multiple agents for the same asset type, the screen shows each connection's allocation separately. A single "total published across all agents" aggregate is not shown in MVP (would obscure the per-agent granularity that matters most for the supplier).

---

## 5. Feature IDs to add to FEATURES.md

| Feature ID | Milestone | Title |
|---|---|---|
| F-062 | M2 (extension) | Supplier inventory management screen |
| F-063 | M2 (extension) | Agent available inventory screen |

Both features depend on F-061 (inventory scope API) being implemented first.

F-062 additionally depends on: F-024 (custodian link), F-026 (connection list), F-046 pattern (staleness flag).

F-063 additionally depends on: F-061, F-048 (notification delivery), F-026.
