from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.local", extra="ignore")

    # --- Database ---
    database_url: str = Field(...)  # postgresql+asyncpg://...
    db_echo: bool = False

    # --- Redis / ARQ ---
    redis_url: str = Field(...)  # redis://redis:6379

    # --- Auth / JWT ---
    jwt_secret: str = Field(...)
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60

    # --- Secret store ---
    secret_store: Literal["env"] = "env"
    secret_store_key: str | None = None  # falls back to jwt_secret-derived key

    # --- Adapter selection ---
    custodian_adapter: str = "mock"
    market_data_adapter: str = "mock"
    mock_btc_base_price_usd: float = 63_500.0
    mock_eth_base_price_usd: float = 1_700.0
    price_max_deviation_pct: float = 2.0
    price_update_interval_seconds: float = 1.0

    # --- Notifications ---
    notification_adapter: Literal["console"] = "console"

    # --- Worker ---
    health_check_interval_seconds: int = 60

    # --- App ---
    environment: Literal["local", "test", "prod"] = "local"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
