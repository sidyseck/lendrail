"""FastAPI application factory."""
from fastapi import FastAPI

from app.api.routers import auth, health, orgs, borrowers, connections, agreements
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
    app.include_router(agreements.router)

    @app.on_event("startup")
    async def on_startup() -> None:
        log.info("LendRail API starting up")

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        log.info("LendRail API shutting down")

    return app


app = create_app()
