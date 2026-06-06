"""Mock market data adapter returning a fixed BTC price."""
from datetime import datetime, timezone

from app.adapters.interfaces import AssetPrice
from app.core.config import get_settings


class MockMarketDataAdapter:
    def __init__(self, price_usd: float | None = None) -> None:
        self._price = price_usd if price_usd is not None else get_settings().mock_btc_price_usd

    async def get_price(self, asset_type: str) -> AssetPrice:
        return AssetPrice(
            asset_type=asset_type,
            price_usd=self._price,
            as_of=datetime.now(timezone.utc),
            source="mock",
        )
