// src/pages/agreements/AgentAgreementView.tsx

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agreement } from '@/types/agreement';
import { getLatestAgreement, confirmAgreement } from '@/api/agreementApi';
import { AgreementReadOnlyCard } from '@/components/agreements/AgreementReadOnlyCard';

interface AgentAgreementViewProps {
  connectionId: string;
}

export function AgentAgreementView({ connectionId }: AgentAgreementViewProps) {
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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

  async function handleConfirm(agreementId: string) {
    setConfirmLoading(true);
    setConfirmError(null);
    try {
      await confirmAgreement(agreementId);
      await fetchAgreement();
    } catch (err: unknown) {
      if (err instanceof Error) {
        const codeErr = err as Error & { code?: string };
        if (codeErr.code === 'already_confirmed') {
          setConfirmError('You have already confirmed this agreement');
        } else if (codeErr.code === 'agreement_superseded') {
          setConfirmError(
            'This agreement has been superseded by a newer version. Please review the latest agreement.',
          );
        } else {
          setConfirmError(err.message);
        }
      } else {
        setConfirmError('An unexpected error occurred.');
      }
    } finally {
      setConfirmLoading(false);
    }
  }

  if (error) {
    return <p role="alert" className="text-sm text-red-600">{error}</p>;
  }

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading agreement…</p>;
  }

  if (agreement === null) {
    return (
      <div>
        <p className="text-sm text-gray-500 mb-4">No agreement yet.</p>
        <Link
          to={`/dashboard/connections/${connectionId}/agreement/new`}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 inline-block"
        >
          Enter Agreement Terms
        </Link>
      </div>
    );
  }

  const showConfirmButton =
    agreement.status === 'pending_confirmation' &&
    agreement.confirmed_by_agent_at === null;

  return (
    <div>
      <AgreementReadOnlyCard agreement={agreement} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          to={`/dashboard/connections/${connectionId}/agreement/new`}
          className="px-4 py-2 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 inline-block"
        >
          Amend Terms
        </Link>

        {showConfirmButton && (
          <div>
            <button
              onClick={() => void handleConfirm(agreement.agreement_id)}
              disabled={confirmLoading}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {confirmLoading ? 'Confirming…' : 'Confirm'}
            </button>
            {confirmError && (
              <p role="alert" className="text-sm text-red-600 mt-1">
                {confirmError}
              </p>
            )}
          </div>
        )}
      </div>

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
