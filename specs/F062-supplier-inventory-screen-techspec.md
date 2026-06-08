# LendRail — F-062 Supplier Inventory Management Screen Technical Specification

| Field | Value |
|---|---|
| Feature | F-062 — Supplier inventory management screen |
| Milestone | M2 (extension) |
| Scope | Frontend only: new page, new hooks, new API module, new MSW handlers, routing changes. One new backend endpoint (`GET /custodians/{id}/inventory`). |
| Depends on | F-061 (`PUT /connections/{id}/inventory-scope`, `GET /connections/{id}/inventory`), existing `GET /custodians`, existing `GET /connections` |
| Audience | Engineer implementing F-062 against the M4 + F-061 codebase |
| Status | Implementation-ready spec |

---

## 0. Purpose and guiding principles

F-062 gives the supplier a dedicated, full-page view of their inventory position. It replaces the per-connection "Manage Inventory" modal (introduced in F-061) with a structured three-section page that surfaces:

1. **Custodian positions** — raw balances direct from each registered custodian, with a staleness warning when the feed is old.
2. **Per-agent allocation panels** — how much of each asset is published to each agent, already on loan via that agent, and what remains.
3. **Inline allocation controls** — edit published quantities in-place, with guard rails against setting scope below on-loan quantity or setting to zero.

**Guiding principles (identical to the rest of the codebase):**
- Fetch pattern: plain `fetch()` with `authHeaders()` in an `Api` module or a custom hook. No third-party query library.
- Error envelope: always `{ error: { code, message } }`. Never unwrap differently.
- Decimal quantities: always string-typed throughout. Parse to `Number` only for display arithmetic (never for storage).
- Role guard: this page is supplier-only. Render only when `role === 'supplier'` (enforced via routing in `App.tsx`).

---

## 1. Overview of changes

| Area | Change |
|---|---|
| **Backend** | New `GET /custodians/{id}/inventory` endpoint — returns live custodian positions for a single custodian link |
| **`src/App.tsx`** | Add route `/dashboard/inventory` |
| **`src/pages/DashboardPage.tsx`** | Add "Inventory" nav link for supplier role |
| **`src/types/inventory.ts`** | New: `CustodianPosition`, `ConnectionInventory`, `AllocationEntry` |
| **`src/api/inventoryApi.ts`** | New: `getCustodianInventory()`, `getConnectionInventory()`, `setConnectionInventoryScope()` |
| **`src/hooks/useCustodianInventory.ts`** | New: fetches all custodian positions |
| **`src/hooks/useAllConnections.ts`** | Re-export or alias of existing `useConnections` — no new file needed if `useConnections` already covers the supplier case |
| **`src/pages/inventory/SupplierInventoryPage.tsx`** | New: main page component |
| **`src/pages/inventory/CustodianPositionsSection.tsx`** | New: Section A |
| **`src/pages/inventory/AgentAllocationPanels.tsx`** | New: Section B + C combined |
| **`src/mocks/handlers/inventory.ts`** | New: MSW handlers for `GET /custodians/:id/inventory` |
| **`src/mocks/handlers/custodians.ts`** | Extend: existing `GET /api/custodians` handler already in place; no change needed |
| **`src/mocks/browser.ts` / `server.ts`** | Add `inventoryHandlers` to the handler array |

---

## 2. New backend endpoint

### 2.1 Does `GET /custodians/{id}/inventory` already exist?

Checking `backend/app/api/routers/custodians.py`: the file defines `POST /custodians` (register) and `GET /custodians` (list). There is **no** `GET /custodians/{id}/inventory` endpoint. This endpoint must be added.

### 2.2 `GET /custodians/{id}/inventory`

**File:** `backend/app/api/routers/custodians.py`

**Purpose:** Returns the live inventory positions for one custodian link belonging to the calling supplier's org. The frontend calls this once per registered custodian to populate Section A.

**Request:**
```
GET /custodians/{custodian_link_id}/inventory
Authorization: Bearer <supplier-JWT>
```

**Response `200`:**
```json
{
  "custodian_link_id": "clink-001",
  "account_ref": "vault-123",
  "positions": [
    {
      "asset_type": "BTC",
      "quantity": "500.0",
      "as_of": "2026-06-08T10:00:00Z"
    },
    {
      "asset_type": "ETH",
      "quantity": "250.0",
      "as_of": "2026-06-08T10:00:00Z"
    }
  ]
}
```

**Error responses:**
- `401` — missing/invalid token
- `403` — caller is not a supplier, or the custodian link does not belong to the caller's org
- `404` — `custodian_link_id` not found

