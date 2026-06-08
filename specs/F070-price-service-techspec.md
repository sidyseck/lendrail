# LendRail — Technical Specification: Price Service (F-070)

| Field | Value |
|---|---|
| Feature | F-070 — Indicative Price Service |
| PRD reference | PRD-D-003 |
| Milestone | Price Service |
| Based on | ARCHITECTURE.md, M4-loan-lifecycle-techspec.md, PRD-D-002, PRD-D-003 |
| Status | Implementation-ready |

---

## 0. Guiding principles

- **Simulator behind the existing adapter protocol.** `MarketDataAdapter.get_price()` is the only interface consumers call. The simulator lives entirely inside the adapter layer; no service or router changes are needed for point-in-time reads.
- **SSE for streaming.** Server-Sent Events are unidirectional (server→client), require no extra libraries on either side, and work over the existing HTTP stack. A real WebSocket feed can replace the SSE endpoint later without touching consumers.
- **Async all the way.** The simulator runs as an asyncio background task started at app startup. No threads.
- **No persistence.** Prices are ephemeral in-process state. No DB writes, no Redis.
- **Frontend fetches once, streams thereafter.** The booking strip does a single REST fetch on selection change. The inventory screen opens an SSE connection for the duration of the session.

---

## 1. New and changed files

```
backend/
  app/
    adapters/
      mock_market_data.py          [CHANGE] read from shared PriceCache instead of fixed config value
      price_simulator.py           [NEW]    asyncio background task + PriceCache
    api/
      routers/
        loans.py                   [CHANGE] SSE streaming endpoint added
    core/
      config.py                    [CHANGE] add mock_eth_price_usd, price_update_interval_seconds; rename mock_btc_price_usd → mock_btc_base_price_usd

frontend/
  src/
    api/
      priceApi.ts                  [NEW]    REST fetch for point-in-time price
    hooks/
      usePriceStream.ts            [NEW]    SSE connection, live price state
    components/
      loans/
        BookLoanStrip.tsx          [CHANGE] auto-populate asset_price_usd from usePriceStream
    pages/
      inventory/
        AggregatedInventorySection.tsx  [CHANGE] USD equivalent column via usePriceStream
```

No new migrations. No schema changes. No new Pydantic models (the existing `MarketPriceResponse` is reused).

---

## 2. Backend

### 2.1 `price_simulator.py` — PriceCache and simulator task

```python
# app/adapters/price_simulator.py

import asyncio
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class PriceCache:
    """Thread-safe enough: asyncio is single-threaded. One writer (simulator), many readers."""
    _prices: dict[str, float] = field(default_factory=dict)
    _as_of: dict[str, datetime] = field(default_factory=dict)

    def update(self, asset_type: str, price_usd: float) -> None:
        self._prices[asset_type] = price_usd
        self._as_of[asset_type] = datetime.now(timezone.utc)

    def get(self, asset_type: str) -> tuple[float, datetime] | None:
        if asset_type not in self._prices:
            return None
        return self._prices[asset_type], self._as_of[asset_type]

    def all(self) -> dict[str, float]:
        return dict(self._prices)


_cache = PriceCache()


def get_price_cache() -> PriceCache:
    return _cache


async def run_price_simulator(
    base_prices: dict[str, float],
    max_deviation_pct: float,
    interval_seconds: float,
) -> None:
    """
    Continuously updates PriceCache with a random walk constrained to ±max_deviation_pct
    of each asset's base price. Runs until the task is cancelled.
    """
    current = dict(base_prices)
    for asset, price in current.items():
        _cache.update(asset, price)

    while True:
        await asyncio.sleep(interval_seconds)
        for asset, base in base_prices.items():
            low = base * (1 - max_deviation_pct / 100)
            high = base * (1 + max_deviation_pct / 100)
            tick = random.uniform(-0.003, 0.003) * base  # small per-tick step
            next_price = max(low, min(high, current[asset] + tick))
            current[asset] = next_price
            _cache.update(asset, next_price)
```

**Notes:**
- `_cache` is a module-level singleton. The FastAPI DI function `get_price_cache()` returns it. Adapters and routers receive it via dependency injection.
- The random walk applies a small per-tick step (`±0.3% of base`) then clamps to the ±2% band. This produces smooth movement instead of teleporting to band edges.
- The simulator task is started in `app/main.py` lifespan and stored so it can be cancelled on shutdown.

### 2.2 `app/core/config.py` — settings additions

Add to `Settings`:

```python
mock_btc_base_price_usd: float = 63_500.0
mock_eth_base_price_usd: float = 1_700.0
price_max_deviation_pct: float = 2.0
price_update_interval_seconds: float = 1.0
```

Remove `mock_btc_price_usd` (now superseded). The `mock_btc_base_price_usd` key changes name, so update any existing `.env.local` references.

### 2.3 `mock_market_data.py` — read from cache

