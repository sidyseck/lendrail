# LendRail — Master PRD (MVP)

| Field | Value |
|---|---|
| Version | v0.1 — Draft for review |
| Date | June 2026 |
| Status | Working draft — not for external distribution |
| Author | Product team |
| Related docs | Product Summary v0.2, Use-Case Decomposition |

---

## 1. Purpose and Scope

This document defines the MVP product requirements for LendRail — the digital-asset-native infrastructure for agency lending. It is a feature-brief (what and why per feature) intended to align stakeholders before the work is broken into execution-level sub-PRDs.

The MVP covers the core plumbing that enables a BTC supplier, an agent lender, and custodian(s) to run a monitored agency lending program on a shared platform. Matching, market data, and RWA rails are out of scope for this phase.

> **Note on terminology:** In this PRD, "MVP" refers to the first buildable phase of the product (post-trade data rails). This corresponds to what the Product Summary v0.2 calls "Phase 2." The product strategy's "Phase 1" (matching layer) is out of scope here.

---

## 2. Actors

Four parties interact with the platform in the MVP. Roles and responsibilities are distinct and must be enforced by the platform.

| Actor | Also called | Primary motivation | MVP platform role |
|---|---|---|---|
| **Supplier** | Beneficial owner, lender, BTC holder | Earn clean BTC or USD-equivalent yield on idle inventory without taking additional market risk | Publishes lendable inventory, sets program parameters, monitors loans, issues instructions |
| **Agent Lender** | Agent | Win mandates by offering a transparent, accountable lending program that suppliers trust | Books loans, onboards borrowers, reconciles through platform, executes supplier instructions |
| **Borrower** | Counterparty | Access BTC liquidity for trading, hedging, or market-making | Created and managed by agent. Borrower-facing flows are deferred. Entity tracked independently for Phase 1 multi-agent readiness. |
| **Custodian** | Sub-custodian | Provide verified asset and collateral data to the platform | Not a user. Integrated via REST API. Provides inventory feed (supplier assets) and collateral feed (borrower collateral). Does not receive platform instructions in MVP. |

---

## 3. MVP Scope

### In scope

- Supplier onboarding and inventory publishing
- Agent lender onboarding
- Organization management: workspace creation, legal-entity accounts, users, roles, and read/write permissions
- Borrower account creation (invite-only, deferred activation)
- Custodian API integration (inventory + collateral feeds, read-only)
- Supplier-agent secure pairing
- Agency lending agreement — manual entry of key terms
- Loan booking by agent lender
- Loan lifecycle tracking (proposed through settled)
- Basic risk monitoring: LTV, distance to margin call, alerts
- Daily fee accrual calculation and monthly net statement for the supplier

### Out of scope (MVP)

- Matching or execution of loans (platform does not arrange transactions)
- Borrower-facing portal and flows
- Autonomous custodian instructions (all instructions are agent-initiated through the platform)
- Automated contract extraction from uploaded PDFs
- Multi-asset support beyond BTC (designed for extensibility, not built)
- Market data / benchmark pricing (collateral pricing source TBD — see open questions)
- Fee distribution and programmatic settlement
- RWA asset support
- Phase 1 matching layer

---

## 4. Feature Areas

### F1 — Onboarding

**Philosophy:** LendRail is a technology platform, not a financial services provider. Onboarding collects identity and entity information sufficient to operate the platform and satisfy basic counterparty verification. We do not perform regulated KYC/AML in MVP — that obligation sits with the agent lender for their borrower relationships. This boundary must be reviewed with legal before launch.

#### F1.0 — Organization, Account, and User Management

The platform separates workspaces from legal entities. An **organization** is the workspace where a customer manages access and operating context. An **account** is an actual legal entity that can participate as a supplier or agent lender. A single organization may manage one or more accounts, and users are attached to accounts through roles.

