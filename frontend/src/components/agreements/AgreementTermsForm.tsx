// src/components/agreements/AgreementTermsForm.tsx

import React, { useState } from 'react';
import type { AgreementTermsFormState, AgreementTermsField } from '@/types/agreementForm';
import {
  validateAssetsInScope,
  validateEligibleCollateral,
  validateLtvPct,
  validateMarginCallLtv,
  validatePositiveInt,
  validateDayCountBasis,
} from '@/lib/agreementValidators';

export interface AgreementTermsFormProps {
  initialValues?: Partial<AgreementTermsFormState>;
  onSubmit: (values: AgreementTermsFormState) => Promise<void>;
  isSubmitting: boolean;
  submitError: string | null;
}

const EMPTY_STATE: AgreementTermsFormState = {
  assets_in_scope: '',
  eligible_collateral: '',
  initial_ltv_pct: '',
  margin_call_ltv_pct: '',
  recall_notice_days: '',
  max_loan_days: '',
  day_count_basis: '',
  agent_fee_bps: '',
};

export function AgreementTermsForm({
  initialValues,
  onSubmit,
  isSubmitting,
  submitError,
}: AgreementTermsFormProps) {
  const [values, setValues] = useState<AgreementTermsFormState>({
    ...EMPTY_STATE,
    ...initialValues,
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AgreementTermsField, string>>>({});

  function setField<K extends AgreementTermsField>(field: K, value: AgreementTermsFormState[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function validate(): Partial<Record<AgreementTermsField, string>> {
    const errors: Partial<Record<AgreementTermsField, string>> = {};

    const assetsErr = validateAssetsInScope(values.assets_in_scope);
    if (assetsErr) errors.assets_in_scope = assetsErr;

    const collateralErr = validateEligibleCollateral(values.eligible_collateral);
    if (collateralErr) errors.eligible_collateral = collateralErr;

    const initialLtvErr = validateLtvPct(values.initial_ltv_pct, 'Initial LTV %');
    if (initialLtvErr) errors.initial_ltv_pct = initialLtvErr;

    const marginLtvErr = validateLtvPct(values.margin_call_ltv_pct, 'Margin Call LTV %');
    if (marginLtvErr) {
      errors.margin_call_ltv_pct = marginLtvErr;
    } else {
      // Cross-field validation only when individual field is valid
      const crossErr = validateMarginCallLtv(values.margin_call_ltv_pct, values.initial_ltv_pct);
      if (crossErr) errors.margin_call_ltv_pct = crossErr;
    }

    const recallErr = validatePositiveInt(values.recall_notice_days, 'Recall Notice (days)', 1);
    if (recallErr) errors.recall_notice_days = recallErr;

    const maxLoanErr = validatePositiveInt(values.max_loan_days, 'Max Loan Days', 1);
    if (maxLoanErr) errors.max_loan_days = maxLoanErr;

    const dayCountErr = validateDayCountBasis(values.day_count_basis);
    if (dayCountErr) errors.day_count_basis = dayCountErr;

    const feeErr = validatePositiveInt(values.agent_fee_bps, 'Agent Fee (bps)', 0, 10000);
    if (feeErr) errors.agent_fee_bps = feeErr;

    return errors;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    await onSubmit(values);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate>
      {/* Assets in Scope */}
      <div className="mb-4">
        <label htmlFor="assets_in_scope" className="block text-sm font-medium text-gray-700 mb-1">
          Assets in Scope (comma-separated)
        </label>
        <input
          id="assets_in_scope"
          type="text"
          value={values.assets_in_scope}
          onChange={(e) => setField('assets_in_scope', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          placeholder="BTC, ETH"
        />
        {fieldErrors.assets_in_scope && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.assets_in_scope}
          </p>
        )}
      </div>

      {/* Eligible Collateral */}
      <div className="mb-4">
        <label
          htmlFor="eligible_collateral"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Eligible Collateral (comma-separated)
        </label>
        <input
          id="eligible_collateral"
          type="text"
          value={values.eligible_collateral}
          onChange={(e) => setField('eligible_collateral', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          placeholder="USDC, USDT"
        />
        {fieldErrors.eligible_collateral && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.eligible_collateral}
          </p>
        )}
      </div>

      {/* Initial LTV % */}
      <div className="mb-4">
        <label
          htmlFor="initial_ltv_pct"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Initial LTV %
        </label>
        <input
          id="initial_ltv_pct"
          type="number"
          min="0.0001"
          max="99.9999"
          step="0.0001"
          value={values.initial_ltv_pct}
          onChange={(e) => setField('initial_ltv_pct', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {fieldErrors.initial_ltv_pct && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.initial_ltv_pct}
          </p>
        )}
      </div>

      {/* Margin Call LTV % */}
      <div className="mb-4">
        <label
          htmlFor="margin_call_ltv_pct"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Margin Call LTV %
        </label>
        <input
          id="margin_call_ltv_pct"
          type="number"
          min="0.0001"
          max="99.9999"
          step="0.0001"
          value={values.margin_call_ltv_pct}
          onChange={(e) => setField('margin_call_ltv_pct', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {fieldErrors.margin_call_ltv_pct && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.margin_call_ltv_pct}
          </p>
        )}
      </div>

      {/* Recall Notice Days */}
      <div className="mb-4">
        <label
          htmlFor="recall_notice_days"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Recall Notice (days)
        </label>
        <input
          id="recall_notice_days"
          type="number"
          min="1"
          step="1"
          value={values.recall_notice_days}
          onChange={(e) => setField('recall_notice_days', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {fieldErrors.recall_notice_days && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.recall_notice_days}
          </p>
        )}
      </div>

      {/* Max Loan Days */}
      <div className="mb-4">
        <label
          htmlFor="max_loan_days"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Max Loan Days
        </label>
        <input
          id="max_loan_days"
          type="number"
          min="1"
          step="1"
          value={values.max_loan_days}
          onChange={(e) => setField('max_loan_days', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {fieldErrors.max_loan_days && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.max_loan_days}
          </p>
        )}
      </div>

      {/* Day Count Basis */}
      <div className="mb-4">
        <label
          htmlFor="day_count_basis"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Day Count Basis
        </label>
        <select
          id="day_count_basis"
          value={values.day_count_basis}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'actual_360' || v === 'actual_365' || v === '') {
              setField('day_count_basis', v);
            }
          }}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
        >
          <option value="">Select…</option>
          <option value="actual_360">Actual/360</option>
          <option value="actual_365">Actual/365</option>
        </select>
        {fieldErrors.day_count_basis && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.day_count_basis}
          </p>
        )}
      </div>

      {/* Agent Fee bps */}
      <div className="mb-6">
        <label
          htmlFor="agent_fee_bps"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Agent Fee (bps)
        </label>
        <input
          id="agent_fee_bps"
          type="number"
          min="0"
          max="10000"
          step="1"
          value={values.agent_fee_bps}
          onChange={(e) => setField('agent_fee_bps', e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {fieldErrors.agent_fee_bps && (
          <p role="alert" className="text-sm text-red-600 mt-1">
            {fieldErrors.agent_fee_bps}
          </p>
        )}
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-red-600 mb-4">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}