```python
# app/adapters/mock_market_data.py

from datetime import datetime, timezone
from app.adapters.interfaces import AssetPrice
from app.adapters.price_simulator import PriceCache


class MockMarketDataAdapter:
    def __init__(self, cache: PriceCache) -> None:
        self._cache = cache

    async def get_price(self, asset_type: str) -> AssetPrice:
        entry = self._cache.get(asset_type)
        if entry is None:
            raise ValueError(f"No price available for {asset_type}")
        price_usd, as_of = entry
        return AssetPrice(
            asset_type=asset_type,
            price_usd=price_usd,
            as_of=as_of,
            source="simulator",
        )
```

`MockMarketDataAdapter` now requires a `PriceCache` argument. Update `build_market_data_adapter()` in `providers.py` accordingly:

```python
def build_market_data_adapter() -> MarketDataAdapter:
    from app.adapters.price_simulator import get_price_cache
    name = get_settings().market_data_adapter
    if name == "mock":
        return MockMarketDataAdapter(cache=get_price_cache())
    raise NotImplementedError(f"market data adapter '{name}' not wired yet")
```

### 2.4 `app/main.py` — lifespan startup/shutdown

```python
# inside lifespan context manager, after existing startup:

from app.adapters.price_simulator import run_price_simulator

settings = get_settings()
base_prices = {
    "BTC": settings.mock_btc_base_price_usd,
    "ETH": settings.mock_eth_base_price_usd,
}
_simulator_task = asyncio.create_task(
    run_price_simulator(
        base_prices=base_prices,
        max_deviation_pct=settings.price_max_deviation_pct,
        interval_seconds=settings.price_update_interval_seconds,
    )
)

# on shutdown (after yield):
_simulator_task.cancel()
with contextlib.suppress(asyncio.CancelledError):
    await _simulator_task
```

### 2.5 SSE streaming endpoint — `loans.py`

Add to the existing loans router (reuses the same file since it is already tagged `loans` and holds `market-data` routes):

```python
from fastapi.responses import StreamingResponse

@router.get("/market-data/prices/stream")
async def stream_prices(
    caller: AuthUser = Depends(get_current_user),
    price_cache: PriceCache = Depends(get_price_cache_dep),
) -> StreamingResponse:
    """SSE endpoint. Emits a JSON price snapshot every second."""
    if caller.role not in ("supplier", "agent"):
        raise Forbidden("Only suppliers and agents can stream market prices")

    async def event_generator():
        while True:
            prices = price_cache.all()
            data = json.dumps(prices)
            yield f"data: {data}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

Add a DI helper in `api/deps.py`:

```python
from app.adapters.price_simulator import get_price_cache, PriceCache

def get_price_cache_dep() -> PriceCache:
    return get_price_cache()
```

**SSE payload format** (one event per second):

```
data: {"BTC": 63412.50, "ETH": 1698.20}

data: {"BTC": 63450.12, "ETH": 1699.01}
```

Each message is a flat JSON object mapping asset type to current price in USD. Clients reconnect automatically on disconnect (built into `EventSource`).

---

## 3. Frontend

### 3.1 `priceApi.ts` — point-in-time REST fetch

```typescript
// src/api/priceApi.ts

import { getToken } from '@/auth/tokenStore';

const API_BASE =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface MarketPrice {
  asset_type: string;
  price_usd: string;
  as_of: string;
}

export async function getMarketPrice(assetType: string): Promise<MarketPrice> {
  const res = await fetch(`${API_BASE}/market-data/prices/${encodeURIComponent(assetType)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch price for ${assetType}`);
  return (await res.json()) as MarketPrice;
}
```

### 3.2 `usePriceStream.ts` — live prices via SSE

```typescript
// src/hooks/usePriceStream.ts

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/auth/tokenStore';

export type PriceMap = Record<string, number>;

