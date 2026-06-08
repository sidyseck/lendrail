// src/pages/agreements/AgentAgreementFormPage.tsx

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AgreementTermsFormState } from '@/types/agreementForm';
import type { AgreementTermsRequest } from '@/types/agreement';
import { getLatestAgreement, createAgreement, amendAgreement } from '@/api/agreementApi';
import { AgreementTermsForm } from '@/components/agreements/AgreementTermsForm';

export function AgentAgreementFormPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();

  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<Partial<AgreementTermsFormState>>({});
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isAmend = agreementId !== null;

  // Guard against missing connectionId
  useEffect(() => {
    if (!connectionId) {
      navigate('/dashboard/connections', { replace: true });
    }
  }, [connectionId, navigate]);

  const loadExisting = useCallback(async () => {
    if (!connectionId) return;
    setIsLoadingExisting(true);
    try {
      const existing = await getLatestAgreement(connectionId);
      if (existing !== null) {
        setAgreementId(existing.agreement_id);
        setInitialValues({
          assets_in_scope: existing.assets_in_scope.join(', '),
          eligible_collateral: existing.eligible_collateral.join(', '),
          initial_ltv_pct: existing.initial_ltv_pct,
          margin_call_ltv_pct: existing.margin_call_ltv_pct,
          recall_notice_days: String(existing.recall_notice_days),
          max_loan_days: String(existing.max_loan_days),
          day_count_basis: existing.day_count_basis,
          agent_fee_bps: String(existing.agent_fee_bps),
        });
      }
    } catch {
      // 404 means no existing agreement — create mode; other errors are swallowed gracefully
    } finally {
      setIsLoadingExisting(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  async function handleSubmit(values: AgreementTermsFormState) {
    if (!connectionId) return;

    // Type-narrow day_count_basis from 'actual_360' | 'actual_365' | '' to the required union
    if (values.day_count_basis === '') {
      setSubmitError('Day Count Basis is required');
      return;
    }
    const dayCountBasis: 'actual_360' | 'actual_365' = values.day_count_basis;

    const body: AgreementTermsRequest = {
      assets_in_scope: values.assets_in_scope
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      eligible_collateral: values.eligible_collateral
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      initial_ltv_pct: parseFloat(values.initial_ltv_pct),
      margin_call_ltv_pct: parseFloat(values.margin_call_ltv_pct),
      recall_notice_days: parseInt(values.recall_notice_days, 10),
      max_loan_days: parseInt(values.max_loan_days, 10),
      day_count_basis: dayCountBasis,
      agent_fee_bps: parseInt(values.agent_fee_bps, 10),
    };

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (isAmend && agreementId !== null) {
        await amendAgreement(agreementId, body);
        // Re-fetch to pick up new head agreementId
        await loadExisting();
      } else {
        await createAgreement(connectionId, body);
      }
      navigate(`/dashboard/connections/${connectionId}/agreement`);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!connectionId) return null;

  if (isLoadingExisting) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">
          {isAmend ? 'Amend Agreement Terms' : 'Enter Agreement Terms'}
        </h1>
      </div>

      <AgreementTermsForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        submitError={submitError}
      />

      <div className="mt-4">
        <button
          type="button"
          onClick={() => navigate(`/dashboard/connections/${connectionId}/agreement`)}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
