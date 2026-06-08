export type LoanState =
  | 'pending'
  | 'active'
  | 'margin_call'
  | 'recall_initiated'
  | 'settled'
  | 'defaulted';

export interface Loan {
  loan_id: string;
  connection_id: string;
  agreement_id: string;
  borrower_id: string;
  borrower_name: string;
  asset_type: string;
  quantity: string;
  rate_bps: number;
  term_type: string;
  maturity_date: string | null;
  day_count_basis: string;
  collateral_type: string;
  collateral_quantity: string;
  collateral_value_usd: string;
  current_ltv_pct: string | null;
  ltv_as_of: string | null;
  state: LoanState;
  booked_at: string;
  activated_at: string | null;
  recall_initiated_at: string | null;
  recall_notice_deadline_at: string | null;
  return_custodian_ref: string | null;
  return_instruction_at: string | null;
  settled_at: string | null;
  defaulted_at: string | null;
}

export interface LoanListResponse {
  loans: Loan[];
}

export interface LoanBookingRequest {
  connection_id: string;
  borrower_id: string;
  asset_type: string;
  quantity: string;
  asset_price_usd: string;
  booking_ltv_pct: string;
  margin_call_ltv_pct: string;
  liquidation_ltv_pct: string;
  rate_bps: number;
  term_type: 'open' | 'fixed';
  maturity_date: string | null;
  collateral_type: string;
  collateral_quantity: string;
  collateral_value_usd: string;
}

export interface LoanCreateResponse {
  loan_id: string;
  state: LoanState;
}

export interface CollateralSubstitutionRequest {
  collateral_type: string;
  collateral_quantity: string;
  collateral_value_usd: string;
}
