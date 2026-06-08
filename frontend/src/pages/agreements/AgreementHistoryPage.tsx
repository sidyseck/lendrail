// src/pages/agreements/AgreementHistoryPage.tsx

import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import type { Agreement } from '@/types/agreement';
import { getAgreementHistory } from '@/api/agreementApi';
import { AgreementHistoryTable } from '@/components/agreements/AgreementHistoryTable';

export function AgreementHistoryPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId) return;

    setIsLoading(true);
    setError(null);
    getAgreementHistory(connectionId)
      .then((data) => {
        setAgreements(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load agreement history.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [connectionId]);

  if (!connectionId) {
    return <Navigate to="/dashboard/connections" replace />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          to={`/dashboard/connections/${connectionId}/agreement`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to Agreement
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Agreement History</h1>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading history…</p>}

      {!isLoading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!isLoading && !error && <AgreementHistoryTable agreements={agreements} />}
    </div>
  );
}
