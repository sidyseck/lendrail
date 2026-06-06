"""F-002: Alembic migration roundtrip test."""
import os
import subprocess
import sys

import pytest
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncEngine

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..")
ALEMBIC_INI = os.path.join(BACKEND_DIR, "alembic.ini")
TEST_DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://lendrail:lendrail@localhost:5432/lendrail_test",
)


def _alembic(*args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = TEST_DATABASE_URL
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", ALEMBIC_INI, *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )


@pytest.mark.asyncio
async def test_upgrade_downgrade_roundtrip(test_engine: AsyncEngine) -> None:
    """alembic upgrade head → downgrade base → upgrade head must all succeed cleanly."""
    # downgrade to base
    _alembic("downgrade", "base")

    # verify tables are gone
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
    assert "users" not in tables
    assert "notifications" not in tables

    # upgrade back to head
    _alembic("upgrade", "head")

    # verify tables exist
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
    assert "users" in tables
    assert "notifications" in tables


@pytest.mark.asyncio
async def test_migration_history_at_least_one(test_engine: AsyncEngine) -> None:
    """Migration history should contain at least one revision."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(ALEMBIC_INI)
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    script = ScriptDirectory.from_config(cfg)
    revisions = list(script.walk_revisions())
    assert len(revisions) >= 1
