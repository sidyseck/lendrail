# LendRail — PRD Delta: Loan Booking Ticket Price, LTV, and Collateral Derivation

| Field | Value |
|---|---|
| Delta ID | PRD-D-002 |
| Amends | MASTER_PRD.md v0.1 |
| Related features | F-029, F-030, F-035, F-038, F-043, F-064 |
| Date | 2026-06-08 |
| Status | Draft — awaiting product sign-off |

---

## 1. What the current PRD says

The current PRD defines loan booking as an agent-entered workflow. The agent enters borrower, asset type, quantity, rate, term, collateral type, collateral quantity, and collateral valuation. The platform then validates that the initial LTV meets the agreement threshold.

That is directionally correct, but it leaves the booking ticket under-specified:

- It does not say what asset price the booking ticket uses.
- It does not define whether the agent can override the market price used for a ticket.
- It treats supplier-agent agreement LTV terms as hard booking guards, but the desired workflow is to use them as guidance/defaults and warn on override instead of blocking.
- It does not define how collateral value is derived from price, quantity, and LTV.
- It does not make margin call and liquidation thresholds editable borrower-loan terms.

---

## 2. Product Delta

The loan booking ticket should be compact, because the required information is operationally small. It should live as a concise ticket/strip at the top of the Loans screen, with room for a future drawer expansion if advanced booking details are needed later.

### New booking-ticket behavior

When the agent books a loan, the ticket must show:

| Field | Default | Editable | Purpose |
|---|---|---:|---|
| Supplier inventory | Selected from available inventory | Yes | Chooses connection and lent asset |
| Borrower | Existing approved borrower | Yes | Loans can only be booked for approved borrowers |
| Quantity | Empty | Yes | Lent asset quantity |
| Asset price | Current market price from `MarketDataAdapter` | Yes | Used to compute loan value and collateral value |
| Booking LTV | Supplier-agent agreement `initial_ltv_pct` | Yes | Executed loan term used to compute required collateral value |
| Collateral value | `quantity * asset_price_usd * booking_ltv_pct / 100` | Yes | If edited directly, the ticket recomputes implied booking LTV |
| Margin call threshold | Supplier-agent agreement `margin_call_ltv_pct` | Yes | Executed borrower-loan threshold |
| Liquidation threshold | Supplier-agent agreement `liquidation_ltv_pct` | Yes | Executed borrower-loan threshold |
| Rate, term, maturity, collateral type, collateral quantity | Existing booking fields | Yes | Required booking economics and collateral metadata |

The ticket must make the relationship between price, LTV, and collateral value obvious without crowding the screen:

- Price, LTV, and collateral value should sit next to each other as the central calculation group.
- Margin call and liquidation thresholds should be visible and editable, but visually secondary to the central price/LTV/collateral calculation group.
- If the user changes asset price, recompute collateral value using the current quantity and booking LTV.
- If the user changes booking LTV, recompute collateral value using the current quantity and asset price.
- If the user changes collateral value, recompute implied booking LTV using `collateral_value_usd / (quantity * asset_price_usd) * 100`.
- If any of quantity, price, LTV, or collateral value is missing, do not attempt a derived calculation.

### Agreement guidance and warning behavior

The supplier-agent agreement and the borrower loan are different contracts:

- The supplier-agent agreement records the lender/supplier's guidance and minimum desired protections for inventory made available to the agent.
- The borrower loan records the actual economics negotiated between the agent and the borrower.

For MVP, the platform should not block booking solely because borrower-loan parameters differ from supplier-agent agreement guidance.

Instead:

- The ticket defaults booking LTV to the agreement `initial_ltv_pct`.
- The ticket defaults margin call threshold to the agreement `margin_call_ltv_pct`.
- The ticket defaults liquidation threshold to the agreement `liquidation_ltv_pct`.
- If the agent changes booking LTV, margin call threshold, or liquidation threshold away from the agreement defaults, show an inline warning.
- If the recomputed implied LTV from a manually edited collateral value differs from the agreement default, show the same warning.
- The warning is informational and does not block `POST /loans`.
- A post-MVP workflow may let the supplier review and approve borrower-loan terms that are more aggressive than supplier guidance. That intervention workflow is out of scope for MVP.

The warning copy should be short and operational:

> Loan terms differ from supplier guidance.

### Liquidation threshold

Liquidation threshold must become an agreement term because it needs to appear in the booking ticket and later risk workflows.

Agreement term ordering:

```text
0 < initial_ltv_pct < margin_call_ltv_pct < liquidation_ltv_pct
```

This delta does not define liquidation automation. It requires the threshold to be captured in supplier-agent agreement guidance and stored again on the executed borrower loan.

---

## 3. Impact on Existing Features

| Feature | Impact |
|---|---|
| F-029 / F-030 Agreement terms | Add `liquidation_ltv_pct` to agreement schema, validation, confirmation UI, and read-only agreement display. Treat agreement LTV terms as supplier guidance/defaults for borrower loans. |
| F-035 Loan booking API | Add booking price, booking LTV, margin call threshold, and liquidation threshold to the booking request and persisted loan record. Remove hard rejection when borrower-loan terms differ from supplier-agent guidance. |
| F-038 Agreement guard | Still required. Booking still requires the latest agreement to be dual-confirmed. |
| F-064 Loan booking UI | Replace the simple collateral-value input with a compact calculation group: price, booking LTV, collateral value, margin call threshold, liquidation threshold. |
| F-043 Risk monitoring | Margin-call logic should use executed loan thresholds, not supplier-agent agreement defaults. Future liquidation logic should do the same. This delta does not implement liquidation state transitions. |

---

## 4. Acceptance Criteria

- [ ] Booking ticket defaults asset price from current market data for the selected asset.
- [ ] Agent may override asset price before submitting the booking.
- [ ] Booking ticket defaults booking LTV from the agreement `initial_ltv_pct`.
- [ ] Agent may override booking LTV before submitting the booking.
- [ ] Changing quantity, asset price, or booking LTV recomputes collateral value.
- [ ] Changing collateral value recomputes implied booking LTV.
- [ ] Booking ticket defaults margin call threshold from the agreement `margin_call_ltv_pct`.
- [ ] Booking ticket defaults liquidation threshold from the agreement `liquidation_ltv_pct`.
- [ ] Agent may override margin call and liquidation thresholds before submitting the booking.
- [ ] If booking LTV, margin call threshold, or liquidation threshold differs from supplier-agent agreement guidance, the ticket shows a warning and still allows submission.
- [ ] Backend persists the booking asset price, booking LTV, margin call threshold, and liquidation threshold used at booking time.
- [ ] Backend no longer rejects a booking solely because borrower-loan terms differ from supplier-agent agreement guidance.
- [ ] Backend still validates borrower approval, asset scope, collateral eligibility, dual-confirmed agreement, published inventory, and custodian inventory.

---

## 5. Out of Scope

- Liquidation workflow or automatic liquidation state transition.
- Supplier review/approval workflow for borrower-loan terms that differ from supplier guidance.
- Market data charting.
- Real market data provider integration beyond the existing market data adapter contract.
- Drawer expansion for advanced ticket details.
- Borrower onboarding inside the loan booking ticket.