**Implementation sketch (for the backend engineer):**

```python
from app.schemas.custodians import CustodianInventoryResponse, CustodianInventoryPosition

@router.get(
    "/{custodian_link_id}/inventory",
    response_model=CustodianInventoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get live inventory positions for a custodian link",
)
async def get_custodian_inventory(
    custodian_link_id: uuid.UUID,
    caller: AuthUser = Depends(require_role("supplier")),
    svc: CustodianService = Depends(get_custodian_service),
) -> CustodianInventoryResponse:
    """
    Calls CustodianAdapter.get_inventory(account_ref) and returns the raw positions.
    Caller must own the custodian link (org_id == caller.org_id).
    """
    result = await svc.get_inventory(caller=caller, custodian_link_id=custodian_link_id)
    return CustodianInventoryResponse(
        custodian_link_id=result.custodian_link_id,
        account_ref=result.account_ref,
        positions=[
            CustodianInventoryPosition(
                asset_type=p.asset_type,
                quantity=str(p.quantity),
                as_of=p.as_of.isoformat(),
            )
            for p in result.positions
        ],
    )
```

**New schemas** (`backend/app/schemas/custodians.py`):
```python
class CustodianInventoryPosition(BaseModel):
    asset_type: str
    quantity: str      # Decimal string
    as_of: str         # ISO-8601

class CustodianInventoryResponse(BaseModel):
    custodian_link_id: UUID
    account_ref: str
    positions: list[CustodianInventoryPosition]
```

**`CustodianService.get_inventory`** (new method):
```python
async def get_inventory(
    self,
    caller: AuthUser,
    custodian_link_id: uuid.UUID,
) -> CustodianInventoryResult:
    link = await self.custodian_links.get(custodian_link_id)
    if link.org_id != caller.org_id:
        raise Forbidden("This custodian link does not belong to your organization")
    positions = await self.custodian_adapter.get_inventory(link.account_ref)
    return CustodianInventoryResult(
        custodian_link_id=link.id,
        account_ref=link.account_ref,
        positions=positions,
    )
```

---

## 3. TypeScript types

**File:** `src/types/inventory.ts` (new file)

```ts
// Position returned from GET /custodians/{id}/inventory
export interface CustodianPosition {
  asset_type: string;
  quantity: string;     // Decimal string
  as_of: string;        // ISO-8601
}

export interface CustodianInventoryResponse {
  custodian_link_id: string;
  account_ref: string;
  positions: CustodianPosition[];
}

// Full supplier view from GET /connections/{id}/inventory
// Imported from src/types/connection.ts — already defined as InventoryScopeEntrySupplier
// Re-exported here for colocation:
export type { InventoryScopeEntrySupplier, InventoryScopeSupplierResponse } from './connection';

// Derived type for a single connection's allocation data,
// combined with connection metadata for display
export interface ConnectionAllocation {
  connection_id: string;
  agent_id: string;           // used as display identifier until org names are available
  status: 'active' | 'suspended';
  entries: AllocationEntry[];
  isLoading: boolean;
  error: string | null;
}

export interface AllocationEntry {
  asset_type: string;
  custodian_balance: string;   // total at custodian
  published_quantity: string;  // supplier's published cap for this agent
  already_booked: string;      // on loan via this agent
  effective_available: string; // published − on_loan (clamped to 0 if negative)
}
```

---

## 4. API module

**File:** `src/api/inventoryApi.ts` (new file)

Pattern follows `src/api/loanApi.ts` and `src/api/custodiansApi.ts`.

