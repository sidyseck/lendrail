# Design Spec — LendRail Booking Ticket + Blotter

**Design ID:** DESIGN-loan-redesign-001
**Inputs:** SPEC-loan-redesign-001, frontend-design skill, current `BookLoanStrip.tsx` / `LoanListPage.tsx` / `LoanDetailPage.tsx`, `components/ui/*`
**Author:** Designer (3-agent: Specifier → **Designer** → Executor)
**Status:** Ready for Executor. Behavior is fixed by the Spec; this document fixes **layout + visual treatment** only.

---

## 1. Design rationale

**Aesthetic POV.** This is a booking *ticket*, not a SaaS form. The operator is committing real assets against collateral; the screen's one job is to make the **secured-loan calculation chain (price → booking LTV → collateral value → coverage)** read as a single, trustworthy instrument, and to make every recompute visible so a misplaced digit cannot hide. The treatment is Bloomberg-terminal restraint: a calm white card, one neutral gray scale, `tabular-nums` everywhere a number appears, a single primary action color (`gray-900`), and color used only semantically (amber = guidance divergence, red = error, green = success). No gradients, no icons-as-filler, no motion beyond a brief recompute flash. Generous internal grouping replaces the current 12-column cramped strip; density comes from alignment, not from shrinking everything.

**How it honors the skill.**
- **Hierarchy:** the page has exactly one visual heart — the *Secured loan* calculation cluster — rendered at a larger type scale with a tinted panel. Margin-call / liquidation thresholds and economics (rate/term) are demoted to a secondary, quieter row. The blotter sits below and recedes when the operator is booking.
- **Restraint:** one card, one accent, three semantic colors. The collapsed ticket is a single line. Secondary fields share a muted treatment so the eye lands on the calc cluster first.
- **Dual display:** every quantity is paired with its USD value (`120 BTC · $8,040,000`), and the collateral side always shows coverage in both ratio and dollars. The live preview re-states the entire booking in expanded, comma-formatted figures so the dollar truth is always on screen before commit.
- **Error prevention:** visible labels replace the current placeholder-only inputs; recomputed fields flash so the operator *sees* the system act; the confirmation step repeats the full action in plain language before the irreversible `POST /loans`.

---

## 2. Layout spec

### Spacing / token system (use throughout)
- Card: `rounded-lg border border-gray-200 bg-white shadow-sm` (reuse `components/ui/card.tsx`).
- Card padding: `p-5` (compact ticket; the LoanDetail aside uses `p-6` — ticket is denser by design).
- Section gaps: `space-y-4` between groups; `gap-3` (12px) inside a field grid; `gap-x-6 gap-y-4` for the calc cluster grid.
- Field block = visible label + control + helper/dual-value line:
  - Label: `block text-xs font-medium text-gray-600 mb-1` (sentence case, e.g. "Quantity"). **Not** `sr-only`.
  - Control: reuse `Input` primitive (`h-10 rounded-md border-gray-300 ... focus-visible:ring-gray-900`); add `tabular-nums text-right` for all numeric inputs so digits align.
  - Helper/dual line: `mt-1 text-xs text-gray-500 tabular-nums`; placeholder dash `—` when unresolved.
- Numbers: `tabular-nums`. Monetary display values formatted with thousands separators + leading `$` via an `Intl.NumberFormat` helper (display only; form state stays raw).
- Primary button: reuse `Button` (`bg-gray-900 ... focus-visible:ring-gray-900`). Links: `text-blue-700 hover:text-blue-900`.

### (a) Collapsed ticket — one line, default when no `?connection_id&asset_type`
```
┌────────────────────────────────────────────────────────────────────────┐
│  Book loan                                          [ Expand to book ▸ ] │   ← button
└────────────────────────────────────────────────────────────────────────┘
```
- Wrapper: `Card` with `px-5 py-3`, `flex items-center justify-between`.
- Left: `h2` `text-sm font-semibold text-gray-900` = "Book loan". Optional muted in-progress hint if the form is dirty: `· draft in progress` `text-xs text-gray-400`.
- Right: expand control = `Button`-styled ghost: `text-sm font-medium text-blue-700 hover:text-blue-900` with a trailing `▸` (rotates to `▾` when expanded via CSS class, no library). `aria-expanded`, `aria-controls="book-loan-panel"`.
- **Component stays mounted**; collapse toggles a `hidden` class on the panel, never unmounts (preserves form state — Spec §7).

