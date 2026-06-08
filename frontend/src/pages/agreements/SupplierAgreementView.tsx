// src/pages/agreements/SupplierAgreementView.tsx

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agreement } from '@/types/agreement';
import { getLatestAgreement } from '@/api/agreementApi';
import { AgreementConfirmBanner } from '@/components/agreements/AgreementConfirmBanner';
import { AgreementReadOnlyCard } from '@/components/agreements/AgreementReadOnlyCard';

interface SupplierAgreementViewProps {
  connectionId: string;
}

export function SupplierAgreementView({ connectionId }: SupplierAgreementViewProps) {
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgreement = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getLatestAgreement(connectionId);
      setAgreement(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load agreement.');
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void fetchAgreement();
  }, [fetchAgreement]);

  if (error) {
    return <p role="alert" className="text-sm text-red-600">{error}</p>;
  }

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading agreement…</p>;
  }

  return (
    <div>
      {agreement === null ? (
        <div>
          <p className="text-sm text-gray-500 mb-4">No agreement submitted yet.</p>
        </div>
      ) : (
        <div>
          {agreement.status === 'pending_confirmation' &&
            agreement.confirmed_by_supplier_at === null && (
              <AgreementConfirmBanner
                agreementId={agreement.agreement_id}
                onConfirmed={() => void fetchAgreement()}
              />
            )}

          {agreement.status === 'pending_confirmation' &&
            agreement.confirmed_by_supplier_at !== null && (
              <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Awaiting agent confirmation.
              </div>
            )}

          <AgreementReadOnlyCard agreement={agreement} />
        </div>
      )}

      <div className="mt-4">
        <Link
          to={`/dashboard/connections/${connectionId}/agreement/history`}
          className="text-sm text-blue-600 hover:underline"
        >
          View History
        </Link>
      </div>
    </div>
  );
}
