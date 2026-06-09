# Functional Spec — LendRail Loans Page Redesign (Booking Ticket + Blotter)

**Spec ID:** SPEC-loan-redesign-001
**Authoritative sources:** PRD-D-002, F-064, F-035, F-038, frontend-design skill
**Author:** Specifier (3-agent: Specifier -> Designer -> Executor)
**Date:** 2026-06-09
**Status:** Ready for Designer + Executor

This document defines **behavior, data flow, and acceptance criteria**. It does not contain component code. Layout/visual decisions are explicitly delegated to the Designer (Section 9). All behavior in Sections 2-8 is **fixed** and must be implemented as written.

---

## 0. Files in scope (verified)

| File | Role | Touched by Executor |
|---|---|---|
| `/home/user/lendrail/frontend/src/components/loans/BookLoanStrip.tsx` | Booking ticket being redesigned | Yes — rewrite |
| `/home/user/lendrail/frontend/src/pages/loans/LoanListPage.tsx` | Page hosting ticket + blotter | Yes — layout/compose |
| `/home/user/lendrail/frontend/src/types/loan.ts` | `LoanBookingRequest` / `Loan` contract | **No change needed** (see Gap A) |
| `/home/user/lendrail/frontend/src/api/loanApi.ts` | `bookLoan` wrapper | Likely — expose error `code` (Gap C) |
| `/home/user/lendrail/frontend/src/api/agreementApi.ts` | `getLatestAgreement(connectionId)` | Reused — no change (Gap B) |
| `/home/user/lendrail/frontend/src/api/priceApi.ts` | `getMarketPrice(assetType)` | Optional — see Section 2 price note |
| `/home/user/lendrail/frontend/src/hooks/useAgentInventory.ts` | Inventory breakdown rows | Reused — no change |
| `/home/user/lendrail/frontend/src/hooks/usePriceStream.ts` | Live `PriceMap` keyed by asset_type | Reused — no change |
| `/home/user/lendrail/frontend/src/types/agreement.ts` | `Agreement` (has the 3 LTV terms) | Reused — no change |

---

## 1. Goals & Non-Goals

