import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { ApprovedBorrower, BorrowerCreateRequest } from '@/types/borrower';

let approvedBorrowersByConnection: Record<string, ApprovedBorrower[]> = {
  'conn-002': [
    {
      borrower_id: 'borrower-001',
      name: 'Blue River Trading',
      jurisdiction: 'Delaware, USA',
      status: 'active',
      approved_at: '2026-06-08T00:00:00Z',
    },
  ],
};

export function resetMockBorrowers(): void {
  approvedBorrowersByConnection = {
    'conn-002': [
      {
        borrower_id: 'borrower-001',
        name: 'Blue River Trading',
        jurisdiction: 'Delaware, USA',
        status: 'active',
        approved_at: '2026-06-08T00:00:00Z',
      },
    ],
  };
}

export const borrowerHandlers = [
  http.get('/api/connections/:connection_id/approved-borrowers', async ({ params }) => {
    await delay(20);
    const connectionId = params.connection_id as string;
    return HttpResponse.json({
      borrowers: approvedBorrowersByConnection[connectionId] ?? [],
    });
  }),

  http.post('/api/borrowers', async ({ request }) => {
    await delay(20);
    const body = (await request.json().catch(() => null)) as BorrowerCreateRequest | null;

    if (!body?.name || !body.jurisdiction || !body.contact_email) {
      return mockError('validation_error', 'Borrower name, jurisdiction, and email are required', 422);
    }

    const borrowerId = `borrower-${Date.now()}`;
    if (body.connection_id) {
      const nextBorrower: ApprovedBorrower = {
        borrower_id: borrowerId,
        name: body.name,
        jurisdiction: body.jurisdiction,
        status: 'active',
        approved_at: new Date().toISOString(),
      };
      approvedBorrowersByConnection[body.connection_id] = [
        ...(approvedBorrowersByConnection[body.connection_id] ?? []),
        nextBorrower,
      ];
    }

    return HttpResponse.json(
      {
        borrower_id: borrowerId,
        status: 'active',
        approved_connection_id: body.connection_id ?? null,
      },
      { status: 201 },
    );
  }),
];