### (b) Expanded ticket — grouped card, calc cluster is the heart
Two-column shell on `lg` (`lg:grid-cols-[minmax(0,1fr)_300px]`): **form column** + **live preview rail**. Stacks to one column below `lg`.

```
┌─ Book loan ───────────────────────────────────────────[ Collapse ▾ ] ─┐
│                                                                         │
│  ── Counterparty ───────────────────────────────────────────────────   │  group label: text-xs uppercase tracking-wide text-gray-500
│  Supplier inventory ▼            Approved borrower ▼                     │  grid lg:grid-cols-2 gap-x-6
│  BTC · 240 avail · 0x9f3a…       [ Acme Capital ▼ ]                      │  helper line under each (dual: effective available)
│                                                                         │
│  ╔═ Secured loan ═══════════════════════════════════════ amber? ══╗    │  ★ PRIMARY CLUSTER — tinted panel
│  ║  Quantity            Asset price (USD)        Booking LTV %     ║    │  grid lg:grid-cols-3 gap-x-6 gap-y-4
│  ║  [    120    ] BTC   [   67,000.00  ]         [   75.00  ]      ║    │  inputs text-right tabular-nums
│  ║  120 BTC · $8,040,000   per BTC               implied 75.00% ✓  ║    │  dual-value + implied readback (helper lines)
│  ║                                                                  ║    │
│  ║  ─────────────────────────────────────────────────────────────  ║    │  thin divider border-gray-200
│  ║  Collateral value (USD)            Coverage                      ║    │  grid lg:grid-cols-2
│  ║  [    6,030,000.00   ]             1.33× · 133% of loan value     ║    │  collateral = computed, editable; coverage display-only
│  ║  Loan value $8,040,000 · LTV 75%   secured ✓                     ║    │
│  ╚══════════════════════════════════════════════════════════════════╝    │
│   ⚠ Loan terms differ from supplier guidance.                            │  amber bar, directly under cluster (see §4)
│                                                                         │
│  ── Risk thresholds (secondary) ────────────────────────────────────    │  muted group
│  Margin call LTV %   Liquidation LTV %                                   │  grid lg:grid-cols-2, smaller, gray-500 labels
│  [   85.00  ]        [   90.00  ]                                        │
│  must increase: booking < margin call < liquidation                     │  helper text-xs text-gray-400
│                                                                         │
│  ── Economics & collateral (secondary) ─────────────────────────────    │
│  Rate (bps)   Term ▼     [Maturity date]    Collateral type             │  grid lg:grid-cols-4
│  [  450  ]    [Open ▼]   (only if fixed)    [ CASH_USD ]                 │
│                                                                         │
│                                       [ Review booking → ]               │  primary button, right-aligned
└─────────────────────────────────────────────────────────────────────────┘
```

**Calc cluster panel container:** `rounded-md border border-gray-300 bg-gray-50 p-4 space-y-4`. When the divergence warning is active, swap to `border-amber-300 bg-amber-50/40` (subtle, still calm). Group label "Secured loan" inside: `text-xs font-semibold uppercase tracking-wide text-gray-700 mb-3`.

**Secondary groups:** plain (no panel), group label `text-xs font-medium uppercase tracking-wide text-gray-500`, inputs at the same height but labels in `text-gray-600` — the absence of the tinted panel and the smaller cluster footprint is what reads them as secondary. No separate font sizes needed beyond the helper text.

### (c) Live preview / running summary — right rail (footer on narrow)
Persistent, updates live. Sits in the right column of the expanded shell (`lg:col-start-2`), `sticky top-4` on `lg`.
```
┌─ Booking summary ───────────────────┐   Card, p-4, bg-white, border-gray-200
│  Borrower    Acme Capital            │   dl/dt/dd pattern (matches LoanDetail Field)
│  Supplier    0x9f3a… · BTC           │
│  ─────────────────────────────────   │
│  Lending     120 BTC                 │   dt text-xs uppercase text-gray-500
│              $8,040,000              │   dd value text-sm text-gray-900 tabular-nums; $ on its own line (dual)
│  Collateral  $6,030,000 (CASH_USD)   │
│              coverage 1.33×          │
│  ─────────────────────────────────   │
│  Booking LTV 75.00%   implied 75.00% │   secondary thresholds muted below
│  MC / Liq    85% / 90%               │   text-gray-500
│  Rate/Term   450 bps · open          │
│  ─────────────────────────────────   │
│  ⚠ Terms differ from guidance        │   amber line when active (mirror of §4)
└──────────────────────────────────────┘
```
- Numbers render `—` until inputs resolve. Quantity+value is the two-line dual pattern; collateral mirrors it.