export function usePriceStream(): PriceMap {
  const [prices, setPrices] = useState<PriceMap>({});
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = getToken();
    const url = `${window.location.origin}/api/market-data/prices/stream`;
    // EventSource does not support custom headers; pass token via query param
    const es = new EventSource(`${url}?token=${encodeURIComponent(token ?? '')}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as PriceMap;
        setPrices(data);
      } catch {
        // malformed frame — ignore
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return prices;
}
```

**Auth note:** `EventSource` does not support `Authorization` headers. Two options:

1. Accept `?token=` query parameter on the SSE endpoint and validate it in a dependency.
2. Use a short-lived cookie set before opening the EventSource.

This spec chooses option 1 (query param token). The SSE dependency in `deps.py` must be updated to accept `token: str | None = Query(default=None)` as an alternative to the `Authorization` header, validated via `decode_token()`.

### 3.3 `BookLoanStrip.tsx` — auto-populate asset price

Changes:

1. Import `usePriceStream`.
2. Call `const prices = usePriceStream()` at the top of the component.
3. Add `asset_price_usd: string` to `FormValues` and `EMPTY_FORM`.
4. Add a `useEffect` that watches `selected` (the chosen inventory row) and sets `values.asset_price_usd` from `prices[selected.asset_type]` when the price becomes available.
5. Render the asset price field between the quantity and rate fields:

```tsx
<label className="lg:col-span-2">
  <span className="sr-only">Asset Price USD</span>
  <input
    required
    aria-label="Asset Price USD"
    placeholder="Price USD"
    value={values.asset_price_usd}
    onChange={(e) => updateValue('asset_price_usd', e.target.value)}
    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
  />
</label>
```

6. Pass `asset_price_usd: values.asset_price_usd` in the `LoanBookingRequest` payload sent to `bookLoan()`.

**Effect logic:**

```typescript
useEffect(() => {
  if (!selected) return;
  const p = prices[selected.asset_type];
  if (p !== undefined) {
    updateValue('asset_price_usd', p.toFixed(2));
  }
}, [selected?.asset_type, prices]);
```

The effect re-runs when the asset type changes (inventory selection) or when new prices arrive. Since prices update every second, this keeps the displayed default fresh without a separate fetch. The agent may still edit the field — it is not locked.

### 3.4 `AggregatedInventorySection.tsx` — USD equivalent column

Changes:

1. Accept `prices: PriceMap` as a new prop (passed from `AgentAvailableInventoryPage`).
2. Add a "USD value" header column.
3. For each row, compute `usdValue = row.total_available_num * prices[row.asset_type]` and render it formatted as `$` + `toLocaleString('en-US', { maximumFractionDigits: 0 })`. Fall back to `—` if the price is missing.

`AgentAvailableInventoryPage` calls `usePriceStream()` and passes `prices` to `AggregatedInventorySection`.

**Type change:** `AggregatedAssetRow` in `types/inventory.ts` should already have `total_available` as a string. The component will parse it as `parseFloat(row.total_available)` for the multiplication. No schema changes required.

### 3.5 `LoanBookingRequest` type update

Add `asset_price_usd: string` to the existing `LoanBookingRequest` interface in `types/loan.ts`. The backend already accepts this field (added in PRD-D-002 / M4).

---

## 4. Test plan

### Backend

| Test | File | What to assert |
|---|---|---|
| Simulator stays within band | `test_adapters.py` | After N ticks, all prices remain within ±2% of base |
| `MockMarketDataAdapter` reads cache | `test_adapters.py` | Seeded cache value is returned by `get_price()` |
| Unknown asset raises | `test_adapters.py` | `get_price("UNKNOWN")` raises `ValueError` |
| SSE endpoint streams | `test_adapters.py` or integration | Two consecutive frames have numeric price values |
| Existing `GET /market-data/prices/{asset_type}` still passes | `test_adapters.py` | Response price reflects cache, not static config |

### Frontend

| Test | File | What to assert |
|---|---|---|
| `BookLoanStrip` shows pre-populated price | `LoanListPage.test.tsx` or dedicated | After MSW handler returns a price, the price field has the value |
| Agent can override price | same | Editing the field and submitting sends the overridden value |
| `AggregatedInventorySection` USD column | `AgentAvailableInventoryPage.test.tsx` | With mocked prices, USD column shows computed value |
| Missing price shows dash | same | Row with unknown asset shows `—` in USD column |

### Mock handler update

Add to `src/mocks/handlers/loans.ts`:

```typescript
http.get('/api/market-data/prices/:assetType', ({ params }) => {
  const prices: Record<string, string> = { BTC: '63500.00', ETH: '1700.00' };
  const price = prices[params.assetType as string] ?? '0.00';
  return HttpResponse.json({ asset_type: params.assetType, price_usd: price, as_of: new Date().toISOString() });
}),
```

SSE endpoint does not need a mock handler for existing tests because `EventSource` in jsdom is not available; `usePriceStream` should be mocked at the hook level in tests that need prices.

---

## 5. Auth on SSE endpoint

The SSE endpoint in `api/deps.py` needs a variant of `get_current_user` that accepts either:

- `Authorization: Bearer <token>` header, or
- `?token=<token>` query parameter.

```python
async def get_current_user_or_token_param(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    raw = None
    if authorization and authorization.startswith("Bearer "):
        raw = authorization[7:]
    elif token:
        raw = token
    if not raw:
        raise Unauthorized("Missing credentials")
    return await _resolve_user(raw, db)
```

Use this dependency only on the SSE route. All other routes keep `get_current_user` unchanged.

---

## 6. Implementation order

1. `price_simulator.py` + `PriceCache` + tests.
2. `config.py` setting additions; `mock_market_data.py` constructor update; `providers.py` update.
3. `main.py` lifespan wiring.
4. SSE endpoint + auth dep variant + backend SSE test.
5. Frontend: `priceApi.ts`, `usePriceStream.ts`, mock handler.
6. Frontend: `BookLoanStrip.tsx` price field.
7. Frontend: `AggregatedInventorySection.tsx` USD column.
8. Full test pass.

---

## 7. Out of scope

- Persisting price history.
- Per-session price snapshots for audit.
- Multiple simultaneous SSE connections per user (browser handles reconnection automatically).
- Real external market data provider wiring.
- Supplier inventory screen USD values.
- Price-triggered margin call automation.
