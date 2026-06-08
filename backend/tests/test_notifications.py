"""F-006: Notification service tests."""
import logging
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.notifications.console_adapter import ConsoleNotificationAdapter
from app.notifications.interface import NotificationEvent
from app.notifications.repository import NotificationRepository


async def _create_user_with_org(session: AsyncSession) -> uuid.UUID:
    """Insert an org + user and return the user_id."""
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
            "VALUES (:id, :name, 'US', 'fund', 'supplier', :email, 'approved')"
        ),
        {"id": str(org_id), "name": f"NotifOrg {org_id}", "email": f"org-{org_id}@example.com"},
    )
    await session.execute(
        text(
            "INSERT INTO users (id, email, hashed_password, role, org_id) "
            "VALUES (:id, :email, 'x', 'supplier', :org_id)"
        ),
        {"id": str(user_id), "email": f"notif-{user_id}@example.com", "org_id": str(org_id)},
    )
    return user_id


@pytest.mark.asyncio
async def test_send_logs_structured_line(caplog: pytest.LogCaptureFixture) -> None:
    """send() must log a structured line with event name and recipients."""
    adapter = ConsoleNotificationAdapter(repo=None)
    uid = uuid.uuid4()
    event = NotificationEvent(event="test", recipients=[uid], payload={"key": "value"})

    with caplog.at_level(logging.INFO, logger="lendrail.notifications"):
        await adapter.send(event)

    assert len(caplog.records) >= 1
    # Verify event and recipient appear in the log record extras
    log_record = caplog.records[-1]
    assert getattr(log_record, "event", None) == "test"
    assert str(uid) in getattr(log_record, "recipients", [])


@pytest.mark.asyncio
async def test_send_writes_notification_rows(db_session: AsyncSession) -> None:
    """send() must write one notifications row per recipient.

    After M2 migration 0006, notifications.user_id has a FK to users.id,
    so we must create real users before sending notifications to them.
    """
    uid1 = await _create_user_with_org(db_session)
    uid2 = await _create_user_with_org(db_session)
    await db_session.flush()

    repo = NotificationRepository(db_session)
    adapter = ConsoleNotificationAdapter(repo=repo)
    event = NotificationEvent(event="loan_booked", recipients=[uid1, uid2])

    await adapter.send(event)

    result = await db_session.execute(select(Notification))
    rows = result.scalars().all()
    user_ids = {r.user_id for r in rows}
    assert uid1 in user_ids
    assert uid2 in user_ids


@pytest.mark.asyncio
async def test_send_no_external_call() -> None:
    """send() with no repo must not raise — pure local operation."""
    adapter = ConsoleNotificationAdapter(repo=None)
    event = NotificationEvent(event="test", recipients=[uuid.uuid4()])
    await adapter.send(event)  # must not raise
