"""Indicative price simulator — F-070.

Maintains a live PriceCache by applying a per-tick random walk clamped to
±max_deviation_pct of each asset's configured base price. One writer
(the simulator task), many readers (adapters, SSE endpoint).

Replace run_price_simulator with a real external-feed coroutine to switch
to live market data without touching any consumer.
"""
import asyncio
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class PriceCache:
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
    """Continuously update PriceCache. Cancel this task to stop the simulator."""
    current = dict(base_prices)
    for asset, price in current.items():
        _cache.update(asset, price)

    while True:
        await asyncio.sleep(interval_seconds)
        for asset, base in base_prices.items():
            low = base * (1 - max_deviation_pct / 100)
            high = base * (1 + max_deviation_pct / 100)
            # small per-tick step (±0.3% of base) produces smooth movement
            tick = random.uniform(-0.003, 0.003) * base
            current[asset] = max(low, min(high, current[asset] + tick))
            _cache.update(asset, current[asset])
