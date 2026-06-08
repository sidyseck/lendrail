# LendRail — F-063 Agent Available Inventory Screen Technical Specification

| Field | Value |
|---|---|
| Feature | F-063 — Agent available inventory screen |
| Milestone | M2 (extension) |
| Scope | Frontend only: new page, new hooks, new API module, MSW handler extensions, routing changes, nav badge. |
| Depends on | F-061 (`GET /connections/{id}/inventory` — agent JWT returns `effective_available` only), `GET /connections`, F-048 in-app notifications (`supplier_allocation_changed` event) |
| Audience | Engineer implementing F-063 against the M4 + F-061 codebase |
| Status | Implementation-ready spec |

---

## 0. Purpose and guiding principles

F-063 gives agents a real-time view of what inventory is available to them across all their supplier connections. It aggregates `effective_available` from every active connection and shows the breakdown by supplier so an agent can assess where to source a loan before initiating a booking.

The feature also reacts to `supplier_allocation_changed` notification events: when a supplier adjusts their published allocation, the agent's screen highlights the affected row and shows a badge on the navigation link to draw attention.

**Key constraints carried over from F-061:**

- The agent JWT response from `GET /connections/{id}/inventory` returns only `{ asset_type, effective_available }` per entry.
- `already_booked` and `published_quantity` are **not** in the agent response.
- `custodian_balance` is **not** in the agent response.

**`already_booked` open decision (OD-1):** The agent does not receive `already_booked` from the inventory endpoint. Two options exist:
  - **(a) Omit the "on loan" column from Section A.** Recommended for MVP.
  - **(b) Derive it from `GET /loans?state=active,pending` filtered by connection.** Adds a cross-domain call and coupling to the loan API.

**This spec adopts option (a).** The "on loan" column is omitted from the agent's Section A aggregation. It is documented as a known gap in §10 (Open Decisions) for future resolution.

**Guiding principles (identical to the rest of the codebase):**
- Fetch pattern: plain `fetch()` + `authHeaders()` in an API module or custom hook.
- Error envelope: always `{ error: { code, message } }`.
- Decimal quantities: always string-typed throughout; parse to `Number` only for display arithmetic.
- Role guard: this page is agent-only. Route rendered only when `role === 'agent'`.

---

## 1. Overview of changes

| Area | Change |
|---|---|
| **`src/App.tsx`** | Add route `/dashboard/available-inventory` |
| **`src/pages/DashboardPage.tsx`** | Add "Available Inventory" nav link for agent role, with badge count |
| **`src/types/inventory.ts`** | Add `AgentInventoryEntry`, `SupplierBreakdownRow`, `AggregatedInventory`, `AllocationNotification` |
| **`src/api/agentInventoryApi.ts`** | New: `getAgentConnectionInventory()`, `getNotifications()`, `markNotificationRead()` |
| **`src/hooks/useAgentInventory.ts`** | New: fetches and aggregates inventory for all active connections |
| **`src/hooks/useAllocationNotifications.ts`** | New: polls notifications, manages badge count, tracks row highlights |
| **`src/pages/inventory/AgentAvailableInventoryPage.tsx`** | New: main page component |
| **`src/pages/inventory/AggregatedInventorySection.tsx`** | New: Section A |
| **`src/pages/inventory/SupplierBreakdownSection.tsx`** | New: Section B |
| **`src/mocks/handlers/notifications.ts`** | New: MSW handlers for `GET /notifications` and `POST /notifications/{id}/read` |
| **`src/mocks/browser.ts` / `server.ts`** | Add `notificationsHandlers` to handler array |

---

## 2. Notification API shape

F-048 is listed as a dependency. This spec does not implement F-048 (which covers the full notification system). It only consumes two endpoints assumed to exist from F-048:

### 2.1 `GET /notifications`

Returns notification events for the calling user's org.

**Request:**
```
GET /notifications?event=supplier_allocation_changed
Authorization: Bearer <agent-JWT>
```

The `event` query param is optional but used here to filter to allocation events only.

**Response `200`:**
```json
{
  "notifications": [
    {
      "notification_id": "notif-001",
      "event": "supplier_allocation_changed",
      "connection_id": "conn-002",
      "read": false,
      "created_at": "2026-06-08T10:30:00Z",
      "payload": {}
    }
  ]
}
```