```ts
import { getToken } from '@/auth/tokenStore';
import type { CustodianInventoryResponse } from '@/types/inventory';
import type {
  InventoryScopeSupplierResponse,
} from '@/types/connection';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function parseErrorMessage(body: unknown, fallback: string): string {
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: unknown }).error !== null
  ) {
    const err = (body as { error: { message?: unknown } }).error;
    if (typeof err.message === 'string') return err.message;
  }
  return fallback;
}

export async function getCustodianInventory(
  custodianLinkId: string,
): Promise<CustodianInventoryResponse> {
  const response = await fetch(
    `${API_BASE}/custodians/${custodianLinkId}/inventory`,
    { headers: authHeaders() },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load custodian inventory.'));
  }
  return (await response.json()) as CustodianInventoryResponse;
}

export async function getConnectionInventory(
  connectionId: string,
): Promise<InventoryScopeSupplierResponse> {
  const response = await fetch(
    `${API_BASE}/connections/${connectionId}/inventory`,
    { headers: authHeaders() },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load connection inventory.'));
  }
  return (await response.json()) as InventoryScopeSupplierResponse;
}

export async function setConnectionInventoryScope(
  connectionId: string,
  scope: Record<string, string>,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/connections/${connectionId}/inventory-scope`,
    {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ scope }),
    },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to save inventory scope.'));
  }
}
```

---

## 5. Hooks

### 5.1 `useCustodianInventory`

**File:** `src/hooks/useCustodianInventory.ts` (new file)

Fetches inventory positions for all registered custodians. Returns a loading/error state per custodian, since each custodian call is independent (one failure should not block the others).

```ts
import { useCallback, useEffect, useState } from 'react';
import { listCustodians, type CustodianLink } from '@/api/custodiansApi';
import { getCustodianInventory } from '@/api/inventoryApi';
import type { CustodianInventoryResponse } from '@/types/inventory';

