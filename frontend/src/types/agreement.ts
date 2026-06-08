// src/types/agreement.ts

export type AgreementStatus = 'pending_confirmation' | 'active';

export interface Agreement {
  agreement_id: string;              // UUID
  connection_id: string;             // UUID
  version: number;
  assets_in_scope: string[];
  eligible_collateral: string[];
  initial_ltv_pct: string;           // Decimal serialized as string
  margin_call_ltv_pct: string;
  liquidation_ltv_pct: string;
  recall_notice_days: number;
  max_loan_days: number;
  day_count_basis: 'actual_360' | 'actual_365';
  agent_fee_bps: number;
  confirmed_by_supplier_at: string | null; // ISO-8601 or null
  confirmed_by_agent_at: string | null;
  status: AgreementStatus;
  created_at: string;
}

export interface AgreementHistoryResponse {
  agreements: Agreement[];
}

export interface AgreementTermsRequest {
  assets_in_scope: string[];
  eligible_collateral: string[];
  initial_ltv_pct: number;
  margin_call_ltv_pct: number;
  liquidation_ltv_pct: number;
  recall_notice_days: number;
  max_loan_days: number;
  day_count_basis: 'actual_360' | 'actual_365';
  agent_fee_bps: number;
}
