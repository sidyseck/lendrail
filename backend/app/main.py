"""FastAPI application factory."""
import asyncio
import contextlib

from fastapi import FastAPI

from app.api.routers import auth, health, orgs, borrowers, connections, agreements, custodians, loans
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger

log = get_logger("lendrail.main")


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="LendRail API",
        version="0.1.0",
        generate_unique_id_function=lambda r: f"{r.tags[0]}_{r.name}" if r.tags else r.name,
    )
    register_exception_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(orgs.router)
    app.include_router(borrowers.router)
    app.include_router(connections.router)
    app.include_router(custodians.router)
    app.include_router(agreements.router)
    app.include_router(loans.router)

    _simulator_task: asyncio.Task | None = None  # type: ignore[type-arg]

    @app.on_event("startup")
    async def on_startup() -> None:
        nonlocal _simulator_task
        log.info("LendRail API starting up")
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
        log.info("Price simulator started for %s", list(base_prices.keys()))

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        log.info("LendRail API shutting down")
        if _simulator_task is not None:
            _simulator_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await _simulator_task

    return app


app = create_app()
