from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

# Engine is created lazily on first use to avoid binding to the wrong event loop
# at module import time. This matters for tests (pytest-asyncio) and worker startup.
_engine: AsyncEngine | None = None
_factory: async_sessionmaker | None = None  # type: ignore[type-arg]


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        s = get_settings()
        _engine = create_async_engine(s.database_url, echo=s.db_echo, pool_pre_ping=True)
    return _engine


def get_factory() -> async_sessionmaker:  # type: ignore[type-arg]
    global _factory
    if _factory is None:
        _factory = async_sessionmaker(get_engine(), expire_on_commit=False, class_=AsyncSession)
    return _factory


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    factory = get_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