### Goals (each cites acceptance criteria)
- **G1. Compact, focused ticket.** Replace the cramped 12-col strip with a compact ticket whose central calculation group (price / booking LTV / collateral value) is visually primary. *(PRD-D-002 §2; F-064 AC "shows the compact booking strip"; user problem #1.)*
- **G2. Interdependent recalculation.** Editing quantity, asset price, or booking LTV recomputes collateral value; editing collateral value recomputes implied booking LTV. *(PRD-D-002 §2 recalc bullets; F-064 ACs "Changing quantity/asset price/booking LTV recomputes collateral value", "Changing collateral value recomputes implied booking LTV"; user problem #2.)*
- **G3. Secured-loan framing.** Present the loan as secured-by-collateral: the price -> LTV -> collateral-value chain is the central safety mechanism, with margin-call and liquidation thresholds visible but secondary. *(PRD-D-002 §2 "central calculation group"; user problem #3.)*
- **G4. Agreement-guidance defaults + warning.** Default booking LTV / margin-call / liquidation thresholds from the connection's active agreement; warn (non-blocking) on divergence. *(PRD-D-002 §2 warning behavior; F-064 ACs on defaults + warning.)*
- **G5. Dual quantity+value display + live preview.** Show dollar equivalents beside every quantity and a running booking summary. *(frontend-design skill: dual display, live preview.)*
- **G6. Integrated blotter.** Keep the loan list on the same page, role-gated, well integrated. *(F-064 "above the loan list"; user problem #4.)*
- **G7. Inline backend error surfacing.** Surface F-035 booking error codes inline. *(F-064 AC error list.)*

### Non-Goals (out of scope — do not build)
- Drawer expansion for advanced ticket fields. *(PRD-D-002 §5; F-064 out-of-scope.)*
- Inline borrower creation in the ticket — link to `/dashboard/borrowers` only. *(F-064 AC; out-of-scope.)*
- **Any backend change.** The `POST /loans` contract, agreement schema, and warning semantics are backend-complete for this work. This is a **frontend-only** redesign. *(See Gap A; PRD backend deltas in F-035 are assumed already shipped because `LoanBookingRequest` already carries the fields.)*
- Liquidation automation / supplier approval workflow for aggressive terms / market charting / new market-data provider. *(PRD-D-002 §5.)*
- Shorthand-number entry (`1m`, `500k`) is **optional polish** (Section 9 Q7), not required.

---

## 2. Field Inventory

All ticket fields map to existing `LoanBookingRequest` fields (verified in `types/loan.ts`). Quantities are sent as **strings** (decimal-as-string); `rate_bps` is a **number**.

| Ticket field | Default source | Editable | Role | Maps to `LoanBookingRequest` |
|---|---|---|---|---|
| Supplier inventory | Selected from `useAgentInventory().breakdown`; preselected via `?connection_id&asset_type` query | Yes | Chooses `connection_id` + `asset_type` | `connection_id`, `asset_type` (derived from selected row) |
| Borrower | `listApprovedBorrowers(connection_id)` for selected connection | Yes | Loan owner (approved only) | `borrower_id` |
| Quantity | Empty (placeholder shows effective available for selected inventory) | Yes | Lent asset quantity | `quantity` |
| Asset price | Live `usePriceStream()[asset_type]` snapshot at asset-change (current behavior); see price note below | Yes | Drives loan value + collateral value | `asset_price_usd` |
| Booking LTV % | Agreement `initial_ltv_pct` | Yes | Executed loan term; drives collateral value | `booking_ltv_pct` |
| Collateral value USD | Computed `quantity * asset_price_usd * booking_ltv_pct / 100` | Yes | If edited, recomputes implied booking LTV | `collateral_value_usd` |
| Margin call LTV % | Agreement `margin_call_ltv_pct` | Yes (secondary) | Executed borrower-loan threshold | `margin_call_ltv_pct` |
| Liquidation LTV % | Agreement `liquidation_ltv_pct` | Yes (secondary) | Executed borrower-loan threshold | `liquidation_ltv_pct` |
| Rate (bps) | Empty | Yes | Loan economics | `rate_bps` (Number) |
| Term | `open` | Yes | open/fixed | `term_type` |
| Maturity date | Empty (shown only when `term_type==='fixed'`) | Yes (required if fixed) | Maturity | `maturity_date` (null when open) |
| Collateral type | `CASH_USD` | Yes | Collateral metadata | `collateral_type` |
| Collateral quantity | See Section 3.4 (CASH vs non-CASH) | Yes | Collateral metadata | `collateral_quantity` |

**Price snapshot note (preserve current behavior, do NOT regress):** The existing strip snapshots the price **once** when the selected `asset_type` changes (via a `latestPrices` ref) and does **not** re-snapshot on every live tick, so the operator's edits are never clobbered. This must be preserved. Optionally the Executor may seed the initial price from `getMarketPrice(asset_type)` (F-064 AC references the market-price read endpoint backed by `MarketDataAdapter`), but the price-stream snapshot already satisfies "defaults asset price from current market data." **Decision (fixed):** keep the stream snapshot as the default source; the REST `getMarketPrice` call is optional and must not introduce live-tick clobbering.

---

## 2A. CRITICAL GAP ANALYSIS (Executor: read this before estimating)

### Gap A — Type set already complete (PRD warning is STALE) — NO type/API change
The prompt warned that `types/loan.ts` may not carry `asset_price_usd` / `booking_ltv_pct` / `margin_call_ltv_pct` / `liquidation_ltv_pct`. **Verified false.** `LoanBookingRequest` (lines 41-56 of `types/loan.ts`) already contains all four, and the current `BookLoanStrip.tsx` already submits all four in its payload (lines 141-144). **No type extension, no API-contract change, no backend change is required.** This is a UI-only redesign plus recalc/agreement wiring. Treat the PRD's F-035 backend deltas as already shipped.

### Gap B — Agreement terms are NOT fetched by the ticket — must be wired (frontend-only)
`BookLoanStrip.tsx` currently has **no agreement fetch**. The LTV inputs start blank, so the PRD/F-064 defaults ("default booking LTV from agreement `initial_ltv_pct`", etc.) and the divergence warning are **not implementable as-is**. **However**, `getLatestAgreement(connectionId)` already exists in `agreementApi.ts` and returns an `Agreement` with `initial_ltv_pct`, `margin_call_ltv_pct`, `liquidation_ltv_pct` (all strings). **Executor must wire it in** (no new API needed):
- On selected-connection change, call `getLatestAgreement(selected.connection_id)`.
- Store the returned agreement as `agreementDefaults` (may be `null` if 404 — handle gracefully).
- Seed booking LTV / margin call / liquidation inputs from it (only when the field is empty/at-default, never overwriting an in-progress edit).
- Use it as the **source of truth for the warning comparison** (Section 5).
- If `getLatestAgreement` returns `null`, leave LTV fields blank/operator-entered and **suppress the divergence warning** (no baseline to compare against); booking still allowed.

### Gap C — `bookLoan` discards the error `code` — must expose it for inline mapping
`loanApi.ts#bookLoan` throws `new Error(parseErrorMessage(...))`, which surfaces only `error.message`. F-064 requires surfacing specific **codes** inline (`borrower_not_approved`, `no_inventory_published`, `exceeds_published_inventory`, `asset_not_in_scope`, `collateral_not_eligible`, `no_active_agreement`, `agreement_not_fully_confirmed`; F-035 adds `below_minimum_size`, `insufficient_inventory`). **Executor must** attach the parsed `code` to the thrown error (mirror the pattern already used in `agreementApi.ts#confirmAgreement`, which sets `(err as Error & { code?: string }).code`). Then the ticket maps `code` -> field-anchored copy (Section 6.3). This is a tiny, localized change.

**Net gap summary for Executor:** No backend work, no type work. Two small frontend wiring tasks (B: fetch agreement; C: expose error code) plus the full ticket UI/recalc rewrite (Sections 3-8).

---

## 3. Recalculation Engine (deterministic — FIXED behavior)

### 3.1 Numeric model
- All quantity/price/value/LTV fields are held as **strings** in form state (free text, decimal-as-string) to match the API contract and allow partial input (`"1."`, `""`).
- For computation, parse with a single helper `num(s) => Number(s)`; treat a value as **present** only if the trimmed string is non-empty **and** `Number.isFinite(num(s))` **and** `num(s) > 0` (LTV and price and quantity must be strictly positive to participate). Collateral value participates if finite and `> 0`.
- **The edited field always wins** (is the source of truth) for that keystroke. Recalculation writes only to the *target* field(s) and never back into the edited field. This is the loop-prevention rule.

### 3.2 Source-of-truth / trigger table

| Operator edits | Recompute | Formula | Guard (skip if any missing/non-positive) |
|---|---|---|---|
| **quantity** | `collateral_value_usd` | `quantity * asset_price_usd * booking_ltv_pct / 100` | quantity, asset_price_usd, booking_ltv_pct |
| **asset_price_usd** | `collateral_value_usd` | `quantity * asset_price_usd * booking_ltv_pct / 100` | quantity, asset_price_usd, booking_ltv_pct |
| **booking_ltv_pct** | `collateral_value_usd` | `quantity * asset_price_usd * booking_ltv_pct / 100` | quantity, asset_price_usd, booking_ltv_pct |
| **collateral_value_usd** | `booking_ltv_pct` (implied) | `collateral_value_usd / (quantity * asset_price_usd) * 100` | quantity, asset_price_usd, collateral_value_usd |
| **margin_call_ltv_pct** | (nothing recomputes) | — | — |
| **liquidation_ltv_pct** | (nothing recomputes) | — | — |
| **collateral_type** | may reset `collateral_quantity` linkage | see 3.4 | — |
| **collateral_quantity** | see 3.4 | see 3.4 | — |

**Loop prevention is structural:** the four central fields form a directed flow — quantity/price/LTV -> collateral_value, and collateral_value -> booking_ltv. Because the *edited* field is never a recompute target on its own edit, and the two directions are triggered by *different* edited fields, there is no feedback cycle. Do **not** implement a generic "recompute everything" effect; implement per-field handlers exactly as the table specifies.

### 3.3 Guards & precision (FIXED)
- **Missing-input guard:** If any required input for the active formula is absent or non-positive, **do not write** the target — leave the target's existing string untouched (do not clear it, do not write `NaN`, `0`, `Infinity`, or empty). This prevents a half-typed price from wiping a value the operator typed.
- **Division-by-zero:** the `> 0` guards on quantity and price make the implied-LTV denominator always positive when it computes; otherwise skip.
- **Rounding (display + persisted string):**
  - `collateral_value_usd`: round to **2 decimal places** (USD cents). Write as `value.toFixed(2)`.
  - `booking_ltv_pct` (implied): round to **2 decimal places**. Write as `value.toFixed(2)`.
  - `asset_price_usd` default snapshot: keep existing `toFixed(2)`.
  - These are the *written* precisions. Derived **display** values (Section 4) may show thousands separators but the underlying form string stays raw numeric (no commas in form state, because it is submitted to the API).
- **Recompute timing:** recompute on each `onChange` of the edited field (live), synchronously within the same state update, so the dependent field and the live preview update together. No debounce required.

### 3.4 Collateral-quantity behavior (FIXED — resolves the PRD's open question)
The PRD defines `collateral_value` derivation but leaves `collateral_quantity` under-specified. This spec fixes it:

- **CASH collateral (`collateral_type === 'CASH_USD'`, case-insensitive match on the literal `CASH_USD`):** collateral is dollars, so **`collateral_quantity` is locked to equal `collateral_value_usd`**. Whenever `collateral_value_usd` changes (by recompute or direct edit), set `collateral_quantity = collateral_value_usd` (same 2-dp string). The collateral_quantity input is **read-only/disabled** in this mode (operator does not type it). This keeps the two API fields internally consistent for cash.
- **Non-CASH collateral (any other `collateral_type`):** the platform has **no price feed for arbitrary collateral assets**, so `collateral_quantity` is **operator-entered and independent**; the system does **not** derive collateral_quantity from collateral_value or vice-versa. Both `collateral_quantity` and `collateral_value_usd` are editable; `collateral_value_usd` still participates in the central price/LTV recalc exactly as in 3.2 (its USD value is what feeds LTV math, regardless of the collateral asset's own units).
- **On `collateral_type` change** from CASH to non-CASH: unlock `collateral_quantity` for editing and clear it (operator must re-enter). From non-CASH to CASH: relock and set it equal to the current `collateral_value_usd`.

> Rationale for Designer: in CASH mode show a single "Collateral (USD)" control; the quantity field is implied and need not be a separate visible input. In non-CASH mode show two controls (collateral quantity + collateral value USD).

---

## 4. Derived Display Values (dual quantity + value — frontend-design skill)

These are **display-only**, computed from current form state, never submitted. Show formatted with thousands separators and a leading `$` where monetary. Recompute live.

| Display | Formula | Shown beside |
|---|---|---|
| **Loan principal value (USD)** | `quantity * asset_price_usd` | the Quantity field — e.g. `120 BTC · $8,040,000` |
| **Collateral value (USD)** | the `collateral_value_usd` field, formatted with separators | the Collateral group |
| **Effective available** | from selected inventory row `effective_available` | Quantity placeholder/hint (`exceeds_published_inventory` risk) |
| **Implied LTV readback** | `collateral_value_usd / (quantity * asset_price_usd) * 100` | LTV group, as a confirmation readback (matches booking_ltv when consistent) |
| **Collateral coverage** | informational: `collateral_value_usd / (quantity * asset_price_usd)` rendered as ratio/% | secured-loan framing (Section 7) |

If any input is missing, render the dependent display as a muted placeholder (e.g. `—`), never `$NaN`.

---

## 5. Warning Behavior (FIXED copy; non-blocking)

**Baseline:** the active agreement returned by `getLatestAgreement(connection_id)` (Gap B). Compare numerically (parse both sides), not string-equality, to avoid `"50"` vs `"50.00"` false positives. Use an epsilon of `1e-9`.

Trigger the warning when **any** of the following diverge from the agreement baseline:
- `booking_ltv_pct` !== agreement `initial_ltv_pct`, OR
- `margin_call_ltv_pct` !== agreement `margin_call_ltv_pct`, OR
- `liquidation_ltv_pct` !== agreement `liquidation_ltv_pct`, OR
- the **implied** booking LTV (from a manually edited collateral value) !== agreement `initial_ltv_pct`.

**Behavior (fixed):**
- Render an inline, informational (amber/warning, not error/red) message:
  > **Loan terms differ from supplier guidance.**
- The warning **never disables the Book button** and **never blocks `POST /loans`** (PRD-D-002 §2; F-035 AC "warning is UI-only").
- If `getLatestAgreement` returned `null` (no active agreement on this connection), **suppress the warning entirely** — there is no baseline. (The backend `no_active_agreement` / `agreement_not_fully_confirmed` codes will still surface as real errors at submit time per Section 6.)
- Placement decision is the Designer's (Section 9 Q4), but it must be adjacent to the central LTV group, not buried.

---

## 6. Validation Rules

### 6.1 Client-side pre-submit (block submit, show inline)
- **Required:** `borrower_id`, `quantity`, `asset_price_usd`, `booking_ltv_pct`, `margin_call_ltv_pct`, `liquidation_ltv_pct`, `rate_bps`, `collateral_type`, `collateral_value_usd`; plus `collateral_quantity` (auto in CASH mode, required in non-CASH mode); plus `maturity_date` **iff** `term_type === 'fixed'`.
- **Positive decimals:** `quantity`, `asset_price_usd`, `collateral_value_usd`, `collateral_quantity`, and all three LTVs must parse to finite numbers `> 0`. `rate_bps` must be a finite integer `>= 0`.
- **Threshold ordering (hard client guard, mirrors F-035):**
  `0 < booking_ltv_pct < margin_call_ltv_pct < liquidation_ltv_pct`.
  If violated, block submit and show inline copy anchored to the offending field, e.g. *"Thresholds must increase: booking < margin call < liquidation."* (This mirrors the backend rule so the operator gets immediate feedback; the backend still re-validates.)
- The Book button is disabled while `!borrower_id` (preserve current behavior) and while `isBooking`.

### 6.2 Backend error codes to surface inline (from F-064 + F-035)
On a non-OK `POST /loans` response, map `error.code` (Gap C) to field-anchored inline copy:

| Code | Source | Anchor / message |
|---|---|---|
| `borrower_not_approved` | F-035 / F-064 | Borrower field — "Borrower is not approved for this supplier connection." |
| `asset_not_in_scope` | F-035 / F-064 | Inventory/asset — "Asset is not in the agreement scope." |
| `collateral_not_eligible` | F-035 / F-064 | Collateral type — "Collateral type is not eligible under the agreement." |
| `no_active_agreement` | F-064 | Top of ticket — "No active agreement for this connection." |
| `agreement_not_fully_confirmed` | F-064 / F-038 | Top of ticket — "Agreement is not dual-confirmed." |
| `no_inventory_published` | F-064 | Inventory — "No inventory is published for this connection." |
| `exceeds_published_inventory` | F-064 | Quantity — "Quantity exceeds published inventory." |
| `below_minimum_size` | F-035 | Quantity — "Quantity is below the agreement minimum." |
| `insufficient_inventory` | F-035 | Quantity/inventory — "Insufficient custodian inventory." |

Any unrecognized code falls back to `error.message` (existing behavior) in the general ticket error region. Backend remains the source of truth for borrower approval, asset scope, collateral eligibility, dual-confirmed agreement, published & custodian inventory (F-035 AC) — the client guards are conveniences, not replacements.

---

## 7. Page Composition (ticket + blotter on one page)

Host: `LoanListPage.tsx`. Vertical stack, single page (F-064 "above the loan list").

1. **Page header** — title "Loans" + state filter tabs (existing). Keep.
2. **Booking ticket** — rendered **only when `role === 'agent'`** (existing gate `role === 'agent' && <BookLoanStrip />`). Suppliers never see it.
3. **Loan blotter (table)** — visible to **both roles** (existing `listLoans`).

**Collapsibility (fixed behavior, Designer styles it):**
- The ticket is **primary** when the agent's intent is to book; the blotter is **primary** when reviewing. To honor user problem #1 ("takes so much space"), the ticket must be **compact by default** and **collapsible**:
  - Provide a collapse/expand affordance on the ticket. Collapsed state shows a one-line header (e.g. "Book loan") + expand control.
  - **Default expanded** when the page is entered with `?connection_id&asset_type` query params (operator arrived intending to book); **default collapsed** otherwise. (Decision fixed; Designer chooses the control's appearance.)
- Collapsing the ticket must not lose in-progress form state for the session (keep component mounted; toggle visibility, do not unmount).

**States:**
- **Inventory loading:** ticket shows "Loading booking inventory..." (existing).
- **No inventory:** ticket shows the existing empty card "No supplier inventory is available for booking."
- **No approved borrower:** existing hint linking to `/dashboard/borrowers` (keep; do not add inline creation).
- **Blotter loading/empty/error:** existing messages (keep): "Loading loans...", "No loans match the selected state.", error region.
- **Post-book:** on success, reset the form to `EMPTY_FORM`, show success ("Loan booked."), and call `onBooked()` to refresh the blotter (existing contract — keep `onBooked: () => Promise<void>`).

---

## 8. Live Preview / Confirmation (frontend-design skill)

Provide a **running booking summary** (live preview of consequences) within or beside the ticket, updating as fields change. It is a sanity-check surface, not a separate screen. It must include, each with dual quantity+value where applicable:

- **Borrower:** name (from selected approved borrower).
- **Supplier/connection + asset:** asset_type + supplier id short form (existing label style).
- **Quantity + value:** `{quantity} {asset_type} · ${quantity*asset_price_usd}`.
- **Collateral + value:** for CASH — `${collateral_value_usd}`; for non-CASH — `{collateral_quantity} {collateral_type} · ${collateral_value_usd}`.
- **Booking LTV:** `{booking_ltv_pct}%` (+ implied-LTV readback if collateral was hand-edited).
- **Margin call / liquidation:** `{margin_call_ltv_pct}% / {liquidation_ltv_pct}%`, visually secondary.
- **Rate / term / maturity:** `{rate_bps} bps`, `open` or `fixed @ {maturity_date}`.
- **Warning line** (Section 5) shown here when active.

**Confirmation for the irreversible action (booking):** Booking creates a loan and notifies both parties — treat as irreversible. Require an **explicit acknowledgment** before `POST /loans`: a confirmation step that **repeats the full summary above in plain language with all values expanded/formatted**, then a final confirm action. (frontend-design skill: "Confirmation steps for irreversible actions".)
- **Fixed behavior:** submit must pass through one explicit confirm acknowledgment that echoes the expanded summary. **How** it is presented (inline two-step button, modal, or a confirm panel) is the Designer's call (Section 9 Q5). It must not add backend round-trips and must preserve form state if cancelled.

---

## 9. Open Questions / Decisions for the Designer

**Fixed (do NOT change — behavior, defined above):**
- Field set, defaults, and API mapping (Section 2).
- Recalc triggers, formulas, guards, rounding, source-of-truth rule (Section 3).
- CASH vs non-CASH collateral_quantity linkage (Section 3.4).
- Warning trigger conditions + exact copy "Loan terms differ from supplier guidance." + non-blocking (Section 5).
- Validation rules incl. threshold ordering and the backend error-code map (Section 6).
- Role gating, collapsibility default rules, preserved-state-on-collapse, post-book reset (Section 7).
- Requirement of an explicit confirmation that echoes the expanded summary (Section 8).

**Designer decides (layout/visual only):**
- **Q1.** Overall ticket layout (single-row strip vs two-row vs card with grouped sections) — but the price / booking LTV / collateral-value group MUST read as the central, primary cluster, with margin-call/liquidation visually secondary (G3).
- **Q2.** How the dual quantity+value pairs are rendered (two-line under input, or inline `·` separator).
- **Q3.** Collapse/expand affordance appearance and placement.
- **Q4.** Warning placement/treatment (must be adjacent to the LTV group, amber/non-error).
- **Q5.** Confirmation pattern (inline two-step, modal, or confirm panel) — must echo the full expanded summary.
- **Q6.** Where the live preview lives (right rail, footer of ticket, or expandable summary).
- **Q7.** *(Optional polish)* shorthand number entry (`1m`, `500k`) for quantity/price/value with expanded readout. Allowed if it does not interfere with the string-based form state submitted to the API; not required.
- **Q8.** Secured-loan visual framing for collateral coverage (Section 4 "collateral coverage") — how prominently to surface the coverage ratio.

---

## 10. Acceptance Criteria (consolidated, testable)

- [ ] Ticket renders only for `role === 'agent'`; blotter renders for both roles. *(Section 7)*
- [ ] Asset price defaults from current market data (stream snapshot at asset change) and is overridable without being clobbered by live ticks. *(Section 2 note)*
- [ ] Booking LTV / margin call / liquidation default from the connection's active agreement (`getLatestAgreement`). *(Gap B)*
- [ ] Editing quantity, asset price, or booking LTV recomputes `collateral_value_usd` per formula. *(Section 3.2)*
- [ ] Editing `collateral_value_usd` recomputes implied `booking_ltv_pct` per formula. *(Section 3.2)*
- [ ] Missing/zero inputs never write NaN/0/empty into a dependent field. *(Section 3.3)*
- [ ] CASH collateral locks `collateral_quantity = collateral_value_usd`; non-CASH makes it operator-entered. *(Section 3.4)*
- [ ] Divergence from agreement guidance shows "Loan terms differ from supplier guidance." and never blocks submit. *(Section 5)*
- [ ] Threshold ordering `0 < booking < margin_call < liquidation` is enforced client-side before submit. *(Section 6.1)*
- [ ] F-035/F-064 backend error codes surface inline, anchored to fields. *(Section 6.2, Gap C)*
- [ ] Live running summary updates as fields change; booking requires an explicit confirmation echoing the expanded summary. *(Section 8)*
- [ ] On success, form resets and `onBooked()` refreshes the blotter. *(Section 7)*
- [ ] TypeScript compiles with zero errors. *(F-064 AC)*
