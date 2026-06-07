from typing import Generic, TypeVar
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.db.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, id_: UUID) -> ModelT:
        obj = await self.session.get(self.model, id_)
        if obj is None:
            raise NotFoundError(f"{self.model.__name__} {id_} not found")
        return obj

    async def get_or_none(self, id_: UUID) -> ModelT | None:
        return await self.session.get(self.model, id_)

    async def create(self, **kwargs: object) -> ModelT:
        obj = self.model(**kwargs)
        self.session.add(obj)
        await self.session.flush()  # populate PK without committing
        return obj

    async def update(self, obj: ModelT, **changes: object) -> ModelT:
        for k, v in changes.items():
            setattr(obj, k, v)
        await self.session.flush()
        return obj

    async def delete(self, obj: ModelT) -> None:
        await self.session.delete(obj)
        await self.session.flush()

    async def list_where(self, *conditions: object) -> list[ModelT]:
        result = await self.session.execute(select(self.model).where(*conditions))
        return list(result.scalars().all())
