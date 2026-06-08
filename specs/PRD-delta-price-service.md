# LendRail — PRD Delta: Indicative Price Service

| Field | Value |
|---|---|
| Delta ID | PRD-D-003 |
| Amends | MASTER_PRD.md v0.1, PRD-D-002 |
| Related features | F-070 (Price Service), F-064 (Loan Booking UI), F-063 (Agent Inventory Screen) |
| Date | 2026-06-08 |
| Status | Draft — awaiting product sign-off |

---

## 1. Context

PRD-D-002 established that the loan booking ticket must show the current market price for the lent asset and use it to derive collateral value. It referenced a `MarketDataAdapter` contract but left the actual price delivery mechanism out of scope:

> "Real market data provider integration beyond the existing market data adapter contract" is listed as out of scope.

This delta specifies the price service that fills that gap: a simulated streaming price feed that drives the booking ticket and the inventory screen for the demo phase. It intentionally avoids a real external provider dependency until the platform has a production trading partner.

---

## 2. What Changes

### 2.1 Price Service

A price service runs inside the backend. It:

- Maintains a live indicative price for each supported asset (initially BTC and ETH).
- Updates prices continuously by applying a random walk constrained to ±2% of a configured base price.
- Makes the current price available to:
  - The existing `GET /market-data/prices/{asset_type}` endpoint (point-in-time read).
  - A new streaming endpoint that pushes updates to connected clients.

For the demo, prices are fully simulated. The service architecture is designed so a real external feed (e.g., a WebSocket connection to a market data provider) can replace the simulator without any changes to the consumers.

**Base prices (demo):**

| Asset | Base price (USD) | Max deviation |
|---|---|---|
| BTC | $63,500 | ±2% |
| ETH | $1,700 | ±2% |

### 2.2 Loan Booking Ticket

The booking ticket (BookLoanStrip) currently requires the agent to type an asset price manually. With this delta:

- The ticket fetches the latest indicative price for the selected asset automatically.
- The fetched price pre-fills the asset price field.
- The agent may override the pre-filled price before submitting.
- The price field updates when the agent changes the selected inventory row (which may change the asset type).
- The ticket does not live-tick the price during a session — it fetches once on load and once when the inventory selection changes. The agent is expected to refresh if they want a fresher price before booking.

### 2.3 Inventory Screen — USD Equivalent

The agent's Available Inventory screen (Aggregated Totals section) currently shows asset quantity only. With this delta:

- A "USD value" column appears alongside "Total available".
- The column shows `quantity × indicative_price_usd` for each asset row.
- Prices are fetched on page load via the streaming endpoint and kept live for the duration of the session.
- If a price is unavailable, the column shows a dash.

---

## 3. What Does NOT Change

- The loan booking fields (asset price, LTV, collateral value) remain fully editable. The pre-filled price is a convenience default, not a locked system value.
- The price used at booking time is the value the agent submits in the form, not a server-side re-fetch.
- No audit trail of indicative prices is required beyond what already lives on the booked loan record (`asset_price_usd`).
- Supplier inventory screen does not need price data at this stage.

---

## 4. Impact on Existing Features

| Feature | Impact |
|---|---|
| F-064 Loan Booking UI (BookLoanStrip) | Asset price field is pre-populated from the price service. Field remains editable. |
| F-063 Agent Inventory Screen | Aggregated Totals table gains a live USD equivalent column. |
| Existing `GET /market-data/prices/{asset_type}` | No change to the endpoint contract. The backend implementation switches from a static config value to the live simulated price. |

---

## 5. Acceptance Criteria

- [ ] BTC and ETH prices update continuously in the backend, constrained to ±2% of their configured base prices.
- [ ] `GET /market-data/prices/BTC` returns the current simulated price, not a static config value.
- [ ] `GET /market-data/prices/ETH` returns the current simulated price.
- [ ] A streaming endpoint delivers price updates to connected frontend clients.
- [ ] On the booking ticket, the asset price field is pre-populated with the current indicative price when inventory is selected.
- [ ] The agent can override the pre-populated price before booking.
- [ ] Changing the selected inventory row (and thus asset type) refreshes the pre-populated price.
- [ ] The Aggregated Totals section shows a USD equivalent column.
- [ ] The USD equivalent updates live while the agent is on the inventory screen.
- [ ] If a price is not available, the USD equivalent column shows a dash rather than an error.
- [ ] A price simulator can be replaced by a real external feed without changes to consumers.

---

## 6. Out of Scope

- Real external market data provider integration.
- Historical price charting or time-series storage.
- Price staleness alerts.
- Per-loan mark-to-market revaluation triggered by price moves.
- Automated margin call triggers based on live price (that belongs to F-043 / risk monitoring).
- Supplier inventory screen USD equivalent.