The first onboarding action is always organization creation. During initial signup, the user creates one organization with one initial account. By default, the organization name is the same as the initial legal entity account name. The platform generates a unique organization ID at creation time. The user who creates the organization becomes the initial organization admin and can edit the organization name later.

**What it includes:**
- Organization/workspace creation as the first onboarding step
- Initial legal-entity account creation in the same flow
- Default organization name copied from the initial legal entity name
- Unique organization ID generation
- Initial creator assigned as organization admin
- Organization name editing by an organization admin after onboarding
- Additional legal-entity account creation within an organization
- Account type selection: supplier or agent lender
- User creation and assignment to one or more accounts
- Role assignment with MVP permission levels: read or write
- Permission descriptions that vary by account type

**Permission model:**
- Read permission allows a user to view account records, related connections, program terms, loans, risk metrics, and statements made visible to that account.
- Supplier write permission allows a user to manage inventory scope, approve borrowers, confirm program terms, and issue supplier-side instructions.
- Agent lender write permission allows a user to onboard borrowers, book loans, reconcile collateral, and initiate settlement instructions.

**Why in MVP:** The MVP has multiple institutions and multiple users operating across legally distinct entities. The platform must model workspaces, legal entities, and user authority before lending workflows can be safely expanded.

**Deferred:** Fine-grained permission matrix, custom roles, multi-account membership policy, approval workflows for user provisioning, SSO, SCIM, and audit export.

#### F1.1 — Supplier Onboarding

The supplier is the day-1 paying customer. Their onboarding is the first impression and must be low-friction while collecting what the platform needs to configure their program.

**What it includes:**
- Organization creation with one initial supplier account
- Initial account registration: legal entity name, jurisdiction, entity type (fund, corporate treasury, foundation)
- Primary contact and authorized signatory
- Custodian linkage: authorize the platform to pull inventory data via API from their custodian account
- Lendable asset scope: confirm which assets are eligible for lending (MVP: BTC only)
- Notification preferences: how the supplier wants to receive alerts and reports

**Why in MVP:** Cannot publish inventory or configure a program without an organization workspace and at least one supplier legal entity account. It is the entry point for everything else.

**Deferred:** Document upload (lending agreement extraction, entity docs). Multi-custodian linkage (designed for but not exposed in MVP).

#### F1.2 — Agent Lender Onboarding

The agent lender is invited by the supplier or applies directly. They are a participant in MVP (non-paying) and must be recognized by the platform before they can be connected to a supplier.

**What it includes:**
- Organization creation with one initial agent lender account
- Initial account registration: legal entity name, jurisdiction, entity type
- Primary contact and ops/settlement contact
- Custodian linkage: authorize collateral data feed for borrower accounts they manage
- Confirmation of regulatory status (self-attested in MVP — no verification)

**Why in MVP:** Agent lender organization and initial account must exist in the system before the supplier-agent pairing can be created. They are also the party that books loans and onboards borrowers.

**Deferred:** Agent-side subscription billing, performance reporting access, market data.

#### F1.3 — Borrower Account Creation

Borrowers are not active platform participants in MVP. However, the account creation flow is built now so that: (a) the agent can track borrowers in the system, and (b) when the platform opens to borrowers in a later phase, the same entity record exists and can connect to multiple agents.

**What it includes:**
- Agent creates a borrower record with entity name, jurisdiction, and primary contact
- Optional invite path remains available when the agent wants borrower-facing activation later
- Account is created and linked to the managing agent
- Borrower can be linked to a supplier-agent connection so the supplier can see the borrower in a read-only approved-borrower view

**Why in MVP:** Enables loan booking (loans must reference a borrower entity). Sets up the data model for Phase 1 where borrowers face multiple agents and need a single identity.

**Deferred:** Borrower-facing portal, borrower-initiated flows, multi-agent visibility for borrowers.

#### F1.4 — Custodian Integration

Custodians are not users. The custodian integration has two distinct modes: read (data feeds for monitoring) and write (settlement instructions issued by the agent lender through the platform).