export interface CustodianInventoryEntry {
  link: CustodianLink;
  data: CustodianInventoryResponse | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseCustodianInventoryReturn {
  entries: CustodianInventoryEntry[];
  isLoadingLinks: boolean;
  linksError: string | null;
  refetch: () => Promise<void>;
}

export function useCustodianInventory(): UseCustodianInventoryReturn {
  const [links, setLinks] = useState<CustodianLink[]>([]);
  const [isLoadingLinks, setIsLoadingLinks] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [entries, setEntries] = useState<CustodianInventoryEntry[]>([]);

  const fetchAll = useCallback(async () => {
    setIsLoadingLinks(true);
    setLinksError(null);
    try {
      const fetchedLinks = await listCustodians();
      setLinks(fetchedLinks);

      // Initialise entries with loading state immediately so the UI can
      // render skeleton rows before individual inventory calls complete.
      setEntries(
        fetchedLinks.map((link) => ({
          link,
          data: null,
          isLoading: true,
          error: null,
        })),
      );

      // Fire individual inventory fetches in parallel.
      const inventoryResults = await Promise.allSettled(
        fetchedLinks.map((link) => getCustodianInventory(link.custodian_link_id)),
      );

      setEntries(
        fetchedLinks.map((link, i) => {
          const result = inventoryResults[i];
          if (result.status === 'fulfilled') {
            return { link, data: result.value, isLoading: false, error: null };
          }
          return {
            link,
            data: null,
            isLoading: false,
            error: (result.reason as Error).message ?? 'Failed to load.',
          };
        }),
      );
    } catch (err) {
      setLinksError((err as Error).message ?? 'Failed to load custodians.');
    } finally {
      setIsLoadingLinks(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return { entries, isLoadingLinks, linksError, refetch: fetchAll };
}
```

### 5.2 `useAgentAllocations`

**File:** `src/hooks/useAgentAllocations.ts` (new file)

Fetches inventory data for all active/suspended connections. Returns per-connection allocation data as a list.

```ts
import { useCallback, useEffect, useState } from 'react';
import { useConnections } from '@/hooks/useConnections';
import { getConnectionInventory } from '@/api/inventoryApi';
import type { ConnectionAllocation } from '@/types/inventory';

export interface UseAgentAllocationsReturn {
  allocations: ConnectionAllocation[];
  isLoadingConnections: boolean;
  connectionsError: string | null;
  refetchAll: () => Promise<void>;
  refetchConnection: (connectionId: string) => Promise<void>;
}

export function useAgentAllocations(): UseAgentAllocationsReturn {
  const { connections, isLoading: isLoadingConnections, error: connectionsError, refetch: refetchConnections } =
    useConnections();
  const [allocations, setAllocations] = useState<ConnectionAllocation[]>([]);

  // Derived from connections: only active + suspended have inventory data.
  const activeConns = connections.filter(
    (c) => c.status === 'active' || c.status === 'suspended',
  );

  const fetchAllocationsForConnections = useCallback(
    async (conns: typeof activeConns) => {
      if (conns.length === 0) {
        setAllocations([]);
        return;
      }

      // Initialise with loading state.
      setAllocations(
        conns.map((c) => ({
          connection_id: c.connection_id,
          agent_id: c.agent_id,
          status: c.status as 'active' | 'suspended',
          entries: [],
          isLoading: true,
          error: null,
        })),
      );

      const results = await Promise.allSettled(
        conns.map((c) => getConnectionInventory(c.connection_id)),
      );

      setAllocations(
        conns.map((c, i) => {
          const result = results[i];
          if (result.status === 'fulfilled') {
            return {
              connection_id: c.connection_id,
              agent_id: c.agent_id,
              status: c.status as 'active' | 'suspended',
              entries: result.value.entries.map((e) => ({
                asset_type: e.asset_type,
                custodian_balance: e.custodian_balance,
                published_quantity: e.published_quantity,
                already_booked: e.already_booked,
                effective_available: e.effective_available,
              })),
              isLoading: false,
              error: null,
            };
          }
          return {
            connection_id: c.connection_id,
            agent_id: c.agent_id,
            status: c.status as 'active' | 'suspended',
            entries: [],
            isLoading: false,
            error: (result.reason as Error).message ?? 'Failed to load inventory.',
          };
        }),
      );
    },
    [],
  );

  useEffect(() => {
    if (!isLoadingConnections && !connectionsError) {
      void fetchAllocationsForConnections(activeConns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingConnections, connectionsError, connections.length]);

  const refetchAll = useCallback(async () => {
    await refetchConnections();
    // The useEffect above will re-fire on the updated connections list.
  }, [refetchConnections]);

  const refetchConnection = useCallback(async (connectionId: string) => {
    const conn = connections.find((c) => c.connection_id === connectionId);
    if (!conn) return;
    try {
      const data = await getConnectionInventory(connectionId);
      setAllocations((prev) =>
        prev.map((a) =>
          a.connection_id === connectionId
            ? {
                ...a,
                entries: data.entries.map((e) => ({
                  asset_type: e.asset_type,
                  custodian_balance: e.custodian_balance,
                  published_quantity: e.published_quantity,
                  already_booked: e.already_booked,
                  effective_available: e.effective_available,
                })),
                isLoading: false,
                error: null,
              }
            : a,
        ),
      );
    } catch (err) {
      setAllocations((prev) =>
        prev.map((a) =>
          a.connection_id === connectionId
            ? { ...a, isLoading: false, error: (err as Error).message }
            : a,
        ),
      );
    }
  }, [connections]);

  return {
    allocations,
    isLoadingConnections,
    connectionsError: connectionsError,
    refetchAll,
    refetchConnection,
  };
}
```

---

## 6. Components

### 6.1 Component tree

```
SupplierInventoryPage                      /dashboard/inventory
├── <h1>Inventory</h1>
├── Section A: CustodianPositionsSection
│   ├── SectionHeader "Custodian Positions"
│   ├── {isLoadingLinks} → skeleton rows
│   ├── {linksError} → error alert
│   └── CustodianPositionsTable
│       └── CustodianPositionRow × N (one per custodian link)
│           └── {stale} → StalenessChip
├── Section B + C: AgentAllocationPanels
│   ├── SectionHeader "Agent Allocations"
│   ├── {isLoadingConnections} → skeleton
│   ├── {connectionsError} → error alert
│   └── AgentAllocationPanel × N (one per active/suspended connection)
│       ├── PanelHeader (agent ID, connection status badge)
│       ├── {alloc.isLoading} → skeleton rows
│       ├── {alloc.error} → inline error
│       ├── {entries.length === 0} → EmptyAllocationState (+ Publish button)
│       └── AllocationTable
│           └── AllocationRow × N (one per asset type)
│               ├── read columns: custodian bal, published, on loan, remaining
│               └── PublishedQuantityInput (inline edit, Section C)
│                   ├── {below_on_loan} → BelowOnLoanWarning
│                   └── {is_zero} → ZeroConfirmDialog
└── SaveScopeButton (per panel)
```

### 6.2 `SupplierInventoryPage`

**File:** `src/pages/inventory/SupplierInventoryPage.tsx` (new file)

```tsx
import { CustodianPositionsSection } from './CustodianPositionsSection';
import { AgentAllocationPanels } from './AgentAllocationPanels';

export function SupplierInventoryPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Inventory</h1>
      <CustodianPositionsSection />
      <AgentAllocationPanels />
    </div>
  );
}
```

### 6.3 `CustodianPositionsSection`

**File:** `src/pages/inventory/CustodianPositionsSection.tsx` (new file)

**Staleness threshold:** Read from `import.meta.env.VITE_FEED_STALENESS_THRESHOLD_SECONDS` (default `3600` if unset). Compare `Date.now() - new Date(as_of).getTime()` (in ms) against the threshold (in seconds × 1000).

```tsx
import { useCustodianInventory } from '@/hooks/useCustodianInventory';

const STALENESS_THRESHOLD_MS =
  (Number(import.meta.env.VITE_FEED_STALENESS_THRESHOLD_SECONDS) || 3600) * 1000;

function StalenessChip() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      Stale feed
    </span>
  );
}

export function CustodianPositionsSection() {
  const { entries, isLoadingLinks, linksError } = useCustodianInventory();

  return (
    <section aria-labelledby="custodian-positions-heading">
      <h2 id="custodian-positions-heading" className="text-lg font-semibold text-gray-900 mb-4">
        Custodian Positions
      </h2>

      {isLoadingLinks && (
        <p className="text-sm text-gray-500">Loading custodian data…</p>
      )}
      {linksError && (
        <p role="alert" className="text-sm text-red-600">{linksError}</p>
      )}

      {!isLoadingLinks && !linksError && entries.length === 0 && (
        <p className="text-sm text-gray-500">
          No custodians registered.{' '}
          <a href="/dashboard/custodians" className="text-blue-600 hover:underline">
            Register a custodian
          </a>
        </p>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Custodian</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Account ref</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset type</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Total balance</th>
                <th className="py-2 text-left font-medium text-gray-600">As of</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ link, data, isLoading, error }) => {
                if (isLoading) {
                  return (
                    <tr key={link.custodian_link_id} className="border-b border-gray-100">
                      <td colSpan={5} className="py-3 text-sm text-gray-400">
                        {link.custodian_id} — loading…
                      </td>
                    </tr>
                  );
                }
                if (error) {
                  return (
                    <tr key={link.custodian_link_id} className="border-b border-gray-100">
                      <td colSpan={5} className="py-3 text-sm text-red-600" role="alert">
                        {link.custodian_id}: {error}
                      </td>
                    </tr>
                  );
                }
                if (!data || data.positions.length === 0) {
                  return (
                    <tr key={link.custodian_link_id} className="border-b border-gray-100">
                      <td className="py-3 pr-4 text-sm text-gray-700">{link.custodian_id}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">{link.account_ref}</td>
                      <td colSpan={3} className="py-3 text-sm text-gray-400">No positions</td>
                    </tr>
                  );
                }
                return data.positions.map((pos) => {
                  const stale =
                    Date.now() - new Date(pos.as_of).getTime() > STALENESS_THRESHOLD_MS;
                  return (
                    <tr
                      key={`${link.custodian_link_id}-${pos.asset_type}`}
                      className="border-b border-gray-100"
                    >
                      <td className="py-3 pr-4 text-sm text-gray-700">{link.custodian_id}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">{link.account_ref}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-gray-700">{pos.asset_type}</td>
                      <td className="py-3 pr-4 text-gray-700">{pos.quantity}</td>
                      <td className="py-3 text-gray-600 text-xs">
                        {new Date(pos.as_of).toLocaleString()}
                        {stale && <StalenessChip />}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

### 6.4 `AgentAllocationPanels`

**File:** `src/pages/inventory/AgentAllocationPanels.tsx` (new file)

This component contains both Section B (read-only columns) and Section C (inline edit controls). Each connection gets its own panel with its own local edit state.

```tsx
import { useState, useEffect } from 'react';
import { useAgentAllocations } from '@/hooks/useAgentAllocations';
import { setConnectionInventoryScope } from '@/api/inventoryApi';
import { StatusBadge } from '@/components/StatusBadge';
import type { AllocationEntry } from '@/types/inventory';

export function AgentAllocationPanels() {
  const { allocations, isLoadingConnections, connectionsError, refetchAll, refetchConnection } =
    useAgentAllocations();

  if (isLoadingConnections) {
    return <p className="text-sm text-gray-500">Loading connections…</p>;
  }
  if (connectionsError) {
    return <p role="alert" className="text-sm text-red-600">{connectionsError}</p>;
  }
  if (allocations.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No active or suspended connections. Invite an agent from the Connections page.
      </p>
    );
  }

  return (
    <section aria-labelledby="agent-allocations-heading">
      <h2 id="agent-allocations-heading" className="text-lg font-semibold text-gray-900 mb-4">
        Agent Allocations
      </h2>
      <div className="space-y-6">
        {allocations.map((alloc) => (
          <AgentAllocationPanel
            key={alloc.connection_id}
            alloc={alloc}
            onSaved={() => refetchConnection(alloc.connection_id)}
          />
        ))}
      </div>
    </section>
  );
}

interface AgentAllocationPanelProps {
  alloc: import('@/types/inventory').ConnectionAllocation;
  onSaved: () => Promise<void>;
}

function AgentAllocationPanel({ alloc, onSaved }: AgentAllocationPanelProps) {
  // editScope mirrors published_quantity per asset; editable inline.
  const [editScope, setEditScope] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmZeroAsset, setConfirmZeroAsset] = useState<string | null>(null);
  const [showPublishForm, setShowPublishForm] = useState(false);

  // Sync edit scope whenever upstream alloc.entries changes.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const e of alloc.entries) {
      next[e.asset_type] = e.published_quantity;
    }
    setEditScope(next);
  }, [alloc.entries]);

  const isUnpublished = !alloc.isLoading && !alloc.error && alloc.entries.length === 0;
  const hasOnLoanWarning = (asset: string, newQty: string): boolean => {
    const entry = alloc.entries.find((e) => e.asset_type === asset);
    if (!entry) return false;
    return Number(newQty) < Number(entry.already_booked);
  };

  async function doSave(overriddenScope?: Record<string, string>) {
    const scope = overriddenScope ?? editScope;
    setSaveLoading(true);
    setSaveError(null);
    try {
      await setConnectionInventoryScope(alloc.connection_id, scope);
      await onSaved();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleSave() {
    // Check if any asset is being set to 0 — require confirmation.
    const zeroAsset = Object.entries(editScope).find(
      ([, qty]) => Number(qty) === 0,
    );
    if (zeroAsset) {
      setConfirmZeroAsset(zeroAsset[0]);
      return;
    }
    await doSave();
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="font-mono text-xs text-gray-700">
          Agent: {alloc.agent_id.slice(0, 8)}…
        </span>
        <StatusBadge status={alloc.status} />
      </div>

      {alloc.isLoading && (
        <p className="text-sm text-gray-400">Loading inventory…</p>
      )}
      {alloc.error && (
        <p role="alert" className="text-sm text-red-600">{alloc.error}</p>
      )}

      {isUnpublished && !showPublishForm && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">No inventory published to this agent.</p>
          <button
            type="button"
            onClick={() => setShowPublishForm(true)}
            className="px-3 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            + Publish
          </button>
        </div>
      )}

      {(showPublishForm || alloc.entries.length > 0) && !alloc.isLoading && !alloc.error && (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Total at custodian</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Published to agent</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">On loan</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Remaining</th>
                  <th className="py-2 text-left font-medium text-gray-600">Edit published qty</th>
                </tr>
              </thead>
              <tbody>
                {alloc.entries.map((entry) => {
                  const remaining = Math.max(
                    0,
                    Number(entry.published_quantity) - Number(entry.already_booked),
                  );
                  const currentEdit = editScope[entry.asset_type] ?? entry.published_quantity;
                  const belowOnLoan = hasOnLoanWarning(entry.asset_type, currentEdit);

                  return (
                    <tr key={entry.asset_type} className="border-b border-gray-100">
                      <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                        {entry.asset_type}
                      </td>
                      <td className="py-3 pr-4 text-gray-700">{entry.custodian_balance}</td>
                      <td className="py-3 pr-4 text-gray-700">{entry.published_quantity}</td>
                      <td className="py-3 pr-4 text-gray-700">{entry.already_booked}</td>
                      <td className="py-3 pr-4 text-gray-700">{remaining.toString()}</td>
                      <td className="py-3">
                        <div className="flex flex-col gap-1">
                          <input
                            aria-label={`${entry.asset_type} published quantity`}
                            type="text"
                            inputMode="decimal"
                            value={currentEdit}
                            onChange={(e) =>
                              setEditScope((prev) => ({
                                ...prev,
                                [entry.asset_type]: e.target.value,
                              }))
                            }
                            className="w-32 border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                          {belowOnLoan && (
                            <p className="text-xs text-amber-700">
                              You are reducing below the currently on-loan quantity.
                              Existing loans are not affected.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-red-600 mb-3">{saveError}</p>
          )}

          <div className="flex justify-end gap-3">
            {showPublishForm && isUnpublished && (
              <button
                type="button"
                onClick={() => setShowPublishForm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveLoading}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saveLoading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}

      {/* Zero-confirmation dialog */}
      {confirmZeroAsset && (
        <div role="dialog" aria-modal="true" aria-label="Confirm zero allocation">
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                Set {confirmZeroAsset} to 0?
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Setting the published quantity to 0 will block all new loan bookings
                for {confirmZeroAsset} on this connection. Existing loans are not affected.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmZeroAsset(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmZeroAsset(null);
                    void doSave();
                  }}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 7. Routing changes

### 7.1 `src/App.tsx`

Add the new route inside the `/dashboard` protected route block, alongside existing inventory-related routes:

```tsx
import { SupplierInventoryPage } from './pages/inventory/SupplierInventoryPage';

// Inside the <Route path="/dashboard" ...> block:
<Route path="inventory" element={<SupplierInventoryPage />} />
```

Full updated route block (diff only):
```diff
+import { SupplierInventoryPage } from './pages/inventory/SupplierInventoryPage';

 // inside the /dashboard ProtectedRoute:
+<Route path="inventory" element={<SupplierInventoryPage />} />
```

### 7.2 `src/pages/DashboardPage.tsx`

Add an "Inventory" nav link visible only for suppliers:

```diff
+const onInventory = location.pathname.startsWith('/dashboard/inventory');

 // In the nav, after the "Custodians" link (supplier-only block):
+{role === 'supplier' && (
+  <Link
+    to="/dashboard/inventory"
+    className={`text-sm ${onInventory ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
+  >
+    Inventory
+  </Link>
+)}
```

---

## 8. MSW mock handlers

### 8.1 New handler file

**File:** `src/mocks/handlers/inventory.ts` (new file)

```ts
import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';

// Mock custodian inventory data keyed by custodian_link_id.
// Mirrors the seeded custodian in src/mocks/handlers/custodians.ts (clink-001).
const MOCK_CUSTODIAN_INVENTORY: Record<
  string,
  { account_ref: string; positions: Array<{ asset_type: string; quantity: string; as_of: string }> }
> = {
  'clink-001': {
    account_ref: 'vault-123',
    positions: [
      {
        asset_type: 'BTC',
        quantity: '500.0',
        as_of: new Date(Date.now() - 600_000).toISOString(), // 10 min ago — fresh
      },
      {
        asset_type: 'ETH',
        quantity: '250.0',
        as_of: new Date(Date.now() - 600_000).toISOString(),
      },
      {
        asset_type: 'SOL',
        quantity: '1000.0',
        as_of: new Date(Date.now() - 4_000_000).toISOString(), // ~67 min ago — stale
      },
    ],
  },
};

export const inventoryHandlers = [
  // GET /api/custodians/:custodian_link_id/inventory
  http.get('/api/custodians/:custodian_link_id/inventory', async ({ params }) => {
    await delay(20);
    const id = params.custodian_link_id as string;
    const data = MOCK_CUSTODIAN_INVENTORY[id];
    if (!data) {
      return mockError('not_found', 'Custodian link not found', 404);
    }
    return HttpResponse.json(
      {
        custodian_link_id: id,
        account_ref: data.account_ref,
        positions: data.positions,
      },
      { status: 200 },
    );
  }),
];
```

### 8.2 Register handlers

**File:** `src/mocks/browser.ts` and `src/mocks/server.ts`

```ts
import { inventoryHandlers } from './handlers/inventory';

// Add to the handlers array:
export const handlers = [
  ...connectionsHandlers,
  ...custodiansHandlers,
  ...inventoryHandlers,
  // ... other handlers
];
```

### 8.3 Stale feed test helper

For tests that need to verify staleness chip rendering, override the `as_of` timestamp using `server.use(...)`:

```ts
server.use(
  http.get('/api/custodians/:id/inventory', async ({ params }) => {
    await delay(0);
    return HttpResponse.json({
      custodian_link_id: params.id,
      account_ref: 'vault-123',
      positions: [
        {
          asset_type: 'BTC',
          quantity: '500.0',
          as_of: new Date(Date.now() - 7_200_000).toISOString(), // 2 hours ago — stale
        },
      ],
    });
  }),
);
```

---

## 9. Acceptance test scenarios

**File:** `src/test/SupplierInventoryPage.test.tsx` (new file)

Test setup pattern: import `server`, `resetMockConnections`, supplier JWT token. Render `<SupplierInventoryPage />` inside `<MemoryRouter>` + `<AuthProvider>` with supplier token set.

### Section A — Custodian positions

```
test_renders_custodian_positions_table
  - Render page with supplier JWT
  - Wait for "Custodian Positions" heading
  - Expect table rows containing "BTC", "500.0", "vault-123"

test_shows_loading_state_for_custodian_positions
  - Use server.use() to delay /api/custodians response
  - Render page
  - Expect "Loading custodian data…" text before data arrives

test_shows_error_when_custodians_list_fails
  - server.use() → GET /api/custodians → 500
  - Render page
  - Expect error alert visible for custodians section

test_shows_stale_feed_chip_for_old_as_of
  - Override GET /api/custodians/:id/inventory to return as_of = 2 hours ago
  - VITE_FEED_STALENESS_THRESHOLD_SECONDS = 3600 (default)
  - Render page
  - Expect "Stale feed" chip visible in the SOL row (or whichever has the old timestamp)

test_does_not_show_stale_chip_for_fresh_as_of
  - Default mock data has BTC as_of = 10 min ago
  - Render page
  - Expect no "Stale feed" chip on BTC row

test_shows_register_custodian_link_when_no_custodians
  - server.use() → GET /api/custodians → { custodians: [] }
  - Render page
  - Expect "No custodians registered" message with link to /dashboard/custodians
```

### Section B — Per-agent allocation panels

```
test_renders_one_panel_per_active_or_suspended_connection
  - Default seed has conn-002 (active)
  - Render page
  - Expect one panel with "Agent: org-003…" header

test_panel_shows_allocation_columns
  - conn-002 (active) has inventory scope BTC=100, ETH=25 in mock
  - Render page
  - Within panel: expect "BTC", "100.0", "500.0" (custodian bal), "0.0" (on loan)

test_shows_empty_state_with_publish_button_for_unpublished_connection
  - server.use() → GET /api/connections/:id/inventory → { entries: [] }
  - Render page
  - Expect "No inventory published to this agent" and "+ Publish" button

test_pending_connections_are_excluded
  - conn-001 is pending; conn-002 is active
  - Render page
  - Expect only 1 panel (for conn-002), not 2
```

### Section C — Inline allocation controls

```
test_edit_published_quantity_and_save
  - Render page, wait for conn-002 panel
  - Find input "BTC published quantity", change value to "80"
  - Click "Save"
  - Expect PUT /api/connections/conn-002/inventory-scope called with { scope: { BTC: "80", ETH: "25" } }
  - Expect panel refreshes showing updated quantity

test_below_on_loan_warning_shown
  - Override GET inventory to return already_booked = "50.0" for BTC
  - Change published qty input for BTC to "30"
  - Expect warning "You are reducing below the currently on-loan quantity" visible

test_below_on_loan_does_not_block_save
  - Same setup as above
  - Click "Save"
  - Expect PUT request fires (save is not blocked)

test_setting_to_zero_shows_confirmation_dialog
  - Render page, find BTC input
  - Change to "0"
  - Click "Save"
  - Expect confirmation dialog "Set BTC to 0?" visible
  - Click "Cancel" → dialog closes, PUT not fired
  - Click "Confirm" → PUT fires with scope { BTC: "0", ... }

test_save_error_shown_inline
  - server.use() → PUT /api/connections/:id/inventory-scope → 409
  - Click "Save"
  - Expect error message visible inside the panel (role="alert")

test_publish_button_opens_inline_form
  - server.use() → GET inventory → { entries: [] }
  - Click "+ Publish"
  - Expect allocation table visible (rows may be empty, save button visible)
```

---

## 10. Open decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| **D-1** | **Org names vs org IDs in panel headers** | Open | The current `Connection` type only carries `agent_id` (UUID). The panel currently shows a truncated UUID. When org name is added to `ConnectionResponse` (a future M2/M5 task), `AgentAllocationPanel` should switch to displaying `org_name`. |
| **D-2** | **Staleness threshold env var name** | Accepted | `VITE_FEED_STALENESS_THRESHOLD_SECONDS` aligns with the backend's `FEED_STALENESS_THRESHOLD_SECONDS`. The Vite prefix is required for client-side access. Default 3600s. |
| **D-3** | **`GET /custodians/{id}/inventory` vs aggregated route** | Accepted | One call per custodian link is chosen for MVP simplicity and to preserve per-custodian error isolation. If a supplier has many custodians, a `GET /custodians/inventory` bulk endpoint could reduce round-trips. |
| **D-4** | **Edit scope initial state for new (unpublished) connections** | Accepted | The "+ Publish" button reveals the allocation table, which starts empty. The user adds asset rows via the inline form from Section C's existing "Add Asset" functionality (carried forward from the F-061 modal). For MVP, the full "Add Asset" row input is not duplicated here — rows are added by the user editing the published_quantity directly after the initial publish saves scope from the existing connection-detail modal. A future iteration can add in-page asset addition. |
| **D-5** | **`setConnectionInventoryScope` re-uses F-061 PUT endpoint** | Accepted | No new endpoints required for Section C. F-061's `PUT /connections/{id}/inventory-scope` is the save target. |
