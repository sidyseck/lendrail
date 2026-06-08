// src/types/agreementForm.ts

export type AgreementTermsField =
  | 'assets_in_scope'
  | 'eligible_collateral'
  | 'initial_ltv_pct'
  | 'margin_call_ltv_pct'
  | 'recall_notice_days'
  | 'max_loan_days'
  | 'day_count_basis'
  | 'agent_fee_bps';

export interface AgreementTermsFormState {
  assets_in_scope: string;       // comma-separated → split to string[] on submit
  eligible_collateral: string;   // comma-separated → split to string[] on submit
  initial_ltv_pct: string;       // numeric string
  margin_call_ltv_pct: string;   // numeric string
  recall_notice_days: string;    // numeric string
  max_loan_days: string;         // numeric string
  day_count_basis: 'actual_360' | 'actual_365' | '';
  agent_fee_bps: string;         // numeric string
}
