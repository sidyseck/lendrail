"""M3 agreement tests — F-028 through F-031."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.security import create_access_token
from app.schemas.auth import AuthUser

# ── Helpers ────────────────────────────────────────────────────────────────────

_VALID_TERMS = {
    "assets_in_scope": ["AAPL", "MSFT"],
    "eligible_collateral": ["CASH_USD"],
    "initial_ltv_pct": "70.0000",
    "margin_call_ltv_pct": "80.0000",
    "liquidation_ltv_pct": "90.0000",
    "recall_notice_days": 3,
    "max_loan_days": 30,
    "day_count_basis": "actual_360",
    "agent_fee_bps": 50,
}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_supplier(client: AsyncClient) -> dict:
    uid = uuid.uuid4().hex[:8]
    resp = await client.post(
        "/orgs/register/supplier",
        json={
            "name": f"Supplier {uid}",
            "jurisdiction": "Delaware, USA",
            "entity_type": "fund",
            "contact_email": f"supplier-{uid}@example.com",
            "password": "Str0ngP@ssword!1",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _register_agent(client: AsyncClient) -> dict:
    uid = uuid.uuid4().hex[:8]
    resp = await client.post(
        "/orgs/register/agent",
        json={
            "name": f"Agent {uid}",
            "jurisdiction": "Delaware, USA",
            "entity_type": "fund",
            "contact_email": f"agent-{uid}@example.com",
            "password": "Str0ngP@ssword!2",
            "ops_contact_email": f"ops-{uid}@example.com",
            "regulatory_status_attested": True,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def supplier_data(client: AsyncClient) -> dict:
    data = await _register_supplier(client)
    token = data["access_token"]
    return {"token": token, "org_id": data["org_id"], "headers": _headers(token)}


@pytest_asyncio.fixture
async def agent_data(client: AsyncClient) -> dict:
    data = await _register_agent(client)
    token = data["access_token"]
    return {"token": token, "org_id": data["org_id"], "headers": _headers(token)}


@pytest_asyncio.fixture
async def active_connection(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> dict:
    """Full invite → accept → register-key flow; returns active connection dict."""
    # Invite
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 201, resp.text
    conn_id = resp.json()["connection_id"]

    # Accept
    resp = await client.post(
        f"/connections/{conn_id}/accept",
        headers=agent_data["headers"],
    )
    assert resp.status_code == 200, resp.text

    # Register key → active
    resp = await client.post(
        f"/connections/{conn_id}/custodian-key",
        json={"custodian_id": "mock", "account_ref": "acct-001", "plaintext_key": "test-key"},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 200, resp.text

    return {
        "connection_id": conn_id,
        "supplier": supplier_data,
        "agent": agent_data,
    }


@pytest_asyncio.fixture
async def agreement_pending(client: AsyncClient, active_connection: dict) -> dict:
    """Create an unconfirmed agreement; returns API response dict."""
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=_VALID_TERMS,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    return {**resp.json(), "connection": active_connection}


@pytest_asyncio.fixture
async def agreement_dual_confirmed(client: AsyncClient, agreement_pending: dict) -> dict:
    """Both parties confirm the pending agreement; returns last confirm response dict."""
    agr_id = agreement_pending["agreement_id"]
    # Supplier confirms
    r1 = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["supplier"]["headers"],
    )
    assert r1.status_code == 200, r1.text
    # Agent confirms
    r2 = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["agent"]["headers"],
    )
    assert r2.status_code == 200, r2.text
    return {**r2.json(), "connection": agreement_pending["connection"]}


# ── Unit tests (service layer) ─────────────────────────────────────────────────

class TestAgreementSchema:
    def test_create_agreement_margin_call_must_exceed_initial(self):
        from pydantic import ValidationError as PydanticValidationError
        from app.schemas.agreements import AgreementTermsRequest
        with pytest.raises(PydanticValidationError):
            AgreementTermsRequest(
                assets_in_scope=["AAPL"],
                eligible_collateral=["CASH"],
                initial_ltv_pct=Decimal("80"),
                margin_call_ltv_pct=Decimal("50"),
                liquidation_ltv_pct=Decimal("90"),
                recall_notice_days=3,
                max_loan_days=30,
                day_count_basis="actual_360",
                agent_fee_bps=50,
            )

    def test_create_agreement_margin_call_equal_to_initial_fails(self):
        from pydantic import ValidationError as PydanticValidationError
        from app.schemas.agreements import AgreementTermsRequest
        with pytest.raises(PydanticValidationError):
            AgreementTermsRequest(
                assets_in_scope=["AAPL"],
                eligible_collateral=["CASH"],
                initial_ltv_pct=Decimal("70"),
                margin_call_ltv_pct=Decimal("70"),
                liquidation_ltv_pct=Decimal("90"),
                recall_notice_days=3,
                max_loan_days=30,
                day_count_basis="actual_360",
                agent_fee_bps=50,
            )

    def test_create_agreement_initial_ltv_zero_422(self):
        from pydantic import ValidationError as PydanticValidationError
        from app.schemas.agreements import AgreementTermsRequest
        with pytest.raises(PydanticValidationError):
            AgreementTermsRequest(
                assets_in_scope=["AAPL"],
                eligible_collateral=["CASH"],
                initial_ltv_pct=Decimal("0"),
                margin_call_ltv_pct=Decimal("10"),
                liquidation_ltv_pct=Decimal("90"),
                recall_notice_days=3,
                max_loan_days=30,
                day_count_basis="actual_360",
                agent_fee_bps=50,
            )

    def test_create_agreement_initial_ltv_100_422(self):
        from pydantic import ValidationError as PydanticValidationError
        from app.schemas.agreements import AgreementTermsRequest
        with pytest.raises(PydanticValidationError):
            AgreementTermsRequest(
                assets_in_scope=["AAPL"],
                eligible_collateral=["CASH"],
                initial_ltv_pct=Decimal("100"),
                margin_call_ltv_pct=Decimal("110"),
                liquidation_ltv_pct=Decimal("120"),
                recall_notice_days=3,
                max_loan_days=30,
                day_count_basis="actual_360",
                agent_fee_bps=50,
            )

    def test_valid_terms_ok(self):
        from app.schemas.agreements import AgreementTermsRequest
        req = AgreementTermsRequest(
            assets_in_scope=["AAPL"],
            eligible_collateral=["CASH"],
            initial_ltv_pct=Decimal("70"),
            margin_call_ltv_pct=Decimal("80"),
            liquidation_ltv_pct=Decimal("90"),
            recall_notice_days=3,
            max_loan_days=30,
            day_count_basis="actual_365",
            agent_fee_bps=100,
        )
        assert req.initial_ltv_pct == Decimal("70")


class TestAgreementServiceUnit:
    """Service layer unit tests — no HTTP, mock repos."""

    def _make_mock_agreement(self, **kwargs):
        from app.models.lending_agreement import LendingAgreement
        a = MagicMock(spec=LendingAgreement)
        a.id = kwargs.get("id", uuid.uuid4())
        a.connection_id = kwargs.get("connection_id", uuid.uuid4())
        a.version = kwargs.get("version", 1)
        a.assets_in_scope = kwargs.get("assets_in_scope", ["AAPL"])
        a.eligible_collateral = kwargs.get("eligible_collateral", ["CASH"])
        a.initial_ltv_pct = kwargs.get("initial_ltv_pct", Decimal("70.0000"))
        a.margin_call_ltv_pct = kwargs.get("margin_call_ltv_pct", Decimal("80.0000"))
        a.liquidation_ltv_pct = kwargs.get("liquidation_ltv_pct", Decimal("90.0000"))
        a.recall_notice_days = kwargs.get("recall_notice_days", 3)
        a.max_loan_days = kwargs.get("max_loan_days", 30)
        a.day_count_basis = kwargs.get("day_count_basis", "actual_360")
        a.agent_fee_bps = kwargs.get("agent_fee_bps", 50)
        a.confirmed_by_supplier_at = kwargs.get("confirmed_by_supplier_at", None)
        a.confirmed_by_agent_at = kwargs.get("confirmed_by_agent_at", None)
        a.created_at = kwargs.get("created_at", datetime.now(timezone.utc))
        is_active_val = (
            a.confirmed_by_supplier_at is not None
            and a.confirmed_by_agent_at is not None
        )
        type(a).is_active = property(lambda self: is_active_val)
        return a

    def _make_mock_connection(self, supplier_id=None, agent_id=None, status="active"):
        c = MagicMock()
        c.id = uuid.uuid4()
        c.supplier_id = supplier_id or uuid.uuid4()
        c.agent_id = agent_id or uuid.uuid4()
        c.status = status
        return c

    def _make_service(self, agreements_mock, connections_mock, users_mock=None):
        from app.services.agreement_service import AgreementService
        notifier = MagicMock()
        notifier.send = AsyncMock()
        users = users_mock or MagicMock()
        users.list_where = AsyncMock(return_value=[])
        return AgreementService(
            agreements=agreements_mock,
            connections=connections_mock,
            users=users,
            notifier=notifier,
        )

    @pytest.mark.asyncio
    async def test_create_agreement_version_starts_at_1(self):
        conn_id = uuid.uuid4()
        agent_org = uuid.uuid4()
        connection = self._make_mock_connection(agent_id=agent_org)
        connection.id = conn_id
        connection.status = "active"

        agreements = MagicMock()
        agreements.get_latest_for_connection = AsyncMock(return_value=None)

        created = self._make_mock_agreement(connection_id=conn_id, version=1)
        agreements.create = AsyncMock(return_value=created)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=agent_org, role="agent")

        from app.services.agreement_service import AgreementTermsInput
        data = AgreementTermsInput(
            assets_in_scope=["AAPL"],
            eligible_collateral=["CASH"],
            initial_ltv_pct=Decimal("70"),
            margin_call_ltv_pct=Decimal("80"),
            liquidation_ltv_pct=Decimal("90"),
            recall_notice_days=3,
            max_loan_days=30,
            day_count_basis="actual_360",
            agent_fee_bps=50,
        )
        result = await svc.create_agreement(caller, conn_id, data)
        assert result.version == 1

    @pytest.mark.asyncio
    async def test_create_agreement_version_increments(self):
        conn_id = uuid.uuid4()
        agent_org = uuid.uuid4()
        connection = self._make_mock_connection(agent_id=agent_org)
        connection.id = conn_id
        connection.status = "active"

        # Existing active v1
        existing = self._make_mock_agreement(
            connection_id=conn_id,
            version=1,
            confirmed_by_supplier_at=datetime.now(timezone.utc),
            confirmed_by_agent_at=datetime.now(timezone.utc),
        )
        type(existing).is_active = property(lambda self: True)

        agreements = MagicMock()
        agreements.get_latest_for_connection = AsyncMock(return_value=existing)

        created = self._make_mock_agreement(connection_id=conn_id, version=2)
        agreements.create = AsyncMock(return_value=created)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=agent_org, role="agent")

        from app.services.agreement_service import AgreementTermsInput
        data = AgreementTermsInput(
            assets_in_scope=["AAPL"],
            eligible_collateral=["CASH"],
            initial_ltv_pct=Decimal("70"),
            margin_call_ltv_pct=Decimal("80"),
            liquidation_ltv_pct=Decimal("90"),
            recall_notice_days=3,
            max_loan_days=30,
            day_count_basis="actual_360",
            agent_fee_bps=50,
        )
        result = await svc.create_agreement(caller, conn_id, data)
        assert result.version == 2

    @pytest.mark.asyncio
    async def test_confirm_supplier_sets_timestamp(self):
        conn_id = uuid.uuid4()
        supplier_org = uuid.uuid4()
        agent_org = uuid.uuid4()
        connection = self._make_mock_connection(
            supplier_id=supplier_org, agent_id=agent_org
        )

        agr_id = uuid.uuid4()
        agreement = self._make_mock_agreement(
            id=agr_id, connection_id=conn_id, version=1
        )
        type(agreement).is_active = property(lambda self: False)

        updated = self._make_mock_agreement(
            id=agr_id,
            connection_id=conn_id,
            version=1,
            confirmed_by_supplier_at=datetime.now(timezone.utc),
        )
        type(updated).is_active = property(lambda self: False)

        agreements = MagicMock()
        agreements.get = AsyncMock(return_value=agreement)
        agreements.get_latest_for_connection = AsyncMock(return_value=agreement)
        agreements.update = AsyncMock(return_value=updated)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=supplier_org, role="supplier")
        result = await svc.confirm_agreement(caller, agr_id)
        assert result.confirmed_by_supplier_at is not None

    @pytest.mark.asyncio
    async def test_confirm_agent_sets_timestamp(self):
        conn_id = uuid.uuid4()
        supplier_org = uuid.uuid4()
        agent_org = uuid.uuid4()
        connection = self._make_mock_connection(
            supplier_id=supplier_org, agent_id=agent_org
        )

        agr_id = uuid.uuid4()
        agreement = self._make_mock_agreement(
            id=agr_id, connection_id=conn_id, version=1
        )
        type(agreement).is_active = property(lambda self: False)

        updated = self._make_mock_agreement(
            id=agr_id,
            connection_id=conn_id,
            version=1,
            confirmed_by_agent_at=datetime.now(timezone.utc),
        )
        type(updated).is_active = property(lambda self: False)

        agreements = MagicMock()
        agreements.get = AsyncMock(return_value=agreement)
        agreements.get_latest_for_connection = AsyncMock(return_value=agreement)
        agreements.update = AsyncMock(return_value=updated)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=agent_org, role="agent")
        result = await svc.confirm_agreement(caller, agr_id)
        assert result.confirmed_by_agent_at is not None

    @pytest.mark.asyncio
    async def test_confirm_twice_same_party_raises_conflict(self):
        from app.core.errors import ConflictError
        conn_id = uuid.uuid4()
        supplier_org = uuid.uuid4()
        agent_org = uuid.uuid4()
        connection = self._make_mock_connection(
            supplier_id=supplier_org, agent_id=agent_org
        )

        agr_id = uuid.uuid4()
        # Already confirmed by supplier
        agreement = self._make_mock_agreement(
            id=agr_id,
            connection_id=conn_id,
            version=1,
            confirmed_by_supplier_at=datetime.now(timezone.utc),
        )
        type(agreement).is_active = property(lambda self: False)

        agreements = MagicMock()
        agreements.get = AsyncMock(return_value=agreement)
        agreements.get_latest_for_connection = AsyncMock(return_value=agreement)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=supplier_org, role="supplier")
        with pytest.raises(ConflictError) as exc_info:
            await svc.confirm_agreement(caller, agr_id)
        assert exc_info.value.code == "already_confirmed"

    @pytest.mark.asyncio
    async def test_amend_does_not_modify_original(self):
        conn_id = uuid.uuid4()
        agent_org = uuid.uuid4()
        supplier_org = uuid.uuid4()
        connection = self._make_mock_connection(
            supplier_id=supplier_org, agent_id=agent_org
        )

        agr_id = uuid.uuid4()
        old_agreement = self._make_mock_agreement(
            id=agr_id, connection_id=conn_id, version=1
        )
        type(old_agreement).is_active = property(lambda self: True)

        new_agreement = self._make_mock_agreement(
            id=uuid.uuid4(), connection_id=conn_id, version=2
        )
        type(new_agreement).is_active = property(lambda self: False)

        agreements = MagicMock()
        agreements.get = AsyncMock(return_value=old_agreement)
        agreements.get_latest_for_connection = AsyncMock(return_value=old_agreement)
        agreements.create = AsyncMock(return_value=new_agreement)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=agent_org, role="agent")

        from app.services.agreement_service import AgreementTermsInput
        data = AgreementTermsInput(
            assets_in_scope=["AAPL"],
            eligible_collateral=["CASH"],
            initial_ltv_pct=Decimal("70"),
            margin_call_ltv_pct=Decimal("80"),
            liquidation_ltv_pct=Decimal("90"),
            recall_notice_days=3,
            max_loan_days=30,
            day_count_basis="actual_360",
            agent_fee_bps=50,
        )
        result = await svc.amend_agreement(caller, agr_id, data)

        # The old agreement was NOT updated — update should not be called
        agreements.update.assert_not_called()
        assert result.version == 2
        assert result.id != agr_id

    @pytest.mark.asyncio
    async def test_amend_creates_new_version(self):
        conn_id = uuid.uuid4()
        agent_org = uuid.uuid4()
        supplier_org = uuid.uuid4()
        connection = self._make_mock_connection(
            supplier_id=supplier_org, agent_id=agent_org
        )

        agr_id = uuid.uuid4()
        old_agreement = self._make_mock_agreement(
            id=agr_id, connection_id=conn_id, version=1
        )
        type(old_agreement).is_active = property(lambda self: True)

        new_id = uuid.uuid4()
        new_agreement = self._make_mock_agreement(
            id=new_id, connection_id=conn_id, version=2
        )
        type(new_agreement).is_active = property(lambda self: False)

        agreements = MagicMock()
        agreements.get = AsyncMock(return_value=old_agreement)
        agreements.get_latest_for_connection = AsyncMock(return_value=old_agreement)
        agreements.create = AsyncMock(return_value=new_agreement)

        connections = MagicMock()
        connections.get = AsyncMock(return_value=connection)

        svc = self._make_service(agreements, connections)
        caller = AuthUser(user_id=uuid.uuid4(), org_id=agent_org, role="agent")

        from app.services.agreement_service import AgreementTermsInput
        data = AgreementTermsInput(
            assets_in_scope=["GOOG"],
            eligible_collateral=["CASH"],
            initial_ltv_pct=Decimal("60"),
            margin_call_ltv_pct=Decimal("75"),
            liquidation_ltv_pct=Decimal("85"),
            recall_notice_days=5,
            max_loan_days=45,
            day_count_basis="actual_365",
            agent_fee_bps=75,
        )
        result = await svc.amend_agreement(caller, agr_id, data)
        assert result.version == 2
        assert result.confirmed_by_supplier_at is None
        assert result.confirmed_by_agent_at is None

    def test_agreement_is_active_both_confirmed(self):
        from app.models.lending_agreement import LendingAgreement
        a = LendingAgreement()
        a.confirmed_by_supplier_at = None
        a.confirmed_by_agent_at = None
        assert not a.is_active

        a.confirmed_by_supplier_at = datetime.now(timezone.utc)
        assert not a.is_active

        a.confirmed_by_agent_at = datetime.now(timezone.utc)
        assert a.is_active


# ── DB / migration tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_0009_migration_applies(test_engine: AsyncEngine) -> None:
    """lending_agreements table exists; day_count_basis_enum type in pg_type."""
    async with test_engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        assert "lending_agreements" in tables
        result = await conn.execute(
            text("SELECT typname FROM pg_type WHERE typname = 'day_count_basis_enum'")
        )
        assert result.scalar() == "day_count_basis_enum"
        columns = await conn.run_sync(lambda c: inspect(c).get_columns("lending_agreements"))
        assert "liquidation_ltv_pct" in {column["name"] for column in columns}


@pytest.mark.asyncio
async def test_lending_agreement_connection_id_fk(db_session: AsyncSession) -> None:
    """Insert with non-existent connection_id → IntegrityError."""
    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO lending_agreements "
                "(id, connection_id, version, assets_in_scope, eligible_collateral, "
                "initial_ltv_pct, margin_call_ltv_pct, liquidation_ltv_pct, recall_notice_days, max_loan_days, "
                "day_count_basis, agent_fee_bps) "
                "VALUES (:id, :conn_id, 1, '{AAPL}', '{CASH}', 70.0, 80.0, 90.0, 3, 30, 'actual_360', 50)"
            ),
            {"id": str(uuid.uuid4()), "conn_id": str(uuid.uuid4())},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_day_count_basis_enum_constraint(db_session: AsyncSession) -> None:
    """Insert invalid day_count_basis value → exception."""
    # Create orgs + connection first
    sup_id, agt_id, conn_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    for oid, role in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    await db_session.execute(
        text(
            "INSERT INTO connections (id, supplier_id, agent_id, status) "
            "VALUES (:id, :sup, :agt, 'active')"
        ),
        {"id": conn_id, "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()

    with pytest.raises(Exception):
        await db_session.execute(
            text(
                "INSERT INTO lending_agreements "
                "(id, connection_id, version, assets_in_scope, eligible_collateral, "
                "initial_ltv_pct, margin_call_ltv_pct, liquidation_ltv_pct, recall_notice_days, max_loan_days, "
                "day_count_basis, agent_fee_bps) "
                "VALUES (:id, :conn_id, 1, '{AAPL}', '{CASH}', 70.0, 80.0, 90.0, 3, 30, 'invalid_basis', 50)"
            ),
            {"id": str(uuid.uuid4()), "conn_id": conn_id},
        )
        await db_session.flush()


@pytest.mark.asyncio
async def test_lending_agreement_array_columns(db_session: AsyncSession) -> None:
    """assets_in_scope and eligible_collateral survive round-trip as arrays."""
    sup_id, agt_id, conn_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    for oid, role in [(sup_id, "supplier"), (agt_id, "agent")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, jurisdiction, entity_type, role, contact_email, status) "
                "VALUES (:id, :name, 'US', 'fund', :role, :email, 'approved')"
            ),
            {"id": oid, "name": f"Org{oid}", "role": role, "email": f"org-{oid}@example.com"},
        )
    await db_session.execute(
        text(
            "INSERT INTO connections (id, supplier_id, agent_id, status) "
            "VALUES (:id, :sup, :agt, 'active')"
        ),
        {"id": conn_id, "sup": sup_id, "agt": agt_id},
    )
    await db_session.flush()

    agr_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO lending_agreements "
            "(id, connection_id, version, assets_in_scope, eligible_collateral, "
            "initial_ltv_pct, margin_call_ltv_pct, liquidation_ltv_pct, recall_notice_days, max_loan_days, "
            "day_count_basis, agent_fee_bps) "
            "VALUES (:id, :conn_id, 1, ARRAY['AAPL','MSFT'], ARRAY['CASH_USD'], 70.0, 80.0, 90.0, 3, 30, 'actual_360', 50)"
        ),
        {"id": agr_id, "conn_id": conn_id},
    )
    await db_session.flush()

    result = await db_session.execute(
        text("SELECT assets_in_scope, eligible_collateral FROM lending_agreements WHERE id = :id"),
        {"id": agr_id},
    )
    row = result.mappings().one()
    assert list(row["assets_in_scope"]) == ["AAPL", "MSFT"]
    assert list(row["eligible_collateral"]) == ["CASH_USD"]


# ── F-029 — POST /connections/{id}/agreement ──────────────────────────────────

@pytest.mark.asyncio
async def test_create_agreement_201(client: AsyncClient, active_connection: dict) -> None:
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=_VALID_TERMS,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version"] == 1
    assert body["confirmed_by_supplier_at"] is None
    assert body["confirmed_by_agent_at"] is None
    assert body["status"] == "pending_confirmation"
    assert body["day_count_basis"] == "actual_360"
    assert body["liquidation_ltv_pct"] == "90.0000"
    assert "agreement_id" in body


@pytest.mark.asyncio
async def test_create_agreement_supplier_jwt_403(
    client: AsyncClient, active_connection: dict
) -> None:
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=_VALID_TERMS,
        headers=active_connection["supplier"]["headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_create_agreement_wrong_agent_403(
    client: AsyncClient, active_connection: dict
) -> None:
    other_agent = await _register_agent(client)
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=_VALID_TERMS,
        headers=_headers(other_agent["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_create_agreement_missing_field_422(
    client: AsyncClient, active_connection: dict
) -> None:
    bad = dict(_VALID_TERMS)
    del bad["recall_notice_days"]
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=bad,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_agreement_margin_call_lte_initial_422(
    client: AsyncClient, active_connection: dict
) -> None:
    bad = dict(_VALID_TERMS)
    bad["margin_call_ltv_pct"] = "50.0"
    bad["initial_ltv_pct"] = "60.0"
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=bad,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_agreement_liquidation_lte_margin_call_422(
    client: AsyncClient, active_connection: dict
) -> None:
    bad = dict(_VALID_TERMS)
    bad["liquidation_ltv_pct"] = "80.0"
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=bad,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_agreement_initial_ltv_zero_422(
    client: AsyncClient, active_connection: dict
) -> None:
    bad = dict(_VALID_TERMS)
    bad["initial_ltv_pct"] = "0"
    bad["margin_call_ltv_pct"] = "10"
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=bad,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_agreement_initial_ltv_100_422(
    client: AsyncClient, active_connection: dict
) -> None:
    bad = dict(_VALID_TERMS)
    bad["initial_ltv_pct"] = "100"
    bad["margin_call_ltv_pct"] = "110"
    resp = await client.post(
        f"/connections/{active_connection['connection_id']}/agreement",
        json=bad,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_agreement_on_pending_connection_409(
    client: AsyncClient, supplier_data: dict, agent_data: dict
) -> None:
    """Connection in pending status → 409 connection_not_active."""
    # Create a pending (not yet accepted) connection
    resp = await client.post(
        "/connections/invite",
        json={"agent_org_id": agent_data["org_id"]},
        headers=supplier_data["headers"],
    )
    assert resp.status_code == 201
    conn_id = resp.json()["connection_id"]

    resp2 = await client.post(
        f"/connections/{conn_id}/agreement",
        json=_VALID_TERMS,
        headers=agent_data["headers"],
    )
    assert resp2.status_code == 409
    assert resp2.json()["error"]["code"] == "connection_not_active"


@pytest.mark.asyncio
async def test_create_agreement_pending_already_exists_409(
    client: AsyncClient, agreement_pending: dict
) -> None:
    """Second POST when a pending agreement exists → 409 pending_agreement_exists."""
    conn_id = agreement_pending["connection"]["connection_id"]
    resp = await client.post(
        f"/connections/{conn_id}/agreement",
        json=_VALID_TERMS,
        headers=agreement_pending["connection"]["agent"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "pending_agreement_exists"


@pytest.mark.asyncio
async def test_create_agreement_fires_notification(
    client: AsyncClient, active_connection: dict, caplog, db_session: AsyncSession
) -> None:
    import logging
    with caplog.at_level(logging.INFO):
        resp = await client.post(
            f"/connections/{active_connection['connection_id']}/agreement",
            json=_VALID_TERMS,
            headers=active_connection["agent"]["headers"],
        )
    assert resp.status_code == 201
    assert "agreement_pending_supplier_confirmation" in caplog.text
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM notifications "
            "WHERE event = 'agreement_pending_supplier_confirmation'"
        )
    )
    assert result.scalar() >= 1


# ── F-030 — POST /agreements/{id}/confirm ─────────────────────────────────────

@pytest.mark.asyncio
async def test_confirm_by_supplier_200(
    client: AsyncClient, agreement_pending: dict
) -> None:
    agr_id = agreement_pending["agreement_id"]
    resp = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["supplier"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["confirmed_by_supplier_at"] is not None
    # Only supplier confirmed, so still pending
    assert body["status"] == "pending_confirmation"


@pytest.mark.asyncio
async def test_confirm_by_agent_200(
    client: AsyncClient, agreement_pending: dict
) -> None:
    agr_id = agreement_pending["agreement_id"]
    resp = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["agent"]["headers"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["confirmed_by_agent_at"] is not None


@pytest.mark.asyncio
async def test_confirm_both_parties_status_active(
    client: AsyncClient, agreement_pending: dict
) -> None:
    agr_id = agreement_pending["agreement_id"]
    # Supplier confirms
    await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["supplier"]["headers"],
    )
    # Agent confirms
    resp = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["agent"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


@pytest.mark.asyncio
async def test_confirm_supplier_twice_409(
    client: AsyncClient, agreement_pending: dict
) -> None:
    agr_id = agreement_pending["agreement_id"]
    await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["supplier"]["headers"],
    )
    resp = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["supplier"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "already_confirmed"


@pytest.mark.asyncio
async def test_confirm_agent_twice_409(
    client: AsyncClient, agreement_pending: dict
) -> None:
    agr_id = agreement_pending["agreement_id"]
    await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["agent"]["headers"],
    )
    resp = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=agreement_pending["connection"]["agent"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "already_confirmed"


@pytest.mark.asyncio
async def test_confirm_wrong_org_403(
    client: AsyncClient, agreement_pending: dict
) -> None:
    other_supplier = await _register_supplier(client)
    agr_id = agreement_pending["agreement_id"]
    resp = await client.post(
        f"/agreements/{agr_id}/confirm",
        headers=_headers(other_supplier["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_confirm_nonexistent_agreement_404(
    client: AsyncClient, active_connection: dict
) -> None:
    resp = await client.post(
        f"/agreements/{uuid.uuid4()}/confirm",
        headers=active_connection["supplier"]["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_confirm_superseded_version_409(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    """Amend to create v2, then attempt to confirm the already-confirmed v1 (now superseded)."""
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]

    # Amend to create v2
    amend_resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    assert amend_resp.status_code == 201
    v2_id = amend_resp.json()["agreement_id"]
    assert v2_id != v1_id

    # Try to confirm v1 now that v2 exists
    resp = await client.post(
        f"/agreements/{v1_id}/confirm",
        headers=conn["supplier"]["headers"],
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "agreement_superseded"


@pytest.mark.asyncio
async def test_confirm_fires_notification(
    client: AsyncClient, agreement_pending: dict, caplog, db_session: AsyncSession
) -> None:
    import logging
    agr_id = agreement_pending["agreement_id"]
    with caplog.at_level(logging.INFO):
        await client.post(
            f"/agreements/{agr_id}/confirm",
            headers=agreement_pending["connection"]["supplier"]["headers"],
        )
    assert "agreement_confirmed_by_supplier" in caplog.text
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM notifications "
            "WHERE event = 'agreement_confirmed_by_supplier'"
        )
    )
    assert result.scalar() >= 1


# ── F-031a — PUT /agreements/{id} ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_amend_creates_new_version_201(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["version"] == 2
    assert body["agreement_id"] != v1_id


@pytest.mark.asyncio
async def test_amend_resets_confirmation_timestamps(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["confirmed_by_supplier_at"] is None
    assert body["confirmed_by_agent_at"] is None
    assert body["status"] == "pending_confirmation"


@pytest.mark.asyncio
async def test_amend_supplier_jwt_403(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["supplier"]["headers"],
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_amend_wrong_agent_403(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    other_agent = await _register_agent(client)
    v1_id = agreement_dual_confirmed["agreement_id"]
    resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=_headers(other_agent["access_token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_amend_nonexistent_agreement_404(
    client: AsyncClient, active_connection: dict
) -> None:
    resp = await client.put(
        f"/agreements/{uuid.uuid4()}",
        json=_VALID_TERMS,
        headers=active_connection["agent"]["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_amend_stale_version_409(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    """Amend v1 to create v2, then try to amend v1 again → 409 agreement_not_current_version."""
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]

    # First amend: v1 → v2
    resp1 = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    assert resp1.status_code == 201

    # Try to amend v1 again → stale
    resp2 = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    assert resp2.status_code == 409
    assert resp2.json()["error"]["code"] == "agreement_not_current_version"


@pytest.mark.asyncio
async def test_amend_response_contains_new_agreement_id(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["agreement_id"] != v1_id
    assert body["version"] == 2


@pytest.mark.asyncio
async def test_amend_fires_reconfirmation_notification(
    client: AsyncClient,
    agreement_dual_confirmed: dict,
    caplog,
    db_session: AsyncSession,
) -> None:
    import logging
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    with caplog.at_level(logging.INFO):
        await client.put(
            f"/agreements/{v1_id}",
            json=_VALID_TERMS,
            headers=conn["agent"]["headers"],
        )
    assert "agreement_requires_reconfirmation" in caplog.text
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM notifications "
            "WHERE event = 'agreement_requires_reconfirmation'"
        )
    )
    assert result.scalar() >= 1


# ── F-031b — GET /connections/{id}/agreement/history ─────────────────────────

@pytest.mark.asyncio
async def test_history_ordered_by_version_asc(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    """After amend, history shows v1 then v2."""
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    conn_id = conn["connection_id"]

    # Amend to create v2
    await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )

    resp = await client.get(
        f"/connections/{conn_id}/agreement/history",
        headers=conn["supplier"]["headers"],
    )
    assert resp.status_code == 200
    agreements = resp.json()["agreements"]
    assert len(agreements) == 2
    assert agreements[0]["version"] == 1
    assert agreements[1]["version"] == 2


@pytest.mark.asyncio
async def test_history_wrong_org_403(
    client: AsyncClient, active_connection: dict
) -> None:
    other = await _register_supplier(client)
    conn_id = active_connection["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}/agreement/history",
        headers=_headers(other["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_history_empty_returns_empty_list(
    client: AsyncClient, active_connection: dict
) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}/agreement/history",
        headers=active_connection["supplier"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["agreements"] == []


# ── Convenience read — GET /connections/{id}/agreement ────────────────────────

@pytest.mark.asyncio
async def test_get_latest_agreement_returns_newest_version(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    v1_id = agreement_dual_confirmed["agreement_id"]
    conn = agreement_dual_confirmed["connection"]
    conn_id = conn["connection_id"]

    # Amend to create v2
    amend_resp = await client.put(
        f"/agreements/{v1_id}",
        json=_VALID_TERMS,
        headers=conn["agent"]["headers"],
    )
    v2_id = amend_resp.json()["agreement_id"]

    resp = await client.get(
        f"/connections/{conn_id}/agreement",
        headers=conn["supplier"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["agreement_id"] == v2_id
    assert resp.json()["version"] == 2


@pytest.mark.asyncio
async def test_get_latest_agreement_no_agreement_404(
    client: AsyncClient, active_connection: dict
) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}/agreement",
        headers=active_connection["supplier"]["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_agreement_wrong_org_403(
    client: AsyncClient, agreement_pending: dict
) -> None:
    other = await _register_supplier(client)
    conn_id = agreement_pending["connection"]["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}/agreement",
        headers=_headers(other["access_token"]),
    )
    assert resp.status_code == 403


# ── pending_agreement on connection response ───────────────────────────────────

@pytest.mark.asyncio
async def test_connection_pending_agreement_false_initially(
    client: AsyncClient, active_connection: dict
) -> None:
    conn_id = active_connection["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}",
        headers=active_connection["supplier"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["pending_agreement"] is False


@pytest.mark.asyncio
async def test_connection_pending_agreement_true_after_create(
    client: AsyncClient, agreement_pending: dict
) -> None:
    conn_id = agreement_pending["connection"]["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}",
        headers=agreement_pending["connection"]["supplier"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["pending_agreement"] is True


@pytest.mark.asyncio
async def test_connection_pending_agreement_false_after_both_confirm(
    client: AsyncClient, agreement_dual_confirmed: dict
) -> None:
    conn_id = agreement_dual_confirmed["connection"]["connection_id"]
    resp = await client.get(
        f"/connections/{conn_id}",
        headers=agreement_dual_confirmed["connection"]["supplier"]["headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["pending_agreement"] is False


# ── End-to-end lifecycle ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_agreement_lifecycle(
    client: AsyncClient, active_connection: dict
) -> None:
    """create → supplier confirm → agent confirm → verify active →
       amend → verify new version pending → both re-confirm → verify active again"""
    conn_id = active_connection["connection_id"]
    sup_h = active_connection["supplier"]["headers"]
    agt_h = active_connection["agent"]["headers"]

    # 1. Create
    r1 = await client.post(
        f"/connections/{conn_id}/agreement", json=_VALID_TERMS, headers=agt_h
    )
    assert r1.status_code == 201
    v1_id = r1.json()["agreement_id"]
    assert r1.json()["version"] == 1
    assert r1.json()["status"] == "pending_confirmation"

    # 2. Supplier confirms
    r2 = await client.post(f"/agreements/{v1_id}/confirm", headers=sup_h)
    assert r2.status_code == 200
    assert r2.json()["confirmed_by_supplier_at"] is not None
    assert r2.json()["status"] == "pending_confirmation"

    # 3. Agent confirms
    r3 = await client.post(f"/agreements/{v1_id}/confirm", headers=agt_h)
    assert r3.status_code == 200
    assert r3.json()["status"] == "active"

    # 4. Verify via history
    rh = await client.get(f"/connections/{conn_id}/agreement/history", headers=sup_h)
    assert rh.status_code == 200
    assert len(rh.json()["agreements"]) == 1
    assert rh.json()["agreements"][0]["status"] == "active"

    # 5. Amend
    r5 = await client.put(f"/agreements/{v1_id}", json=_VALID_TERMS, headers=agt_h)
    assert r5.status_code == 201
    v2_id = r5.json()["agreement_id"]
    assert v2_id != v1_id
    assert r5.json()["version"] == 2
    assert r5.json()["status"] == "pending_confirmation"

    # 6. Re-confirm both parties
    r6s = await client.post(f"/agreements/{v2_id}/confirm", headers=sup_h)
    assert r6s.status_code == 200
    r6a = await client.post(f"/agreements/{v2_id}/confirm", headers=agt_h)
    assert r6a.status_code == 200
    assert r6a.json()["status"] == "active"

    # 7. History has both versions
    rh2 = await client.get(f"/connections/{conn_id}/agreement/history", headers=agt_h)
    versions = [a["version"] for a in rh2.json()["agreements"]]
    assert versions == [1, 2]

    # 8. Latest returns v2
    rl = await client.get(f"/connections/{conn_id}/agreement", headers=sup_h)
    assert rl.json()["version"] == 2
    assert rl.json()["status"] == "active"
