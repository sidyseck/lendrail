"""Deterministic mock custodian adapter. State is seedable per test via constructor kwargs."""
from datetime import datetime, timezone

from app.adapters.interfaces import (
    CollateralPosition,
    InstructionResult,
    InventoryPosition,
)


class MockCustodianAdapter:
    """Deterministic mock. State can be seeded per test via constructor kwargs."""

    def __init__(
        self,
        inventory: dict[str, float] | None = None,
        collateral: dict[str, dict] | None = None,
        validate_key_result: bool = True,
        transmit_success: bool = True,
    ) -> None:
        self._inventory = inventory if inventory is not None else {"BTC": 100.0}
        self._collateral = collateral if collateral is not None else {}
        self._validate_key_result = validate_key_result
        self._transmit_success = transmit_success
        self.transmitted_instructions: list[dict] = []

    async def get_inventory(self, account_ref: str) -> list[InventoryPosition]:
        return [
            InventoryPosition(
                account_ref=account_ref,
                asset_type=k,
                quantity=v,
                as_of=datetime.now(timezone.utc),
                feed_id="mock-feed-001",
            )
            for k, v in self._inventory.items()
        ]

    async def get_collateral(self, loan_ref: str) -> CollateralPosition | None:
        data = self._collateral.get(loan_ref)
        if not data:
            return None
        return CollateralPosition(
            loan_ref=loan_ref,
            collateral_type=data["collateral_type"],
            quantity=data["quantity"],
            value_usd=data["value_usd"],
            as_of=datetime.now(timezone.utc),
            feed_id="mock-feed-002",
        )

    async def validate_key(self) -> bool:
        return self._validate_key_result

    async def transmit_instruction(
        self,
        instruction_type: str,
        asset_type: str,
        quantity: float,
        from_account: str,
        to_account: str,
        agent_ref: str,
    ) -> InstructionResult:
        self.transmitted_instructions.append(
            {
                "instruction_type": instruction_type,
                "asset_type": asset_type,
                "quantity": quantity,
                "from_account": from_account,
                "to_account": to_account,
                "agent_ref": agent_ref,
            }
        )
        return InstructionResult(
            success=self._transmit_success,
            custodian_ref=f"mock-conf-{agent_ref}" if self._transmit_success else "",
            executed_at=datetime.now(timezone.utc),
            error_msg=None if self._transmit_success else "mock instruction failure",
        )
