"""F-003: Async session factory + repository base tests."""
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.core.security import hash_password
from app.models.user import User
from app.services.auth_service import UserRepository


@pytest.mark.asyncio
async def test_create_and_read_back(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    user_id = uuid.uuid4()
    created = await repo.create(
        id=user_id,
        email=f"repo-test-{user_id}@example.com",
        hashed_password=hash_password("pw"),
        role="supplier",
    )
    assert created.id == user_id

    fetched = await repo.get(user_id)
    assert fetched.email == created.email
    assert fetched.role == "supplier"


@pytest.mark.asyncio
async def test_get_missing_raises_notfound(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    with pytest.raises(NotFoundError):
        await repo.get(uuid.uuid4())


@pytest.mark.asyncio
async def test_update(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    user_id = uuid.uuid4()
    user = await repo.create(
        id=user_id,
        email=f"update-test-{user_id}@example.com",
        hashed_password=hash_password("pw"),
        role="supplier",
    )
    updated = await repo.update(user, role="agent")
    assert updated.role == "agent"


@pytest.mark.asyncio
async def test_delete(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    user_id = uuid.uuid4()
    user = await repo.create(
        id=user_id,
        email=f"delete-test-{user_id}@example.com",
        hashed_password=hash_password("pw"),
        role="supplier",
    )
    await repo.delete(user)
    with pytest.raises(NotFoundError):
        await repo.get(user_id)


@pytest.mark.asyncio
async def test_list_where(db_session: AsyncSession) -> None:
    repo = UserRepository(db_session)
    uid = uuid.uuid4()
    await repo.create(
        id=uid,
        email=f"list-test-{uid}@example.com",
        hashed_password=hash_password("pw"),
        role="agent",
    )
    results = await repo.list_where(User.role == "agent")
    assert any(u.id == uid for u in results)
