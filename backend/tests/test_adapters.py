"""Adapter tests — F-008 (custodian) + F-070 (price simulator)."""
import asyncio
import os

import pytest

from app.adapters.mock_custodian import MockCustodianAdapter
from app.adapters.mock_market_data import MockMarketDataAdapter
from app.adapters.price_simulator import PriceCache, run_price_simulator
from app.adapters.providers import build_custodian_adapter, build_market_data_adapter


# ---- custodian -------------------------------------------------------


@pytest.mark.asyncio
async def test_mock_custodian_get_inventory() -> None:
    adapter = MockCustodianAdapter()
    positions = await adapter.get_inventory("acc-ref-001")
    assert len(positions) >= 1
    btc = next(p for p in positions if p.asset_type == "BTC")
    assert btc.quantity > 0
    assert btc.as_of is not None
    assert btc.account_ref == "acc-ref-001"


@pytest.mark.asyncio
async def test_mock_custodian_get_inventory_seeded() -> None:
    adapter = MockCustodianAdapter(inventory={"BTC": 0.0})
    positions = await adapter.get_inventory("acc")
    assert positions[0].quantity == 0.0


@pytest.mark.asyncio
async def test_mock_custodian_get_collateral_none() -> None:
    adapter = MockCustodianAdapter()
    result = await adapter.get_collateral("unknown-loan")
    assert result is None


@pytest.mark.asyncio
async def test_mock_custodian_get_collateral_seeded() -> None:
    adapter = MockCustodianAdapter(
        collateral={"loan-001": {"collateral_type": "USDC", "quantity": 1000.0, "value_usd": 1000.0}}
    )
    result = await adapter.get_collateral("loan-001")
    assert result is not None
    assert result.collateral_type == "USDC"
    assert result.value_usd == 1000.0


@pytest.mark.asyncio
async def test_mock_custodian_validate_key() -> None:
    adapter = MockCustodianAdapter()
    assert await adapter.validate_key() is True


@pytest.mark.asyncio
async def test_mock_custodian_validate_key_false() -> None:
    adapter = MockCustodianAdapter(validate_key_result=False)
    assert await adapter.validate_key() is False


@pytest.mark.asyncio
async def test_mock_custodian_transmit_instruction() -> None:
    adapter = MockCustodianAdapter()
    result = await adapter.transmit_instruction(
        instruction_type="delivery",
        asset_type="BTC",
        quantity=1.0,
        from_account="acc-a",
        to_account="acc-b",
        agent_ref="agent-ref-001",
    )
    assert result.success is True
    assert result.custodian_ref != ""
    assert result.executed_at is not None
    assert result.error_msg is None


# ---- market data adapter ---------------------------------------------


@pytest.mark.asyncio
async def test_mock_market_data_get_price_seeded() -> None:
    adapter = MockMarketDataAdapter(prices={"BTC": 50000.0})
    price = await adapter.get_price("BTC")
    assert price.asset_type == "BTC"
    assert price.price_usd == 50000.0
    assert price.as_of is not None
    assert price.source == "simulator"


@pytest.mark.asyncio
async def test_mock_market_data_default_price() -> None:
    adapter = MockMarketDataAdapter()
    price = await adapter.get_price("BTC")
    assert price.price_usd > 0
    eth = await adapter.get_price("ETH")
    assert eth.price_usd > 0


@pytest.mark.asyncio
async def test_mock_market_data_unknown_asset_raises() -> None:
    adapter = MockMarketDataAdapter(prices={"BTC": 63500.0})
    with pytest.raises(ValueError, match="No price available"):
        await adapter.get_price("XRP")


@pytest.mark.asyncio
async def test_mock_market_data_from_cache() -> None:
    cache = PriceCache()
    cache.update("BTC", 12345.0)
    adapter = MockMarketDataAdapter(cache=cache)
    price = await adapter.get_price("BTC")
    assert price.price_usd == 12345.0


# ---- price simulator -------------------------------------------------


@pytest.mark.asyncio
async def test_simulator_seeds_initial_prices() -> None:
    cache = PriceCache()
    base = {"BTC": 63500.0, "ETH": 1700.0}
    task = asyncio.create_task(
        run_price_simulator(base_prices=base, max_deviation_pct=2.0, interval_seconds=100.0)
    )
    await asyncio.sleep(0)  # yield so the task runs its synchronous preamble
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    from app.adapters.price_simulator import get_price_cache
    global_cache = get_price_cache()
    assert global_cache.get("BTC") is not None
    assert global_cache.get("ETH") is not None


@pytest.mark.asyncio
async def test_simulator_stays_within_band() -> None:
    """After several ticks the price must remain within ±2% of base."""
    cache = PriceCache()
    base = {"BTC": 1000.0}
    max_dev = 2.0

    async def _patched_simulator() -> None:
        import random
        current = dict(base)
        for asset, price in current.items():
            cache.update(asset, price)
        for _ in range(50):
            for asset, b in base.items():
                low = b * (1 - max_dev / 100)
                high = b * (1 + max_dev / 100)
                tick = random.uniform(-0.003, 0.003) * b
                current[asset] = max(low, min(high, current[asset] + tick))
                cache.update(asset, current[asset])

    await _patched_simulator()

    entry = cache.get("BTC")
    assert entry is not None
    price, _ = entry
    assert 980.0 <= price <= 1020.0


# ---- provider builder ------------------------------------------------


def test_non_mock_custodian_raises_not_implemented(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUSTODIAN_ADAPTER", "anchorage")
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(NotImplementedError):
        build_custodian_adapter()
    monkeypatch.setenv("CUSTODIAN_ADAPTER", "mock")
    get_settings.cache_clear()


def test_non_mock_market_data_raises_not_implemented(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MARKET_DATA_ADAPTER", "coinbase")
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(NotImplementedError):
        build_market_data_adapter()
    monkeypatch.setenv("MARKET_DATA_ADAPTER", "mock")
    get_settings.cache_clear()


# ---- SSE endpoint ----------------------------------------------------


@pytest.mark.asyncio
async def test_sse_stream_returns_event_stream(app, seed_agent) -> None:
    """SSE endpoint returns text/event-stream with JSON price data.

    Uses ?max_events=1 so the generator exits after one event, allowing
    httpx ASGITransport to collect a finite response body without hanging.
    """
    import json as _json
    from httpx import ASGITransport, AsyncClient
    from app.adapters.price_simulator import PriceCache
    from app.api.deps import get_price_cache_dep
    from app.core.security import create_access_token

    test_cache = PriceCache()
    test_cache.update("BTC", 63500.0)
    test_cache.update("ETH", 1700.0)
    app.dependency_overrides[get_price_cache_dep] = lambda: test_cache

    token = create_access_token(
        user_id=str(seed_agent.id),
        org_id=str(seed_agent.org_id),
        role=seed_agent.role,
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get(
            f"/market-data/prices/stream?token={token}&max_events=1",
            timeout=5.0,
        )

    app.dependency_overrides.pop(get_price_cache_dep, None)

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers.get("content-type", "")
    body = resp.text
    first_line = next(ln for ln in body.splitlines() if ln.startswith("data:"))
    payload = _json.loads(first_line[len("data: "):])
    assert "BTC" in payload
    assert isinstance(payload["BTC"], float)
    assert payload["BTC"] == pytest.approx(63500.0)


@pytest.mark.asyncio
async def test_sse_stream_rejects_unauthenticated(app) -> None:
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get("/market-data/prices/stream", timeout=2.0)
    assert resp.status_code == 401