Fields:
| Field | Type | Notes |
|---|---|---|
| `notification_id` | string | Unique ID |
| `event` | string | `"supplier_allocation_changed"` for this feature |
| `connection_id` | string | The connection affected by the allocation change |
| `read` | boolean | Whether the agent has marked this notification as read |
| `created_at` | string | ISO-8601 — used to compute "X min ago" display |
| `payload` | object | Opaque; not used by this screen |

### 2.2 `POST /notifications/{id}/read`

Marks a single notification as read.

**Request:**
```
POST /notifications/{notification_id}/read
Authorization: Bearer <agent-JWT>
```

**Response `200`:**
```json
{ "notification_id": "notif-001", "read": true }
```

**If F-048 is not yet implemented**, the MSW mock defined in §8 of this spec is a sufficient stand-in. The frontend calls these endpoints at runtime; if they 404, the notification feature degrades gracefully (badge stays at 0, no row highlights).

---

## 3. TypeScript types

### 3.1 Additions to `src/types/inventory.ts`

Append to the existing `src/types/inventory.ts` file (alongside F-062 types):

```ts
// Agent JWT view from GET /connections/{id}/inventory
export interface AgentInventoryEntry {
  asset_type: string;
  effective_available: string;  // Decimal string
}

export interface AgentConnectionInventoryResponse {
  connection_id: string;
  entries: AgentInventoryEntry[];
}

// Per-connection breakdown row (Section B)
export interface SupplierBreakdownRow {
  connection_id: string;
  supplier_id: string;          // displayed as truncated ID until org names are available
  asset_type: string;
  effective_available: string;  // Decimal string
  // "on loan via this supplier" is omitted per OD-1 (see §10)
}

// Section A: client-side aggregation per asset type
export interface AggregatedAssetRow {
  asset_type: string;
  total_available: string;      // SUM(effective_available) across connections, as Decimal string
  // on_loan omitted per OD-1
}

// Notification for allocation changes
export interface AllocationNotification {
  notification_id: string;
  event: string;
  connection_id: string;
  read: boolean;
  created_at: string;   // ISO-8601
  payload: Record<string, unknown>;
}
```

---

## 4. API module

**File:** `src/api/agentInventoryApi.ts` (new file)

```ts
import { getToken } from '@/auth/tokenStore';
import type {
  AgentConnectionInventoryResponse,
  AllocationNotification,
} from '@/types/inventory';

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

export async function getAgentConnectionInventory(
  connectionId: string,
): Promise<AgentConnectionInventoryResponse> {
  const response = await fetch(
    `${API_BASE}/connections/${connectionId}/inventory`,
    { headers: authHeaders() },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(body, 'Failed to load connection inventory.'));
  }
  return (await response.json()) as AgentConnectionInventoryResponse;
}

// Returns unread supplier_allocation_changed notifications since the given ISO timestamp.
// If the backend does not yet support the event filter, falls back to returning all notifications
// and the caller filters client-side.
export async function getAllocationNotifications(
  since?: string,
): Promise<AllocationNotification[]> {
  const params = new URLSearchParams({ event: 'supplier_allocation_changed' });
  if (since) params.set('since', since);
  const response = await fetch(`${API_BASE}/notifications?${params.toString()}`, {
    headers: authHeaders(),
  });
  // Degrade gracefully: if the endpoint does not exist yet, return empty array.
  if (response.status === 404 || response.status === 405) return [];
  if (!response.ok) return [];
  const data = (await response.json()) as { notifications: AllocationNotification[] };
  return data.notifications ?? [];
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/notifications/${notificationId}/read`,
    { method: 'POST', headers: authHeaders() },
  );
  // Fail silently: marking as read is best-effort.
  if (!response.ok) {
    // intentionally empty — log in the future if needed
  }
}
```

---

## 5. Hooks

### 5.1 `useAgentInventory`

**File:** `src/hooks/useAgentInventory.ts` (new file)

Fetches inventory for all active connections and computes both the Section A aggregation and the Section B breakdown.

```ts
import { useCallback, useEffect, useState } from 'react';
import { useConnections } from '@/hooks/useConnections';
import { getAgentConnectionInventory } from '@/api/agentInventoryApi';
import type {
  AggregatedAssetRow,
  SupplierBreakdownRow,
} from '@/types/inventory';

