import { formatQty, formatUsd } from '@/lib/format';

export interface BookingSummaryProps {
  borrowerName?: string;
  supplierName?: string;
  assetType?: string;
  quantity?: string;
  loanValueUsd?: number;
  collateralType: string;
  collateralQuantity?: string;
  collateralValueUsd?: number;
  coverage?: number;
  bookingLtv?: string;
  impliedLtv?: number;
  marginCallLtv?: string;
  liquidationLtv?: string;
  ratePct?: string;
  termType: 'open' | 'fixed';
  maturityDate?: string | null;
  warning?: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900 tabular-nums">{children}</dd>
    </div>
  );
}

const CASH = 'CASH_USD';

export function BookingSummary(props: BookingSummaryProps) {
  const {
    borrowerName,
    supplierName,
    assetType,
    quantity,
    loanValueUsd,
    collateralType,
    collateralQuantity,
    collateralValueUsd,
    coverage,
    bookingLtv,
    impliedLtv,
    marginCallLtv,
    liquidationLtv,
    ratePct,
    termType,
    maturityDate,
    warning,
  } = props;

  const rateBpsInt = ratePct && Number.isFinite(Number(ratePct)) ? Math.round(Number(ratePct) * 100) : null;

  const isCash = collateralType.toUpperCase() === CASH;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">Booking summary</p>
      <dl className="mt-3 space-y-3">
        <Row label="Borrower">{borrowerName || '—'}</Row>
        <Row label="Supplier">
          {supplierName ? `${supplierName} · ${assetType ?? '—'}` : '—'}
        </Row>
        <div className="border-t border-gray-200" />
        <Row label="Lending">
          <div>
            {quantity && assetType ? `${formatQty(quantity)} ${assetType}` : '—'}
          </div>
          <div className="text-gray-700">{formatUsd(loanValueUsd)}</div>
        </Row>
        <Row label="Collateral">
          <div>
            {isCash
              ? `${formatUsd(collateralValueUsd)} (${collateralType})`
              : `${formatQty(collateralQuantity)} ${collateralType} · ${formatUsd(collateralValueUsd)}`}
          </div>
          {coverage !== undefined && Number.isFinite(coverage) && (
            <div className="text-gray-500">coverage {coverage.toFixed(2)}×</div>
          )}
        </Row>
        <div className="border-t border-gray-200" />
        <Row label="Booking LTV">
          <span>{bookingLtv ? `${bookingLtv}%` : '—'}</span>
          {impliedLtv !== undefined && Number.isFinite(impliedLtv) && (
            <span className="ml-2 text-gray-500">implied {impliedLtv.toFixed(2)}%</span>
          )}
        </Row>
        <div className="text-xs text-gray-500">
          MC / Liq {marginCallLtv ? `${marginCallLtv}%` : '—'} /{' '}
          {liquidationLtv ? `${liquidationLtv}%` : '—'}
        </div>
        <div className="text-xs text-gray-500">
          Rate / Term{' '}
          {ratePct && rateBpsInt !== null ? `${ratePct}% (${rateBpsInt} bps)` : '—'} ·{' '}
          {termType === 'fixed' ? `fixed @ ${maturityDate || '—'}` : 'open'}
        </div>
        {warning && (
          <p role="status" className="text-xs text-amber-700">
            ⚠ Loan terms differ from supplier guidance.
          </p>
        )}
      </dl>
    </div>
  );
}