### (d) Confirmation step — inline confirm panel replacing the action region (Q5)
On "Review booking →", the form **stays mounted and fields disable** (`opacity-60 pointer-events-none` on the field region), and a confirmation panel slides into the action footer / over the preview rail. No modal, no extra round-trip; cancel restores exactly.
```
┌─ Confirm booking ───────────────────────────────────────────────────────┐  Card, border-amber-300 bg-amber-50/40, p-4
│  You are booking a secured loan. This notifies both parties and cannot    │  text-sm text-gray-900
│  be undone.                                                               │
│                                                                           │
│  Lend     120 BTC  ($8,040,000) to Acme Capital                           │  plain-language, all values expanded, tabular-nums
│  Against  $6,030,000 CASH_USD collateral  ·  coverage 1.33×               │
│  Terms    Booking LTV 75.00%  ·  margin call 85.00%  ·  liquidation 90.00%│
│  Economics 450 bps  ·  open term                                          │
│  ⚠ Loan terms differ from supplier guidance.                              │  amber, only if active
│                                                                           │
│                              [ Cancel ]   [ Confirm & book loan ]         │  Cancel = ghost; Confirm = bg-gray-900
└───────────────────────────────────────────────────────────────────────────┘
```
- "Confirm & book loan" calls the existing submit path; shows `Booking…` + disabled while `isBooking`.
- Focus moves to the confirm panel heading on open; `Esc` or Cancel returns focus to "Review booking →".

### (e) Whole page (`LoanListPage`)
```
Loans                                            [All][Pending][Active][Recall][Settled][Defaulted]
Lifecycle status across connected lending programs.

[ Booking ticket — collapsed or expanded per §2a/§2b ]   ← role === 'agent' only

[ Blotter table — both roles, see §6 ]
```
- Page wrapper unchanged container; add `space-y-6` so ticket and blotter breathe.
- Ticket margin-bottom replaced by the page `space-y-6` (drop the current `mb-6 border-b`).

---

## 3. The calculation cluster (exact grouping)

**Order of fields, left→right, top→bottom inside the tinted panel:**

| Slot | Field | Label | Control | Helper / dual line |
|---|---|---|---|---|
| Row1-A | `quantity` | "Quantity" | Input, right-aligned, suffix `{asset_type}` shown as static text right of input (or as helper) | **`{qty} {asset} · ${qty×price}`** (loan principal value) |
| Row1-B | `asset_price_usd` | "Asset price (USD)" | Input, right-aligned | `per {asset_type}` (static unit) |
| Row1-C | `booking_ltv_pct` | "Booking LTV %" | Input, right-aligned | **`implied {impliedLTV}%`** readback + `✓` when within epsilon of booking value (gray-500 / `text-green-700` check) |
| divider | — | — | `border-t border-gray-200` | — |
| Row2-A | `collateral_value_usd` | "Collateral value (USD)" | Input, right-aligned | `Loan value ${qty×price} · LTV {booking_ltv}%` |
| Row2-B | coverage (display only) | "Coverage" | static value, no input | **`{coverage}× · {coverage×100}% of loan value`** + `secured ✓` (`text-green-700` when coverage ≥ 1) |

- **Implied-LTV readback (Spec §4):** always render under Booking LTV. When the operator hand-edits collateral value, booking LTV is recomputed (Spec §3.2) and flashes (see §4 recompute). The readback `implied X%` reassures them the two sides agree.
- **Coverage (Q8):** surfaced as a first-class display item inside the cluster (not buried), because it is the secured-loan headline. Shown as ratio `1.33×` primary + `% of loan value` secondary. `secured ✓` micro-label in `text-green-700` when coverage ≥ 1; `under-collateralized` in `text-amber-700` when < 1. This is informational only — never blocks (the spec defines no block on coverage).
- **Collateral, CASH vs non-CASH (Spec §3.4):**
  - **CASH_USD:** show a *single* "Collateral value (USD)" control. `collateral_quantity` is implied (locked = value) and **not rendered as an input** — instead show helper `quantity locked to USD value`.
  - **non-CASH:** render a second control "Collateral quantity" with unit `{collateral_type}` to the right of the existing value control; helper under value stays the same. Both editable. Layout becomes `lg:grid-cols-3` in Row2 (qty / value / coverage).

**Secondary thresholds treatment:** `margin_call_ltv_pct` and `liquidation_ltv_pct` live *outside* the tinted panel, in a "Risk thresholds" group with `text-gray-500` labels and a helper `must increase: booking < margin call < liquidation`. Present, scannable, clearly not the heart.

