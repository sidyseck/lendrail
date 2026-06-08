import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { Loan, LoanBookingRequest, LoanListResponse } from '@/types/loan';

const MOCK_PRICES: Record<string, string> = { BTC: '63500.00', ETH: '1700.00' };

let mockLoans: Loan[] = [];

export function resetMockLoans(): void {
  mockLoans = [];
}

export const loanHandlers = [
  http.get('/api/market-data/prices/:assetType', ({ params }) => {
    const assetType = params.assetType as string;
    const price = MOCK_PRICES[assetType] ?? '0.00';
    return HttpResponse.json({
      asset_type: assetType,
      price_usd: price,
      as_of: new Date().toISOString(),
    });
  }),

  http.post('/api/loans', async ({ request }) => {
    await delay(20);
    const body = (await request.json().catch(() => null)) as LoanBookingRequest | null;
    if (!body?.connection_id || !body.borrower_id || !body.asset_type || !body.quantity) {
      return mockError('validation_error', 'Missing loan booking fields', 422);
    }

    const loanId = `loan-${Date.now()}`;
    const loan: Loan = {
      loan_id: loanId,
      connection_id: body.connection_id,
      agreement_id: 'agreement-001',
      borrower_id: body.borrower_id,
      borrower_name: 'Booked Borrower',
      asset_type: body.asset_type,
      quantity: body.quantity,
      rate_bps: body.rate_bps,
      term_type: body.term_type,
      maturity_date: body.maturity_date,
      day_count_basis: 'actual_360',
      collateral_type: body.collateral_type,
      collateral_quantity: body.collateral_quantity,
      collateral_value_usd: body.collateral_value_usd,
      current_ltv_pct: '30.0',
      ltv_as_of: new Date().toISOString(),
      state: 'pending',
      booked_at: new Date().toISOString(),
      activated_at: null,
      recall_initiated_at: null,
      recall_notice_deadline_at: null,
      return_custodian_ref: null,
      return_instruction_at: null,
      settled_at: null,
      defaulted_at: null,
    };
    mockLoans = [loan, ...mockLoans];
    return HttpResponse.json({ loan_id: loanId, state: 'pending' }, { status: 201 });
  }),

  http.get('/api/loans', async () => {
    await delay(20);
    const response: LoanListResponse = { loans: mockLoans };
    return HttpResponse.json(response);
  }),

  http.get('/api/loans/:loan_id', async ({ params }) => {
    await delay(20);
    const loan = mockLoans.find((row) => row.loan_id === params.loan_id);
    if (!loan) return mockError('not_found', 'Loan not found', 404);
    return HttpResponse.json(loan);
  }),
];