**How the API key model works:**

The supplier owns the custodian relationship. For each agent lender they connect with, the supplier provisions a dedicated API key at the custodian scoped to the lendable inventory for that relationship. That key is registered in the platform as part of the supplier-agent connection setup (see F2). When the agent initiates a settlement instruction on the platform, the platform transmits it to the custodian using the supplier-provisioned key for that agent.

The agent never sees the raw key. The platform is the instruction conduit — analogous to a SWIFT messaging vendor transmitting bank instructions. The authorized party is the agent lender (authenticated user); the platform is the channel.

One key per agent-supplier relationship. If the supplier connects with two agents, two separate keys are provisioned — one per relationship. This gives the supplier clean audit separation and the ability to revoke access per agent by rotating the key at the custodian.

**Feed 1 — Inventory feed (supplier assets):**
- Asset holdings by custodian account, with as-of timestamp
- Used to populate the supplier's availability list and validate loan bookings against available inventory
- Read-only — platform consumes, does not write

**Feed 2 — Collateral feed (borrower collateral):**
- Collateral asset type, quantity, and valuation by loan or account
- Used for LTV calculation and margin-call monitoring
- Read-only — platform consumes, does not write

**Write — Settlement instruction channel:**
- Agent initiates delivery instruction on the platform (e.g., release X BTC to borrower account)
- Platform formats and transmits the instruction to the custodian via the supplier-provisioned API key for that agent
- Custodian executes the movement and returns a confirmation
- Platform records the confirmation and updates loan state
- Platform never issues instructions autonomously — every instruction requires an authenticated agent action

**Key security rules:**
- API keys stored encrypted at rest, never exposed in logs or UI
- Keys scoped at the custodian to minimum necessary permissions: delivery instructions on designated accounts only
- Platform detects authentication failures immediately and alerts supplier and agent — key may have been rotated
- Connection suspension or termination in the platform does not revoke the custodian key — the supplier must rotate the key at the custodian. Platform alerts supplier to do so on termination.

> **MVP assumption:** Custodian exposes standard REST APIs with API-key authentication. No FIX or SFTP in MVP. v1 integration target: Anchorage (to be confirmed — see open questions).

---

### F2 — Supplier-Agent Connection

Before a supplier can publish inventory to an agent, the two parties must be explicitly connected on the platform. This connection is bilateral — both parties must authorize it. It has two components that must both be complete before the relationship goes active: the platform-level connection and the custodian API key handoff.

#### Step 1 — Platform connection

- Supplier sends a connection invitation to an agent (by email or agent ID if already registered)
- Agent receives and accepts the invitation
- On acceptance, a connection record is created linking the two entities
- Connection scope: supplier specifies which custodian accounts and asset types are in scope for this relationship
- Access control: once connected, the agent can see the supplier's availability list and program parameters. The supplier can see loan records the agent books against their inventory. No cross-visibility beyond the connection.

#### Step 2 — Custodian API key provisioning

The platform connection alone is not sufficient. For the agent to instruct settlements, the supplier must provision a dedicated API key at the custodian for this agent relationship and register it in the platform.

- Supplier logs into their custodian portal and creates an API key scoped to the lendable inventory accounts for this agent (minimum necessary permissions: delivery instructions only)
- Supplier enters the key into the platform within the connection setup flow
- Platform validates the key against the custodian API (test call) and stores it encrypted
- Connection status shows as "Active" only when both the platform link and a valid API key are in place
- One key per supplier-agent relationship. A supplier with two agents provisions two separate keys.

#### Connection termination

- Either party can suspend or terminate the connection from the platform
- On termination, platform flags all active loans associated with the connection and notifies both parties
- Platform alerts the supplier to rotate the API key at the custodian — the platform cannot revoke the custodian key itself
- Until the key is rotated at the custodian, the agent technically retains custodian access. The supplier is responsible for completing this step.

