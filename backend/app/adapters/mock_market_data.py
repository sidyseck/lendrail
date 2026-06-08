"""Mock market data adapter — reads from the shared PriceCache."""
from app.adapters.interfaces import AssetPrice
from app.adapters.price_simulator import PriceCache
from app.core.config import get_settings


class MockMarketDataAdapter:
    def __init__(
        self,
        cache: PriceCache | None = None,
        prices: dict[str, float] | None = None,
    ) -> None:
        """
        cache   — shared PriceCache (production path, fed by the simulator task).
        prices  — seed values (test path; creates an isolated cache not shared with the singleton).
        Neither — creates an isolated cache seeded with config base prices (safe test default).
        """
        if cache is not None:
            self._cache = cache
        elif prices is not None:
            self._cache = PriceCache()
            for asset, price in prices.items():
                self._cache.update(asset, price)
        else:
            settings = get_settings()
            self._cache = PriceCache()
            self._cache.update("BTC", settings.mock_btc_base_price_usd)
            self._cache.update("ETH", settings.mock_eth_base_price_usd)

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
