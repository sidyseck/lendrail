"""F-008: Mock adapter tests."""
import os

import pytest

from app.adapters.mock_custodian import MockCustodianAdapter
from app.adapters.mock_market_data import MockMarketDataAdapter
from app.adapters.providers import build_custodian_adapter, build_market_data_adapter


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


@pytest.mark.asyncio
async def test_mock_market_data_get_price() -> None:
    adapter = MockMarketDataAdapter(price_usd=50000.0)
    price = await adapter.get_price("BTC")
    assert price.asset_type == "BTC"
    assert price.price_usd == 50000.0
    assert price.as_of is not None
    assert price.source == "mock"


@pytest.mark.asyncio
async def test_mock_market_data_default_price() -> None:
    adapter = MockMarketDataAdapter()
    price = await adapter.get_price("BTC")
    assert price.price_usd > 0


def test_non_mock_custodian_raises_not_implemented(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CUSTODIAN_ADAPTER", "anchorage")
    # Clear the lru_cache so the new env var takes effect
    from app.core.config import get_settings
    get_settings.cache_clear()
    with pytest.raises(NotImplementedError):
        build_custodian_adapter()
    # Restore
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