**Why in MVP:** The connection is the trust boundary at both the software and custody layers. Inventory disclosure is controlled and bilateral. The API key scoping ensures an agent can only move assets the supplier has explicitly authorized for that relationship.

**Deferred:**
- Open availability (Phase 1): supplier broadcasts to multiple unconnected agents
- Marketplace-style discovery of agents by suppliers
- Cryptographic signing of connection terms

---

### F3 — Agency Lending Agreement

The bilateral lending agreement between supplier and agent is negotiated off-platform. The platform needs the key economic and risk terms from that agreement to enforce parameters and power the risk cockpit.

**MVP approach: manual entry.** The user (supplier or agent, with dual confirmation) enters terms directly into the platform. PDF upload and automated extraction are deferred.

#### Terms to capture

| Term | Description | Set by |
|---|---|---|
| Assets in scope | Asset types eligible for lending (MVP: BTC only). Minimum loan size. | Supplier |
| Eligible collateral types | What the supplier accepts as collateral (e.g., USDC, BTC, other stablecoins) | Supplier |
| Initial LTV / haircut | Collateral required at loan initiation as % of loan value | Agreement / Supplier |
| Margin call threshold | LTV level that triggers a margin call notice | Agreement / Supplier |
| Recall notice period | Minimum notice the supplier must give before recalling assets | Agreement |
| Maximum loan term | Longest permissible loan duration | Supplier |
| Approved borrower list | Borrowers the supplier approves for their inventory. Maintained by agent, visible to supplier. | Agent + Supplier approval |
| Fee / rate parameters | Agent gross fee split, platform fee. Rate per loan set at booking time. | Agreement |
| Day count convention | Basis for daily interest calculation: Actual/360 or Actual/365. Must be agreed and stored per loan at booking time. Drives all accrual calculations. | Agreement |

#### Confirmation flow

- Agent enters terms; supplier is notified to review and confirm
- Both parties must confirm before the program goes active
- Changes to terms require re-confirmation from both parties
- All versions of terms are stored with timestamps for audit

**Deferred:**
- PDF upload and NLP extraction of agreement terms
- E-signature integration
- Automated validation that manual entries match uploaded document

---

### F4 — Loan Booking and Lifecycle

#### F4.1 — Loan Booking

The agent lender books each loan into the platform. The platform validates the loan against the agreed program parameters and confirms it against the custodian feeds.

**What the agent enters:**
- Borrower (must be an onboarded entity linked to this agent)
- Asset type and quantity
- Loan rate
- Loan term (open or fixed, with maturity date)
- Collateral type, quantity, and initial valuation

**Platform validation on booking:**
- Borrower is on supplier's approved borrower list
- Asset type is in scope per the agreement
- Collateral type is eligible per the agreement
- Initial LTV meets the agreed threshold
- Loan size meets minimum per agreement

**Custodian confirmation:** platform checks the inventory feed to verify the asset is present in the supplier's custodian account. Collateral receipt is confirmed against the collateral feed. Platform does not trigger the asset movement — it records the state.

#### F4.2 — Loan Lifecycle States

Every loan moves through a defined set of states. All state transitions are timestamped and logged.

| State | Definition |
|---|---|
| **Pending** | Booked by agent. Awaiting custodian confirmation of asset movement and collateral receipt. |
| **Active** | Custodian feeds confirm asset is segregated and collateral is posted. Loan is live. |
| **Margin Call** | LTV has breached the agreed margin call threshold. Notice issued to agent. Agent must top up collateral or initiate partial recall. |
| **Recall Initiated** | Supplier or agent has issued a recall instruction. Notice period clock starts. |
| **Settled** | Assets returned to supplier custodian account. Collateral released. Fees accrued and recorded. |
| **Defaulted** | Loan not returned per agreed terms. Flagged for manual resolution. Platform records state; resolution happens off-platform in MVP. |

#### Key lifecycle events (within Active state)

