"""Adapter Protocols and DTOs.

All methods are async def — adapter implementations are network-bound and belong
on the event loop. Mock implementations are async accordingly. See spec §10.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass
class InventoryPosition:
    account_ref: str
    asset_type: str  # "BTC"
    quantity: float
    as_of: datetime
    feed_id: str


@dataclass
class CollateralPosition:
    loan_ref: str
    collateral_type: str
    quantity: float
    value_usd: float
    as_of: datetime
    feed_id: str


@dataclass
class InstructionResult:
    success: bool
    custodian_ref: str
    executed_at: datetime
    error_msg: str | None


@dataclass
class AssetPrice:
    asset_type: str
    price_usd: float
    as_of: datetime
    source: str


class CustodianAdapter(Protocol):
    """Read inventory and collateral; transmit agent-initiated settlement instructions."""

    async def get_inventory(self, account_ref: str) -> list[InventoryPosition]: ...

    async def get_collateral(self, loan_ref: str) -> CollateralPosition | None: ...

    async def validate_key(self) -> bool:
        """Test-call to verify the API key is still valid. Called during connection setup."""
        ...

    async def transmit_instruction(
        self,
        instruction_type: str,  # "delivery" | "return"
        asset_type: str,
        quantity: float,
        from_account: str,
        to_account: str,
        agent_ref: str,  # agent-side reference for audit
    ) -> InstructionResult: ...


class MarketDataAdapter(Protocol):
    """Collateral pricing. Separate from custodian feed per PRD open question #2."""

    async def get_price(self, asset_type: str) -> AssetPrice: ...
