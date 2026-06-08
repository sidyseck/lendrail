// src/components/agreements/AgreementConfirmBanner.tsx

import { useConnectionAction } from '@/hooks/useConnectionAction';
import { confirmAgreement } from '@/api/agreementApi';
import { AgreementStatusBadge } from './AgreementStatusBadge';

interface AgreementConfirmBannerProps {
  agreementId: string;
  onConfirmed: () => void;
}

/**
 * Maps a 409 error code to a user-facing message.
 * The code is attached to the thrown Error by confirmAgreement().
 * useConnectionAction stores the Error.message in its `error` state,
 * so we pattern-match on the message text for inline-error display.
 */
function mapConfirmErrorMessage(message: string): string {
  if (/already.confirmed/i.test(message)) {
    return 'You have already confirmed this agreement';
  }
  if (/superseded/i.test(message)) {
    return 'This agreement has been superseded by a newer version. Please review the latest agreement.';
  }
  return message;
}

export function AgreementConfirmBanner({
  agreementId,
  onConfirmed,
}: AgreementConfirmBannerProps) {
  const { execute, isLoading, error } = useConnectionAction<void>();

  async function handleConfirm() {
    await execute(async () => {
      await confirmAgreement(agreementId);
      onConfirmed();
    });
  }

  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <AgreementStatusBadge status="pending_confirmation" />
          <span className="text-sm text-amber-800">
            This agreement requires your confirmation.
          </span>
        </div>
        <button
          onClick={() => void handleConfirm()}
          disabled={isLoading}
          className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
        >
          {isLoading ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 mt-2">
          {mapConfirmErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