- **Mark-to-market:** collateral revalued when custodian feed updates. LTV recalculated.
- **Collateral substitution:** borrower (via agent) substitutes collateral type or amount. Requires re-validation against agreement terms.
- **Partial recall:** supplier recalls a portion of the loan. Remaining balance stays Active.
- **Fee accrual:** daily accrual recorded per loan. Distributed to waterfall in settled state.

#### Recall flow

1. Supplier issues recall instruction through the platform (signs the directive)
2. Platform records and timestamps the instruction, notifies agent with notice period countdown
3. At maturity of the notice period, agent initiates the asset return on the platform
4. Platform transmits the return instruction to the custodian using the supplier-provisioned API key
5. Custodian returns assets to the supplier account and confirms
6. Platform receives confirmation, updates loan state to Settled

**Deferred:**
- Automated custodian instruction (platform-initiated asset movement)
- Programmatic fee settlement / waterfall distribution
- Multi-custodian loan (assets at multiple custodians)

---

### F5 — Risk Monitoring

The risk cockpit is the primary daily-use surface for the supplier. It answers: *are my loans safe right now?* MVP covers the basics — live LTV and alert-driven monitoring. Advanced analytics and scenario modeling are deferred.

#### Per-loan metrics

| Metric | Description |
|---|---|
| Current LTV | Collateral value / loan value. Updated each time the custodian feed refreshes. |
| Distance to margin call | % buffer between current LTV and margin call threshold. Shown as a progress indicator. |
| Collateral type | What type of collateral is posted (USDC, BTC, other). Shown per loan. |
| Loan term / days remaining | For fixed-term loans: days to maturity. For open loans: days since inception. |
| Loan state | Current lifecycle state (Active, Margin Call, Recall Initiated, etc.) |
| Borrower | Entity name. Supplier sees borrower name; further detail only visible to agent. |

#### Portfolio-level view

- Total assets on loan (quantity and USD equivalent)
- Total collateral posted across all active loans
- Number of active loans by state
- Concentration: % of inventory on loan per borrower

#### Alerts

| Alert | Trigger | Recipients |
|---|---|---|
| Warning | LTV within 10% of margin call threshold | Supplier + Agent |
| Margin call | LTV breaches threshold. Loan moves to Margin Call state. | Both parties, immediately |
| Recall deadline | Recall notice period expires in 24h | Agent |
| Loan maturity | Fixed-term loan matures within 3 days | Agent |
| Custodian feed stale | Feed has not refreshed within expected window. Risk data flagged as potentially stale. | Supplier + Agent |

#### Data integrity rule

Every metric displayed must show an as-of timestamp and the named source (custodian name + feed ID). If the source data is stale or unavailable, the metric is shown with a staleness flag rather than hidden or displayed without context.

**Deferred:**
- Forward-looking scenario modeling (stress tests, rate shift scenarios)
- Market data integration for real-time collateral pricing (MVP: pricing sourced from custodian feed or manually updated)
- Cross-program aggregation (multiple supplier programs in one view)
- Automated margin call response (auto top-up, auto recall)

---

### F6 — Fee Accrual and Monthly Reporting

The platform calculates daily interest accruals for each active loan and produces a locked monthly statement for the supplier. This gives the supplier transparent, auditable proof of what they earned — the primary gap versus the current world of opaque agent reporting.

> The platform does not track or verify the actual settlement of interest payments in MVP. Cash moves bilaterally between agent and supplier outside the platform. The monthly statement serves as a billing reference document, not a settlement instruction.

#### Daily accrual

- For each active loan, the platform calculates daily accrued interest: `rate × outstanding quantity × (1 / day count basis)`
- Day count convention (Actual/360 or Actual/365) is stored per loan at booking time from the agreed program terms (see F3)
- Outstanding quantity is taken from the custodian inventory feed as of end of day
- Accruals are calculated and stored daily with a timestamp and source reference — not displayed in real time but available for audit

#### Monthly statement

