// src/types/connection.ts — shared across supplier, agent, and admin pages

export interface Connection {
  connection_id: string;          // UUID
  supplier_id: string;            // UUID
  agent_id: string;               // UUID
  supplier_name: string;
  agent_name: string;
  status: ConnectionStatus;
  created_at: string;             // ISO-8601
  activated_at: string | null;    // ISO-8601 or null
  pending_agreement?: boolean;    // M3: true when a pending agreement awaits supplier confirmation
}

export type ConnectionStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'terminated';

// HTTP 202 response for unknown-agent invite
export interface InviteUnknownAgentResponse {
  message: string;
  agent_email: string;
}

// HTTP 201 response for known-agent invite — same shape as ConnectionResponse
// (connection_id, supplier_id, agent_id, status, custodian_link_present, created_at, activated_at)

export interface TerminateResponse {
  connection_id: string;
  status: 'terminated';
  flagged_loan_ids: string[];
  message: string;
}

export interface InventoryScopeEntrySupplier {
  asset_type: string;
  custodian_balance: string;
  published_quantity: string;
  already_booked: string;
  effective_available: string;
}

export interface InventoryScopeEntryAgent {
  asset_type: string;
  effective_available: string;
}

export interface InventoryScopeSupplierResponse {
  connection_id: string;
  entries: InventoryScopeEntrySupplier[];
}

export interface InventoryScopeAgentResponse {
  connection_id: string;
  entries: InventoryScopeEntryAgent[];
}