---

## 4. States & feedback (exact tokens)

| State | Treatment |
|---|---|
| **Default field** | `border-gray-300 bg-white text-gray-900`, helper `text-gray-500`. |
| **Focus** | inherit `Input` primitive: `focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2`. Do not restyle. |
| **Recomputed field (just changed by the engine)** | On a programmatic write to `collateral_value_usd` or implied `booking_ltv_pct`, apply a brief highlight: `ring-1 ring-blue-300 bg-blue-50` for ~600ms then fade to default. Implement with a transient per-field `recomputedAt` timestamp + `transition-colors duration-500`; **never** flash the field the operator is typing in (only the *target*). Pair with the helper readback so the change is also stated in words. |
| **Divergence warning (Spec §5)** | Amber, **non-error**, directly beneath the calc cluster and mirrored in the preview: container `rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800`, text exactly **"Loan terms differ from supplier guidance."** Also tints the cluster panel border to `border-amber-300` (§2b). Never disables Book. Suppressed entirely if `getLatestAgreement` returned `null`. `role="status"` (informational, not alert). |
| **Inline field error (client validation + backend code)** | Anchored under the offending field's helper line, replacing/adding: `text-xs text-red-600`, input gets `border-red-400 focus-visible:ring-red-500`, `aria-invalid="true"`, `aria-describedby` → the message id. Threshold-ordering error anchors to the first offending threshold field. Backend codes map to anchors per Spec §6.2 (borrower→Borrower, quantity→Quantity, collateral→Collateral type, etc.). |
| **Top-of-ticket error (agreement-level codes / fallback)** | `no_active_agreement`, `agreement_not_fully_confirmed`, unrecognized codes → general region at top of card: `rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700`, `role="alert"`. (Mirrors current `text-red-600` but boxed for prominence.) |
| **Success** | `rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700` "Loan booked." (`role="status"`), shown at top of ticket after reset; auto-clears on next field edit. |
| **Loading (booking)** | Confirm button → `Booking…`, disabled, `disabled:opacity-50` (from `Button`). Field region stays disabled. |
| **Inventory loading / empty** | Keep current copy: "Loading booking inventory…" (`text-sm text-gray-500`) and the empty card "No supplier inventory is available for booking." (`rounded-lg border border-gray-200 bg-white px-4 py-3`). |
| **Borrowers loading / none** | Borrower select disabled while loading ("Loading…" option); the existing "No approved borrower…" hint with the blue-700 Borrowers link, kept verbatim. |
| **Disabled (pre-borrower)** | "Review booking →" disabled while `!borrower_id` or `isBooking` (`disabled:opacity-50`). |
| **Collapsed / expanded** | §2a / §2b; toggle `hidden` on the panel, animate the chevron only. |

**Motion budget:** only the recompute flash (color fade) and the chevron rotation. No ambient animation.

---

## 5. Component breakdown (for the Executor)

Keep the public contract `({ onBooked }: { onBooked: () => Promise<void> })` and the file name; the host gate in `LoanListPage` is unchanged.

### Modify
- **`components/loans/BookLoanStrip.tsx`** — rewrite as the ticket container. Owns all form state, the recalc handlers (Spec §3), agreement fetch (Gap B), collapse state, confirm state. Renders the sub-components below. Keep `EMPTY_FORM`, the price-snapshot effect, the borrower-load effect, and submit/reset logic; add per-field recompute, `agreementDefaults`, `fieldErrors` map, `confirming` boolean, `collapsed` boolean. *(Optionally rename export to `BookLoanTicket` with a re-export alias; not required — keeping the name avoids touching the import in `LoanListPage`.)*
- **`pages/loans/LoanListPage.tsx`** — wrap content in `space-y-6`; upgrade blotter rows (see §6). No logic change beyond columns.
- **`api/loanApi.ts`** — Gap C: attach `code` to the thrown error (mirror `confirmAgreement`).

### Create (co-located in `components/loans/`)
- **`CalcField`** — labeled numeric input with dual/helper line and recompute flash.
  ```ts
  interface CalcFieldProps {
    id: string; label: string;
    value: string; onChange: (v: string) => void;
    unit?: string;            // e.g. "BTC", "per BTC"
    helper?: React.ReactNode; // dual value / implied readback
    error?: string;           // anchored red message
    recomputed?: boolean;     // triggers the blue flash
    disabled?: boolean; readOnly?: boolean;
    inputClassName?: string;  // e.g. 'text-right tabular-nums'
  }
  ```
