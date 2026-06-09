import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { formatQty, formatUsd } from '@/lib/format';
import type { BookingSummaryProps } from './BookingSummary';

export interface ConfirmBookingPanelProps {
  summary: BookingSummaryProps;
  isBooking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const CASH = 'CASH_USD';

export function ConfirmBookingPanel({ summary, isBooking, onCancel, onConfirm }: ConfirmBookingPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBooking) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isBooking, onCancel]);

  const isCash = summary.collateralType.toUpperCase() === CASH;
  const coverage =
    summary.coverage !== undefined && Number.isFinite(summary.coverage)
      ? `${summary.coverage.toFixed(2)}×`
      : '—';

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-4">
      <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-gray-900 outline-none">
        Confirm booking
      </h3>
      <p className="mt-1 text-sm text-gray-900">
        You are booking a secured loan. This notifies both parties and cannot be undone.
      </p>

      <dl className="mt-3 space-y-1.5 text-sm text-gray-900 tabular-nums">
        <div>
          <span className="font-medium">Lend</span>{' '}
          {summary.quantity && summary.assetType
            ? `${formatQty(summary.quantity)} ${summary.assetType}`
            : '—'}{' '}
          ({formatUsd(summary.loanValueUsd)}) to {summary.borrowerName || '—'}
        </div>
        <div>
          <span className="font-medium">Against</span>{' '}
          {isCash
            ? `${formatUsd(summary.collateralValueUsd)} ${summary.collateralType} collateral`
            : `${formatQty(summary.collateralQuantity)} ${summary.collateralType} · ${formatUsd(summary.collateralValueUsd)}`}{' '}
          · coverage {coverage}
        </div>
        <div>
          <span className="font-medium">Terms</span> Booking LTV{' '}
          {summary.bookingLtv ? `${summary.bookingLtv}%` : '—'} · margin call{' '}
          {summary.marginCallLtv ? `${summary.marginCallLtv}%` : '—'} · liquidation{' '}
          {summary.liquidationLtv ? `${summary.liquidationLtv}%` : '—'}
        </div>
        <div>
          <span className="font-medium">Economics</span>{' '}
          {summary.rateBps ? `${summary.rateBps} bps` : '—'} ·{' '}
          {summary.termType === 'fixed' ? `fixed @ ${summary.maturityDate || '—'}` : 'open term'}
        </div>
        {summary.warning && (
          <p role="status" className="text-amber-700">
            ⚠ Loan terms differ from supplier guidance.
          </p>
        )}
      </dl>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          onClick={onCancel}
          disabled={isBooking}
          className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
        >
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm} disabled={isBooking}>
          {isBooking ? 'Booking…' : 'Confirm & book loan'}
        </Button>
      </div>
    </div>
  );
}
