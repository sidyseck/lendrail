from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
from uuid import UUID


@dataclass
class NotificationEvent:
    event: str  # e.g. "test", "loan_booked"
    recipients: list[UUID]  # user_ids
    payload: dict = field(default_factory=dict)  # type: ignore[type-arg]
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class NotificationService(Protocol):
    async def send(self, event: NotificationEvent) -> None: ...