export interface UseAgentInventoryReturn {
  aggregated: AggregatedAssetRow[];
  breakdown: SupplierBreakdownRow[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // Map of connection_id → last fetch timestamp (ISO string), used for staleness
  lastFetchedAt: Record<string, string>;
}

export function useAgentInventory(): UseAgentInventoryReturn {
  const {
    connections,
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch: refetchConnections,
  } = useConnections();

  const [aggregated, setAggregated] = useState<AggregatedAssetRow[]>([]);
  const [breakdown, setBreakdown] = useState<SupplierBreakdownRow[]>([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Record<string, string>>({});

  const activeConns = connections.filter((c) => c.status === 'active');

  const fetchInventory = useCallback(
    async (conns: typeof activeConns) => {
      if (conns.length === 0) {
        setAggregated([]);
        setBreakdown([]);
        return;
      }

      setIsLoadingInventory(true);
      setInventoryError(null);

      const results = await Promise.allSettled(
        conns.map((c) => getAgentConnectionInventory(c.connection_id)),
      );

      const now = new Date().toISOString();
      const newLastFetchedAt: Record<string, string> = {};
      const allBreakdownRows: SupplierBreakdownRow[] = [];

      conns.forEach((conn, i) => {
        const result = results[i];
        if (result.status === 'fulfilled') {
          newLastFetchedAt[conn.connection_id] = now;
          for (const entry of result.value.entries) {
            if (Number(entry.effective_available) > 0) {
              allBreakdownRows.push({
                connection_id: conn.connection_id,
                supplier_id: conn.supplier_id,
                asset_type: entry.asset_type,
                effective_available: entry.effective_available,
              });
            }
          }
        }
        // Silently skip failed connections — partial data is better than none.
      });

      // Aggregate: sum effective_available per asset type across all connections.
      const totals: Record<string, number> = {};
      for (const row of allBreakdownRows) {
        totals[row.asset_type] = (totals[row.asset_type] ?? 0) + Number(row.effective_available);
      }

      const aggregatedRows: AggregatedAssetRow[] = Object.entries(totals)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([asset_type, total]) => ({
          asset_type,
          total_available: total.toString(),
        }));

      setAggregated(aggregatedRows);
      setBreakdown(allBreakdownRows);
      setLastFetchedAt((prev) => ({ ...prev, ...newLastFetchedAt }));
      setIsLoadingInventory(false);
    },
    [],
  );

  useEffect(() => {
    if (!isLoadingConnections && !connectionsError) {
      void fetchInventory(activeConns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingConnections, connectionsError, connections.length]);

  const refetch = useCallback(async () => {
    await refetchConnections();
    // The above triggers useEffect which calls fetchInventory again.
  }, [refetchConnections]);

  return {
    aggregated,
    breakdown,
    isLoading: isLoadingConnections || isLoadingInventory,
    error: connectionsError ?? inventoryError,
    refetch,
    lastFetchedAt,
  };
}
```

### 5.2 `useAllocationNotifications`

**File:** `src/hooks/useAllocationNotifications.ts` (new file)

Polls for `supplier_allocation_changed` notifications since the user's last visit to this screen. Manages the badge count and per-row highlight state. On screen visit, marks unread notifications as read and schedules highlight removal after 3 seconds.

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllocationNotifications,
  markNotificationRead,
} from '@/api/agentInventoryApi';
import type { AllocationNotification } from '@/types/inventory';

const POLL_INTERVAL_MS = 30_000;  // 30 seconds
const HIGHLIGHT_CLEAR_DELAY_MS = 3_000;

const LAST_VISIT_KEY = 'lendrail_agent_inventory_last_visit';

export interface UseAllocationNotificationsReturn {
  // Unread notification count — shown as badge on nav link.
  badgeCount: number;
  // Map of connection_id → notification created_at ISO string for the most recent
  // unread notification on that connection. Used to render "Updated X min ago" chips.
  highlightedConnections: Record<string, string>;
  // Call this when the screen mounts (or comes into focus): marks unread as read,
  // updates last-visit timestamp, schedules highlight removal.
  onScreenVisit: () => Promise<void>;
}

export function useAllocationNotifications(
  isScreenVisible: boolean,
): UseAllocationNotificationsReturn {
  const [badgeCount, setBadgeCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState<AllocationNotification[]>([]);
  const [highlightedConnections, setHighlightedConnections] = useState<Record<string, string>>({});
  const highlightClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Retrieve the last-visit timestamp from localStorage.
  // Returns undefined if never visited (treat all notifications as new).
  function getLastVisit(): string | undefined {
    try {
      return localStorage.getItem(LAST_VISIT_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }

  function setLastVisit(iso: string) {
    try {
      localStorage.setItem(LAST_VISIT_KEY, iso);
    } catch {
      // Storage unavailable — degrade gracefully; badge will not persist across refreshes.
    }
  }

  const fetchNotifications = useCallback(async () => {
    const since = getLastVisit();
    const notifications = await getAllocationNotifications(since);
    const unread = notifications.filter((n) => !n.read);
    setUnreadNotifications(unread);
    setBadgeCount(unread.length);
  }, []);

  // Poll while the user is NOT on the screen. When on-screen, polling is paused
  // because onScreenVisit() handles the mark-as-read flow immediately.
  useEffect(() => {
    if (isScreenVisible) return;

    void fetchNotifications();
    const interval = setInterval(() => void fetchNotifications(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isScreenVisible, fetchNotifications]);

  const onScreenVisit = useCallback(async () => {
    if (unreadNotifications.length === 0) return;

    // Build highlight map: connection_id → most recent notification's created_at.
    const highlights: Record<string, string> = {};
    for (const notif of unreadNotifications) {
      const existing = highlights[notif.connection_id];
      if (!existing || new Date(notif.created_at) > new Date(existing)) {
        highlights[notif.connection_id] = notif.created_at;
      }
    }
    setHighlightedConnections(highlights);

    // Update last-visit timestamp BEFORE marking as read, so any notification
    // that arrives during the mark-as-read loop isn't silently swallowed.
    setLastVisit(new Date().toISOString());

    // Mark all unread as read (fire-and-forget, errors swallowed in markNotificationRead).
    await Promise.allSettled(
      unreadNotifications.map((n) => markNotificationRead(n.notification_id)),
    );

    setBadgeCount(0);
    setUnreadNotifications([]);

    // Remove highlights after a short delay.
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current);
    }
    highlightClearTimerRef.current = setTimeout(() => {
      setHighlightedConnections({});
    }, HIGHLIGHT_CLEAR_DELAY_MS);
  }, [unreadNotifications]);

  useEffect(() => {
    return () => {
      if (highlightClearTimerRef.current) {
        clearTimeout(highlightClearTimerRef.current);
      }
    };
  }, []);

  return { badgeCount, highlightedConnections, onScreenVisit };
}
```

---

## 6. Components

### 6.1 Component tree

```
AgentAvailableInventoryPage                /dashboard/available-inventory
├── <h1>Available Inventory</h1>
├── Section A: AggregatedInventorySection
│   ├── <h2>Totals</h2>
│   ├── {isLoading} → "Loading…"
│   ├── {error} → error alert
│   ├── {aggregated.length === 0} → "No inventory available."
│   └── AggregatedTable
│       └── AggregatedRow × N (one per asset type)
│           columns: Asset type | Total available across suppliers
└── Section B: SupplierBreakdownSection
    ├── <h2>Breakdown by supplier</h2>
    ├── {isLoading} → "Loading…"
    ├── {breakdown.length === 0} → "No available inventory."
    └── BreakdownTable
        └── BreakdownRow × N (one per connection × asset type)
            columns: Supplier | Asset type | Available | [UpdatedChip if highlighted]
```

### 6.2 `AgentAvailableInventoryPage`

**File:** `src/pages/inventory/AgentAvailableInventoryPage.tsx` (new file)

```tsx
import { useEffect } from 'react';
import { AggregatedInventorySection } from './AggregatedInventorySection';
import { SupplierBreakdownSection } from './SupplierBreakdownSection';
import { useAgentInventory } from '@/hooks/useAgentInventory';
import { useAllocationNotifications } from '@/hooks/useAllocationNotifications';

export function AgentAvailableInventoryPage() {
  const inventory = useAgentInventory();
  const notifications = useAllocationNotifications(/* isScreenVisible= */ true);

  // On screen mount: mark notifications as read, activate highlights.
  useEffect(() => {
    void notifications.onScreenVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">Available Inventory</h1>
      <AggregatedInventorySection
        aggregated={inventory.aggregated}
        isLoading={inventory.isLoading}
        error={inventory.error}
      />
      <SupplierBreakdownSection
        breakdown={inventory.breakdown}
        isLoading={inventory.isLoading}
        highlightedConnections={notifications.highlightedConnections}
      />
    </div>
  );
}
```

### 6.3 `AggregatedInventorySection`

**File:** `src/pages/inventory/AggregatedInventorySection.tsx` (new file)

**Note on omitted "on loan" column:** Per OD-1, the agent JWT response does not include `already_booked`. This column is absent from Section A. The heading acknowledges this with a footnote if desired. See §10 for the open decision.

```tsx
import type { AggregatedAssetRow } from '@/types/inventory';

interface Props {
  aggregated: AggregatedAssetRow[];
  isLoading: boolean;
  error: string | null;
}

export function AggregatedInventorySection({ aggregated, isLoading, error }: Props) {
  return (
    <section aria-labelledby="aggregated-inventory-heading">
      <h2 id="aggregated-inventory-heading" className="text-lg font-semibold text-gray-900 mb-4">
        Totals
      </h2>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600">{error}</p>
      )}

      {!isLoading && !error && aggregated.length === 0 && (
        <p className="text-sm text-gray-500">
          No inventory available. Check that your supplier connections are active.
        </p>
      )}

      {!isLoading && !error && aggregated.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset type</th>
                <th className="py-2 text-left font-medium text-gray-600">
                  Total available
                </th>
              </tr>
            </thead>
            <tbody>
              {aggregated.map((row) => (
                <tr key={row.asset_type} className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                    {row.asset_type}
                  </td>
                  <td className="py-3 text-gray-700">{row.total_available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

### 6.4 `SupplierBreakdownSection`

**File:** `src/pages/inventory/SupplierBreakdownSection.tsx` (new file)

Renders the per-supplier × per-asset breakdown. Highlighted rows (from allocation change notifications) render a "Updated X min ago" chip and a subtle yellow background.

```tsx
import type { SupplierBreakdownRow } from '@/types/inventory';

interface Props {
  breakdown: SupplierBreakdownRow[];
  isLoading: boolean;
  // Map of connection_id → notification created_at ISO string
  highlightedConnections: Record<string, string>;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin === 1) return '1 min ago';
  return `${diffMin} min ago`;
}

function UpdatedChip({ createdAt }: { createdAt: string }) {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
      Updated {relativeTime(createdAt)}
    </span>
  );
}

export function SupplierBreakdownSection({
  breakdown,
  isLoading,
  highlightedConnections,
}: Props) {
  return (
    <section aria-labelledby="supplier-breakdown-heading">
      <h2 id="supplier-breakdown-heading" className="text-lg font-semibold text-gray-900 mb-4">
        Breakdown by supplier
      </h2>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {!isLoading && breakdown.length === 0 && (
        <p className="text-sm text-gray-500">No available inventory from suppliers.</p>
      )}

      {!isLoading && breakdown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Supplier</th>
                <th className="py-2 pr-4 text-left font-medium text-gray-600">Asset type</th>
                <th className="py-2 text-left font-medium text-gray-600">Available</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => {
                const highlightTimestamp = highlightedConnections[row.connection_id];
                const isHighlighted = !!highlightTimestamp;
                return (
                  <tr
                    key={`${row.connection_id}-${row.asset_type}`}
                    className={`border-b border-gray-100 ${isHighlighted ? 'bg-yellow-50' : ''}`}
                    data-testid={`breakdown-row-${row.connection_id}-${row.asset_type}`}
                  >
                    <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                      {row.supplier_id.slice(0, 8)}…
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-700">
                      {row.asset_type}
                    </td>
                    <td className="py-3 text-gray-700">
                      {row.effective_available}
                      {isHighlighted && (
                        <UpdatedChip createdAt={highlightTimestamp} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

---

## 7. Routing changes

### 7.1 `src/App.tsx`

```diff
+import { AgentAvailableInventoryPage } from './pages/inventory/AgentAvailableInventoryPage';

 // Inside the /dashboard ProtectedRoute block:
+<Route path="available-inventory" element={<AgentAvailableInventoryPage />} />
```

### 7.2 `src/pages/DashboardPage.tsx`

Two changes:

**a) Add the nav link with badge:**

```diff
+import { useAllocationNotifications } from '@/hooks/useAllocationNotifications';

 export function DashboardPage() {
   const { role, logout } = useAuth();
   const location = useLocation();
+  const onAvailableInventory = location.pathname.startsWith('/dashboard/available-inventory');

+  // Agent-only: notification badge for allocation changes.
+  // isScreenVisible is false when the user is NOT on the available-inventory page.
+  const { badgeCount } = useAllocationNotifications(onAvailableInventory);

   // ... existing code ...

+  {role === 'agent' && (
+    <Link
+      to="/dashboard/available-inventory"
+      className={`relative text-sm ${onAvailableInventory ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
+    >
+      Available Inventory
+      {badgeCount > 0 && (
+        <span className="absolute -top-1 -right-3 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
+          {badgeCount > 9 ? '9+' : badgeCount}
+        </span>
+      )}
+    </Link>
+  )}
```

**Positioning note:** The badge uses `absolute` positioning relative to the `Link` element (which must have `relative` class applied). The `-top-1 -right-3` offsets place the dot above and to the right of the link text. Adjust if the existing nav layout requires a different offset.

**b) Track on-screen state:**

The `isScreenVisible` boolean passed to `useAllocationNotifications` in `DashboardPage.tsx` is `onAvailableInventory`. This means:
- When NOT on the inventory screen: the hook polls and accumulates unread count for the badge.
- When ON the inventory screen: `AgentAvailableInventoryPage` calls `onScreenVisit()` on mount, which marks notifications as read and activates highlights.

Both `DashboardPage` and `AgentAvailableInventoryPage` call `useAllocationNotifications`. React's state lifting is not used here — `DashboardPage` only needs `badgeCount`, while `AgentAvailableInventoryPage` needs `highlightedConnections` and `onScreenVisit`. The two hook instances are independent by design; the badge clears because `DashboardPage`'s hook observes the `read` state on next poll.

**Alternative (shared context):** If coordinating between the two call sites becomes unwieldy, a `NotificationContext` provider wrapping `DashboardPage` can share the hook state. That is a refactor left to the engineer's discretion; the polling-based approach is acceptable for MVP.

---

## 8. MSW mock handlers

### 8.1 New handler file

**File:** `src/mocks/handlers/notifications.ts` (new file)

```ts
import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { AllocationNotification } from '@/types/inventory';

let mockNotifications: AllocationNotification[] = [
  {
    notification_id: 'notif-001',
    event: 'supplier_allocation_changed',
    connection_id: 'conn-002',
    read: false,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
    payload: {},
  },
];

export function resetMockNotifications(): void {
  mockNotifications = [
    {
      notification_id: 'notif-001',
      event: 'supplier_allocation_changed',
      connection_id: 'conn-002',
      read: false,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      payload: {},
    },
  ];
}

export const notificationsHandlers = [
  // GET /api/notifications
  http.get('/api/notifications', async ({ request }) => {
    await delay(20);
    const url = new URL(request.url);
    const eventFilter = url.searchParams.get('event');
    const sinceParam = url.searchParams.get('since');

    let result = [...mockNotifications];
    if (eventFilter) {
      result = result.filter((n) => n.event === eventFilter);
    }
    if (sinceParam) {
      const sinceDate = new Date(sinceParam);
      result = result.filter((n) => new Date(n.created_at) > sinceDate);
    }

    return HttpResponse.json({ notifications: result }, { status: 200 });
  }),

  // POST /api/notifications/:notification_id/read
  http.post('/api/notifications/:notification_id/read', async ({ params }) => {
    await delay(20);
    const id = params.notification_id as string;
    const notif = mockNotifications.find((n) => n.notification_id === id);
    if (!notif) {
      return mockError('not_found', 'Notification not found', 404);
    }
    mockNotifications = mockNotifications.map((n) =>
      n.notification_id === id ? { ...n, read: true } : n,
    );
    return HttpResponse.json(
      { notification_id: id, read: true },
      { status: 200 },
    );
  }),
];
```

### 8.2 Register handlers

**File:** `src/mocks/browser.ts` and `src/mocks/server.ts`

```ts
import { notificationsHandlers } from './handlers/notifications';

export const handlers = [
  ...connectionsHandlers,
  ...custodiansHandlers,
  ...inventoryHandlers,      // from F-062
  ...notificationsHandlers,  // from F-063
  // ... other handlers
];
```

Also export `resetMockNotifications` from `server.ts` for test `beforeEach` cleanup.

### 8.3 Agent inventory handler note

The existing `GET /api/connections/:id/inventory` MSW handler in `src/mocks/handlers/connections.ts` returns the full supplier shape (with `custodian_balance`, `published_quantity`, `already_booked`). For agent tests, the handler must be overridden to return the agent-restricted shape:

```ts
server.use(
  http.get('/api/connections/:connection_id/inventory', async ({ params }) => {
    await delay(20);
    const id = params.connection_id as string;
    // Return agent-role shape: effective_available only
    return HttpResponse.json({
      connection_id: id,
      entries: [
        { asset_type: 'BTC', effective_available: '70.0' },
        { asset_type: 'ETH', effective_available: '20.0' },
      ],
    });
  }),
);
```

Alternatively, the base handler in `connections.ts` can be made role-aware by inspecting the `Authorization` header and decoding the JWT role claim. This is a cleaner approach if other tests also need role-differentiated inventory responses. The decision is left to the engineer. The test override approach is simpler for MVP.

---

## 9. Acceptance test scenarios

**File:** `src/test/AgentAvailableInventoryPage.test.tsx` (new file)

Test setup: import `server`, `resetMockConnections`, `resetMockNotifications`, agent JWT. Render `<AgentAvailableInventoryPage />` inside `<MemoryRouter>` + `<AuthProvider>` with agent token set.

```ts
// Agent JWT: { sub: "user-002", org_id: "org-002", role: "agent", exp: 9999999999 }
const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';
```

### Section A — Aggregated totals

```
test_renders_aggregated_totals_table
  - Override GET /api/connections/:id/inventory → agent shape with BTC=70, ETH=20
  - Render page with agent JWT, wait for "Totals" heading
  - Expect table row: "BTC" | "70.0"
  - Expect table row: "ETH" | "20.0"

test_aggregates_across_multiple_connections
  - Seed 2 active connections (conn-002 with BTC=70, conn-003 with BTC=30)
  - Override both GET /inventory handlers to return agent shape
  - Expect table row: "BTC" | "100.0" (summed)

test_shows_loading_state
  - Use server.use() to delay /api/connections response
  - Render page → expect "Loading…" text

test_shows_error_on_connections_failure
  - server.use() → GET /api/connections → 500
  - Render page → expect error alert

test_shows_empty_state_when_no_active_connections
  - Override GET /api/connections → { connections: [] }
  - Render page → expect "No inventory available" message

test_excludes_zero_available_entries_from_totals
  - Override GET /inventory → { entries: [{ asset_type: "SOL", effective_available: "0.0" }] }
  - Expect "SOL" row not in Section A table
```

### Section B — Breakdown by supplier

```
test_renders_breakdown_rows
  - Override GET /api/connections/:id/inventory → agent shape BTC=70, ETH=20
  - Render page, wait for "Breakdown by supplier" heading
  - Expect row: supplier truncated ID | "BTC" | "70.0"
  - Expect row: supplier truncated ID | "ETH" | "20.0"

test_excludes_zero_effective_available_from_breakdown
  - Override GET /inventory → { entries: [{ asset_type: "BTC", effective_available: "0.0" }] }
  - Expect no rows in Section B table

test_does_not_show_custodian_balance_column
  - Render page
  - Expect no column header "Custodian" or "Custodian Balance" in Section B

test_does_not_show_published_quantity_column
  - Render page
  - Expect no column header "Published" in Section B
```

### Notification badge and row highlights

```
test_badge_shown_on_nav_link_when_unread_notifications
  - resetMockNotifications() seeds notif-001 (unread, connection_id=conn-002)
  - Render DashboardPage with agent JWT (wrap in MemoryRouter)
  - Wait for badge → expect badge with text "1" on "Available Inventory" link

test_badge_cleared_after_visiting_screen
  - Seed 1 unread notification
  - Render AgentAvailableInventoryPage (calls onScreenVisit on mount)
  - Expect POST /api/notifications/notif-001/read was called
  - Badge should drop to 0 (verify by re-rendering DashboardPage or checking badgeCount=0)

test_highlight_chip_shown_on_affected_row
  - Seed notif-001: connection_id=conn-002, created_at=5 min ago
  - Render AgentAvailableInventoryPage
  - Wait for Section B table
  - Expect "Updated 5 min ago" chip (or similar text) on the conn-002 row

test_highlights_removed_after_3_seconds
  - Seed unread notification for conn-002
  - Render AgentAvailableInventoryPage
  - Advance fake timers by 3100ms (using vitest's fake timers: vi.useFakeTimers())
  - Expect "Updated" chip no longer visible on conn-002 row

test_badge_shows_9_plus_when_count_exceeds_9
  - Seed 10 unread notifications
  - Render DashboardPage nav
  - Expect badge text "9+"

test_graceful_degradation_when_notifications_endpoint_404s
  - server.use() → GET /api/notifications → 404
  - Render AgentAvailableInventoryPage → no crash, badge=0, no highlight chips
```

---

## 10. Open decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| **OD-1** | **"On loan" column omitted from agent Section A** | Accepted for MVP | The agent JWT response from `GET /connections/{id}/inventory` does not include `already_booked` (per F-061 §7.2). Two resolution paths exist: (a) omit the column — chosen here; (b) derive from `GET /loans?state=pending,active` grouped by connection + asset_type. Option (b) is feasible but adds coupling between the inventory screen and the loan API. For the agent's borrowing workflow, `effective_available` already accounts for on-loan quantity (it is pre-subtracted on the backend). The "on loan" column would be informational only. Revisit after MVP if agents request it. |
| **OD-2** | **Supplier names vs supplier org IDs in Section B** | Open | `Connection.supplier_id` is a UUID. Section B displays a truncated UUID. When `ConnectionResponse` is extended with `supplier_name` (a future task), update `SupplierBreakdownRow` to carry `supplier_name` and render it instead. |
| **OD-3** | **Notification polling frequency** | Accepted | 30-second poll interval when the user is off-screen. If push notifications (WebSocket/SSE) are added in a future milestone, remove the `setInterval` in `useAllocationNotifications` and replace with a subscription. The hook interface is designed so this replacement is local to the hook. |
| **OD-4** | **Two independent `useAllocationNotifications` instances** | Accepted for MVP | `DashboardPage` and `AgentAvailableInventoryPage` each call the hook independently. The badge in `DashboardPage` resets on the next poll after `AgentAvailableInventoryPage` marks notifications as read. This means there is a brief window (up to 30 seconds) where the badge may still show after the user has visited the screen. If this is unacceptable, lift state into a `NotificationContext` shared between both components. |
| **OD-5** | **`since` parameter support on the backend** | Conditional | The `getAllocationNotifications()` call passes `since=<last_visit_ISO>`. If the backend notification endpoint does not support `since` filtering, all notifications are fetched and the hook filters client-side by `created_at > lastVisit`. The fallback is implemented in `getAllocationNotifications()` implicitly — the `since` param is ignored by the backend, all notifications are returned, and the unread/read flag alone determines badge count. This works correctly only if the backend marks notifications as read on `POST /notifications/{id}/read`. |
| **OD-6** | **F-048 availability** | Conditional | F-063 depends on F-048 for the notification endpoints. If F-048 is not implemented at time of F-063 delivery, the MSW handlers in `src/mocks/handlers/notifications.ts` provide full mock coverage for development and testing. At runtime against a real backend without F-048, `getAllocationNotifications()` returns an empty array (404 → graceful degradation), and the notification feature is silently disabled. The rest of the page (Section A, Section B) functions independently. |
