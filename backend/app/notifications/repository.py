from uuid import UUID

from app.db.repository import BaseRepository
from app.models.notification import Notification


class NotificationRepository(BaseRepository[Notification]):
    model = Notification

    async def create_for_user(
        self, user_id: UUID, event: str, payload: dict  # type: ignore[type-arg]
    ) -> Notification:
        return await self.create(user_id=user_id, event=event, payload=payload)
