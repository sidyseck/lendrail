// F-063: Agent inventory view types

export interface AgentInventoryEntry {
  asset_type: string;
  effective_available: string;
}

export interface AgentConnectionInventoryResponse {
  connection_id: string;
  entries: AgentInventoryEntry[];
}

export interface SupplierBreakdownRow {
  connection_id: string;
  supplier_id: string;
  supplier_name: string;
  asset_type: string;
  effective_available: string;
}

export interface AggregatedAssetRow {
  asset_type: string;
  total_available: string;
}

export interface AllocationNotification {
  notification_id: string;
  event: string;
  connection_id: string;
  read: boolean;
  created_at: string;
  payload: Record<string, unknown>;
}