- **`FieldGroup`** — labeled section wrapper. `{ title: string; variant?: 'primary'|'secondary'; warning?: boolean; children }`. `primary` → tinted panel (§2b); `secondary` → plain.
- **`BookingSummary`** — the live preview rail.
  ```ts
  interface BookingSummaryProps {
    borrowerName?: string; supplierShort?: string; assetType?: string;
    quantity?: string; loanValueUsd?: number;
    collateralType: string; collateralQuantity?: string; collateralValueUsd?: number;
    coverage?: number; bookingLtv?: string; impliedLtv?: number;
    marginCallLtv?: string; liquidationLtv?: string;
    rateBps?: string; termType: 'open'|'fixed'; maturityDate?: string|null;
    warning?: boolean; // divergence active
  }
  ```
  Pure presentational; uses the LoanDetail `dl/dt/dd` idiom for consistency.
- **`ConfirmBookingPanel`** — the inline confirm step.
  ```ts
  interface ConfirmBookingPanelProps {
    summary: BookingSummaryProps;  // reuse the same shape, expanded copy
    isBooking: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }
  ```
- **`formatUsd(n)` / `formatQty(s)`** helpers in `lib/` (or local) — display-only `Intl.NumberFormat`, never mutate form strings.

> Skeletons only above — do **not** implement full bodies here. The recalc math, guards, rounding, and the warning trigger are fixed in Spec §3–§5 and must be lifted verbatim.

---

## 6. Blotter integration (Q3 + dual display)

