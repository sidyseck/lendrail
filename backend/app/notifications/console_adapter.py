"""Console (local) notification adapter.

Logs a structured line to stdout AND writes one in-app notifications row per recipient.
Swap for a real email adapter (e.g. Resend) by implementing NotificationService Protocol
and setting NOTIFICATION_ADAPTER env var.

Payload must never contain secret material; the redaction log filter is a backstop.
"""
import logging

from app.notifications.interface import NotificationEvent
from app.notifications.repository import NotificationRepository

log = logging.getLogger("lendrail.notifications")


class ConsoleNotificationAdapter:
    """Logs a structured line to stdout AND writes one in-app row per recipient."""

    def __init__(self, repo: NotificationRepository | None = None) -> None:
        self._repo = repo  # None in pure unit tests; injected in app

    async def send(self, event: NotificationEvent) -> None:
        log.info(
            "notification",
            extra={
                "event": event.event,
                "recipients": [str(r) for r in event.recipients],
                "payload": event.payload,
            },
        )
        if self._repo is not None:
            for uid in event.recipients:
                await self._repo.create(user_id=uid, event=event.event, payload=event.payload)