At month end, the platform generates a locked statement per supplier-agent relationship covering the closed calendar month.

| Line item | Description |
|---|---|
| Gross interest earned | Sum of daily accruals across all loans for the period, per loan and in total |
| Agent fee | Agent's share per the agreed split in F3, itemized per loan |
| Net to supplier | Gross minus agent fee. The supplier's earned amount for the period. |
| Value date | 1st calendar day of the following month |
| Statement period | First to last day of the closed calendar month |

#### Statement immutability

- Once generated, the monthly statement is locked and timestamped
- It cannot be edited — if a correction is needed, a revised statement is issued alongside the original with a clear amendment note
- Both supplier and agent can download the statement. It is the reference document for any billing dispute.
- All inputs to the statement (daily accruals, rates, quantities) are stored with their source and as-of timestamp so any line item can be traced back to its inputs

#### What this is not

- Not a settlement instruction — the platform does not tell anyone to pay anything
- Not a cash reconciliation — the platform does not verify that the supplier received the net amount
- Not a tax document — the statement is a reporting artifact; tax treatment is the supplier's responsibility

**Deferred:**
- Payment date tracking and settlement status monitoring per interest period
- Platform fee line item (platform billing handled out-of-band in MVP)
- Multi-currency accruals (MVP: single denomination per loan, typically USD or BTC equivalent)

---

## 5. Open Questions

These questions must be resolved before feature-level sub-PRDs are drafted. Prioritized by how much design work is blocked on each.

| # | Question | Why it matters | Blocks |
|---|---|---|---|
| 1 | Which custodian is the v1 integration target? Anchorage is the working assumption. | API shape, authentication, and data field mapping are custodian-specific. We cannot design the integration layer until we know the custodian. | F1.4, F4.1, F5 |
| 2 | How is collateral priced for LTV calculations in MVP? Oracle, exchange feed, or custodian-provided valuation? | If the custodian provides valuations, we inherit their methodology. If we pull from an exchange, we own the price source and its reliability. Directly affects data integrity obligations. | F5 (LTV, alerts) |
| 3 | Who initiates the supplier-agent connection — supplier, agent, or either? | Changes the UX flow and which party we optimize the connection experience for. | F2 |
| 4 | KYB/KYC scope: what identity verification do we require at onboarding, and what do we rely on the agent to have done for their borrowers? | Determines our legal exposure and the onboarding friction we impose. Must be reviewed with legal before any external launch. | F1.1, F1.2, F1.3 |
| 5 ✅ | Does the platform ever issue instructions to the custodian in MVP, or is it purely a read layer? | **CLOSED.** Decision: platform transmits agent-initiated settlement instructions to the custodian using supplier-provisioned API keys. Agent is the authorized party; platform is the conduit (SWIFT vendor analogy). No autonomous platform actions. See F1.4 and F2. | Resolved — F1.4, F2, F4 |
| 6 | First supplier archetype: crypto-native fund, corporate treasury, token foundation, or ETF-adjacent inventory holder? | Drives v1 feature priorities, onboarding requirements, and the sales motion. | All features (prioritization) |

---

## 6. Next Steps

Once open questions are resolved, this document splits into feature-level sub-PRDs for engineering handoff. Suggested split:

| Sub-PRD | Coverage |
|---|---|
| Sub-PRD 1 | Onboarding (F1.1, F1.2, F1.3) + Supplier-Agent Connection (F2) |
| Sub-PRD 2 | Custodian Integration (F1.4) — technical spec with API contract |
| Sub-PRD 3 | Agency Lending Agreement (F3) — data model and confirmation flow |
| Sub-PRD 4 | Loan Booking and Lifecycle (F4) |
| Sub-PRD 5 | Risk Monitoring (F5) — including data integrity rules and alert logic |
| Sub-PRD 6 | Fee Accrual and Monthly Reporting (F6) — accrual methodology, statement generation, immutability rules |