Keep every existing column's data; improve legibility, add dual quantity+value where price is known. The loan list has `quantity`, `collateral_value_usd`, `current_ltv_pct`. There is **no live price on the blotter row**, so the asset's USD notional cannot be computed reliably from list data — instead surface **collateral value (USD)** as the dollar anchor (it's on the `Loan`), giving each row an asset-quantity + dollar pair without inventing numbers.

Upgraded columns:
| Column | Render |
|---|---|
| Borrower | `text-gray-900` (unchanged). |
| Asset / Quantity (merged dual) | line 1: `{quantity} {asset_type}` `tabular-nums`; line 2: `text-xs text-gray-500` `coll $ {collateral_value_usd}` (comma-formatted). |
| LTV | `{current_ltv_pct}%` `tabular-nums`; `-` when null (unchanged logic). |
| State | `LoanStateBadge` (unchanged). |
| Booked | date (unchanged). |
| Detail | "View" blue-700 link (unchanged). |

- Right-align numeric columns (`text-right`), keep `tabular-nums`. Header `text-gray-600`. This stays consistent with the skill (dual display) without backend changes.
- **Coexistence:** when the ticket is expanded the blotter remains fully visible below it (page scrolls); when collapsed the blotter is immediately prominent. No tabs — single calm vertical stack per Spec §7.

---

## 7. Accessibility

- **Visible labels** on every control (replace all current `sr-only` + placeholder-only inputs). `htmlFor`/`id` pairing; `CalcField` wires `id` → `<label htmlFor>`.
- **Dual values / readbacks** linked via `aria-describedby` so screen readers announce `120 BTC · $8,040,000` and `implied 75%` with the field.
- **Errors:** `aria-invalid="true"` + `aria-describedby` to the red message; field-anchored. Top-region agreement errors `role="alert"`. Warning `role="status"` (non-interrupting). Success `role="status"`.
- **Collapse:** trigger button `aria-expanded` + `aria-controls="book-loan-panel"`; panel `id="book-loan-panel"`.
- **Confirmation focus management:** on open, move focus to the panel heading (`tabIndex={-1}` + `.focus()`); trap is unnecessary (inline, non-modal) but `Esc` cancels and returns focus to "Review booking →". On successful book, focus moves to the success message region.
- **Keyboard / focus order:** natural DOM order = Counterparty → calc cluster (qty → price → booking LTV → collateral value → [collateral qty if non-CASH]) → thresholds → economics → action. Tabbing never lands on the read-only coverage display.
- **Numeric inputs:** `inputMode="decimal"` (matches LoanDetail), `aria-label` redundant with visible label so omit to avoid double-announce.

---

## 8. Answers to Spec Q1–Q8

- **Q1 — Ticket layout:** A **card with grouped sections**, two-column shell (form + sticky preview rail) on `lg`, stacking below. The price/booking-LTV/collateral-value group is a **tinted bordered panel ("Secured loan")** — the visual heart; margin-call/liquidation and economics are plain secondary groups beneath. *Grouping + the single tinted panel give the operator one focal point and keep the ticket compact.*
- **Q2 — Dual quantity+value rendering:** **Inline `·` separator on a helper line under each input** (`120 BTC · $8,040,000`), and a **two-line stacked** form in the preview rail / confirm panel. *Inline keeps the dense ticket compact; two-line in the summary maximizes the dollar sanity-check.*
- **Q3 — Collapse affordance:** A right-aligned **blue-700 text control with a chevron** in the ticket header ("Expand to book ▸" / "Collapse ▾"), `aria-expanded`; panel toggles `hidden`, component stays mounted. Default expanded with query params, collapsed otherwise (per Spec §7). *Lightweight, discoverable, preserves state.*
- **Q4 — Warning placement/treatment:** **Amber bar directly beneath the calc cluster** (`border-amber-300 bg-amber-50 text-amber-800`) plus an amber-tinted cluster border and a mirrored line in the preview. `role="status"`, non-blocking. *Adjacent to the LTV group as required, visibly amber but calm — never confused with a red error.*
- **Q5 — Confirmation pattern:** **Inline confirm panel** that disables the fields and replaces the action footer / preview rail, echoing the full expanded summary in plain language, with Cancel / "Confirm & book loan". *No modal interruption, no backend round-trip, state preserved on cancel — matches the skill's irreversible-action rule.*
- **Q6 — Live preview location:** **Sticky right rail** on `lg` ("Booking summary"), collapsing to a footer card below the form on narrow widths. *Always-visible running consequence without crowding the inputs.*
- **Q7 — Shorthand entry (`1m`/`500k`):** **Not implemented** (optional polish). *Keeping raw string form state and avoiding ambiguity in a high-stakes ticket; the dual-value readout already provides the verification the shorthand would.* (Executor may add later behind the display-only helper without touching submit strings.)
- **Q8 — Collateral coverage prominence:** **First-class display inside the Secured-loan cluster** — `1.33× · 133% of loan value` with a `secured ✓` / `under-collateralized` micro-label. *Coverage is the headline of "secured"; surfacing it in the heart panel makes the secured nature obvious at a glance.*

---

## 9. Notes for the Executor (sequencing & gotchas)

1. **Preserve the price-snapshot-on-asset-change behavior** (current `latestPrices` ref + effect keyed on `selected?.asset_type`). Do **not** subscribe the price into a live effect that overwrites edits.
2. **Keep the ticket mounted on collapse** — toggle a `hidden` class, never conditionally unmount, or in-progress form state is lost (Spec §7).
3. **Recalc is per-field, not a global effect** (Spec §3.2/§3.3). The edited field is never its own recompute target. Apply the recompute *flash only to the target field*.
4. **Guards:** never write `NaN/0/Infinity/''` into a dependent field; leave the target untouched when inputs are missing/non-positive. Round written strings to `toFixed(2)` (collateral value, implied LTV); display formatting (commas/`$`) is display-only — never put commas into form state submitted to the API.
5. **CASH vs non-CASH (Spec §3.4):** in CASH mode render a single collateral-value control and lock `collateral_quantity = collateral_value_usd` (don't render the qty input); on switch to non-CASH, unlock and clear qty; on switch back, relock and set equal.
6. **Agreement defaults (Gap B):** fetch on connection change, seed LTV/MC/Liq only when empty/at-default (never clobber an in-progress edit), and use as the warning baseline with numeric compare + `1e-9` epsilon. `null` → blank fields + suppress warning.
7. **Error code surfacing (Gap C):** attach `code` in `loanApi.bookLoan`; map to field anchors (Spec §6.2). Unknown codes → top region fallback to `error.message`.
8. **Reuse `components/ui` primitives** (`Card`, `Button`, `Input`, `Label`) — do not reinvent borders/focus rings. `tabular-nums` + `text-right` on all numeric inputs and figures.
9. **Threshold-ordering guard** (`0 < booking < margin_call < liquidation`) blocks submit *before* opening the confirm panel; anchor the inline error to the first offending threshold.
10. **Confirm flow:** "Review booking →" runs client validation; only on pass does the confirm panel open. "Confirm & book loan" runs the existing submit. Cancel restores the editable form unchanged. On success: reset to `EMPTY_FORM`, show success, `onBooked()`, move focus to success region.
11. **TypeScript must compile clean** (Spec AC). New prop interfaces above are the intended shapes; keep quantities/LTVs as strings in form state.
```
