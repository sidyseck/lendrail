"""Adapter factory functions — env-var switched.

To add a real adapter: implement the Protocol, add a branch here, set the env var.
No domain logic changes required.
"""
from app.adapters.interfaces import CustodianAdapter, MarketDataAdapter
from app.adapters.mock_custodian import MockCustodianAdapter
from app.adapters.mock_market_data import MockMarketDataAdapter
from app.core.config import get_settings


def build_custodian_adapter() -> CustodianAdapter:
    name = get_settings().custodian_adapter
    if name == "mock":
        return MockCustodianAdapter()
    raise NotImplementedError(f"custodian adapter '{name}' not wired yet")


def build_market_data_adapter() -> MarketDataAdapter:
    name = get_settings().market_data_adapter
    if name == "mock":
        return MockMarketDataAdapter()
    raise NotImplementedError(f"market data adapter '{name}' not wired yet")
