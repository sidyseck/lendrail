# Test & Mock Constraints (Orchestrator note for the Executor)

Compiled by the orchestrator from the actual test/mock files. These are
realities the Executor MUST account for so the redesign lands green.

## 1. `frontend/src/test/LoanListPage.test.tsx` WILL break — update it deliberately

The single existing test books a loan from the strip. With the redesign it
breaks for three reasons; update the test to match the NEW spec'd behavior
(do not weaken the spec to preserve the old test):

1. **Agreement defaults now pre-fill the LTV fields.** The test renders with
   `?connection_id=conn-002&asset_type=BTC`. `conn-002` has seeded agreement
   `agr-001` → `initial_ltv_pct=65`, `margin_call_ltv_pct=80`,
   `liquidation_ltv_pct=90` (see `mocks/handlers/agreements.ts`). After Gap-B
   wiring, booking LTV / margin / liquidation inputs are PRE-FILLED. The test
   currently does `user.type(getByLabelText(/booking ltv/i), '80')` without
   clearing → produces `"65.000080"`. Fix: `user.clear(...)` each LTV field
   before typing, OR assert the defaulted values instead of typing them.

2. **CASH collateral locks `collateral_quantity`.** Default `collateral_type`
   is `CASH_USD`; per SPEC §3.4 the collateral-quantity input is read-only in
   CASH mode and auto-mirrors collateral value. The test's
   `user.type(getByLabelText(/collateral quantity/i), '15000')` will fail on a
   disabled input. Fix: either type into collateral VALUE only (qty mirrors),
   or switch collateral type to a non-CASH value first if the test needs to
   exercise the two-field path.

3. **A confirmation step now precedes submit (SPEC §8).** The test clicks
   `/^book$/i` then immediately waits for the blotter row "Booked Borrower".
   With the explicit confirmation acknowledgment, clicking Book opens the
   confirm step; the test must then click the final confirm control before the
   POST fires. Keep accessible names stable so the test can target them.

## 2. Keep these accessible names so labels remain testable
The test (and good a11y per the design skill) rely on `getByLabelText`. The
Designer mandates VISIBLE labels (good). Ensure label text still matches these
case-insensitive regexes (or update the test in lockstep):
`approved borrower`, `quantity`, `asset price usd`, `booking ltv`,
`margin call ltv`, `liquidation ltv`, `rate bps`, `collateral value usd`,
and (non-CASH only) `collateral quantity`. The page heading is matched as
`/^book loan$/i` — keep a "Book Loan" heading or update the test.

## 3. The POST /loans mock is permissive
`mocks/handlers/loans.ts` only checks presence of connection/borrower/asset/
quantity and never returns the specific F-035/F-064 error codes. So the
inline error-code mapping (SPEC §6.2 / Gap C) cannot be exercised by the
existing mock. If you add a test for code mapping, extend the mock to return
e.g. `mockError('exceeds_published_inventory', '...', 422)` for a sentinel
input. Not required for the core task, but note the gap.

## 4. The market-price REST mock exists
`GET /api/market-data/prices/:assetType` returns `{ asset_type, price_usd,
as_of }` (BTC=63500, ETH=1700). The live SSE stream also feeds prices. SPEC
§2 says keep the stream-snapshot-on-asset-change as the default source; the
REST call is optional. Do not introduce live-tick clobbering of operator edits.

## 5. Run before declaring done
From `frontend/`: `npm run lint`, `npx tsc --noEmit` (or the project's
typecheck script), and `npm test` (vitest). All must pass. Check
`frontend/package.json` for exact script names.
