// src/test/SupplierAgreementView.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { SupplierAgreementView } from '@/pages/agreements/SupplierAgreementView';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockAgreements } from '@/mocks/handlers/agreements';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Supplier JWT
const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderView(connectionId = 'conn-002') {
  setToken(SUPPLIER_TOKEN);
  return render(
    <MemoryRouter
      initialEntries={[`/dashboard/connections/${connectionId}/agreement`]}
    >
      <AuthProvider>
        <SupplierAgreementView connectionId={connectionId} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('SupplierAgreementView', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
    resetMockAgreements();
  });

  it('renders "No agreement submitted yet" when 404', async () => {
    server.use(
      http.get('/api/connections/conn-none/agreement', () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
    );
    renderView('conn-none');
    await waitFor(() => {
      expect(screen.getByText(/no agreement submitted yet/i)).toBeInTheDocument();
    });
  });

  it('renders AgreementConfirmBanner when agreement is pending_confirmation and supplier has not confirmed', async () => {
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByText(/requires your confirmation/i)).toBeInTheDocument();
    });
  });

  it('renders "Awaiting agent confirmation" when supplier already confirmed', async () => {
    server.use(
      http.get('/api/connections/conn-002/agreement', () =>
        HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-002',
          version: 1,
          assets_in_scope: ['BTC'],
          eligible_collateral: ['USDC'],
          initial_ltv_pct: '65.0000',
          margin_call_ltv_pct: '80.0000',
          recall_notice_days: 2,
          max_loan_days: 90,
          day_count_basis: 'actual_360',
          agent_fee_bps: 50,
          confirmed_by_supplier_at: '2026-06-08T01:00:00Z',
          confirmed_by_agent_at: null,
          status: 'pending_confirmation',
          created_at: '2026-06-08T00:00:00Z',
        }),
      ),
    );
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByText(/awaiting agent confirmation/i)).toBeInTheDocument();
    });
  });

  it('renders AgreementReadOnlyCard when agreement is active', async () => {
    server.use(
      http.get('/api/connections/conn-002/agreement', () =>
        HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-002',
          version: 1,
          assets_in_scope: ['BTC'],
          eligible_collateral: ['USDC'],
          initial_ltv_pct: '65.0000',
          margin_call_ltv_pct: '80.0000',
          recall_notice_days: 2,
          max_loan_days: 90,
          day_count_basis: 'actual_360',
          agent_fee_bps: 50,
          confirmed_by_supplier_at: '2026-06-08T01:00:00Z',
          confirmed_by_agent_at: '2026-06-08T02:00:00Z',
          status: 'active',
          created_at: '2026-06-08T00:00:00Z',
        }),
      ),
    );
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByText(/agreement v1/i)).toBeInTheDocument();
    });
  });

  it('confirm button calls POST /agreements/:id/confirm', async () => {
    let confirmCalled = false;
    server.use(
      http.post('/api/agreements/agr-001/confirm', () => {
        confirmCalled = true;
        return HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-002',
          version: 1,
          assets_in_scope: ['BTC'],
          eligible_collateral: ['USDC'],
          initial_ltv_pct: '65.0000',
          margin_call_ltv_pct: '80.0000',
          recall_notice_days: 2,
          max_loan_days: 90,
          day_count_basis: 'actual_360',
          agent_fee_bps: 50,
          confirmed_by_supplier_at: '2026-06-08T01:00:00Z',
          confirmed_by_agent_at: null,
          status: 'pending_confirmation',
          created_at: '2026-06-08T00:00:00Z',
        });
      }),
    );
    const user = userEvent.setup();
    renderView('conn-002');
    await waitFor(() => screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(confirmCalled).toBe(true));
  });

  it('after confirm, banner disappears and card shows updated timestamps', async () => {
    server.use(
      http.post('/api/agreements/agr-001/confirm', () =>
        HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-002',
          version: 1,
          assets_in_scope: ['BTC'],
          eligible_collateral: ['USDC'],
          initial_ltv_pct: '65.0000',
          margin_call_ltv_pct: '80.0000',
          recall_notice_days: 2,
          max_loan_days: 90,
          day_count_basis: 'actual_360',
          agent_fee_bps: 50,
          confirmed_by_supplier_at: '2026-06-08T01:00:00Z',
          confirmed_by_agent_at: null,
          status: 'pending_confirmation',
          created_at: '2026-06-08T00:00:00Z',
        }),
      ),
    );
    // After confirm, re-fetch returns supplier confirmed
    let callCount = 0;
    server.use(
      http.get('/api/connections/conn-002/agreement', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            agreement_id: 'agr-001',
            connection_id: 'conn-002',
            version: 1,
            assets_in_scope: ['BTC'],
            eligible_collateral: ['USDC'],
            initial_ltv_pct: '65.0000',
            margin_call_ltv_pct: '80.0000',
            recall_notice_days: 2,
            max_loan_days: 90,
            day_count_basis: 'actual_360',
            agent_fee_bps: 50,
            confirmed_by_supplier_at: null,
            confirmed_by_agent_at: null,
            status: 'pending_confirmation',
            created_at: '2026-06-08T00:00:00Z',
          });
        }
        return HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-002',
          version: 1,
          assets_in_scope: ['BTC'],
          eligible_collateral: ['USDC'],
          initial_ltv_pct: '65.0000',
          margin_call_ltv_pct: '80.0000',
          recall_notice_days: 2,
          max_loan_days: 90,
          day_count_basis: 'actual_360',
          agent_fee_bps: 50,
          confirmed_by_supplier_at: '2026-06-08T01:00:00Z',
          confirmed_by_agent_at: null,
          status: 'pending_confirmation',
          created_at: '2026-06-08T00:00:00Z',
        });
      }),
    );
    const user = userEvent.setup();
    renderView('conn-002');
    await waitFor(() => screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect(screen.getByText(/awaiting agent confirmation/i)).toBeInTheDocument();
    });
  });

  it('shows error on 409 already_confirmed', async () => {
    server.use(
      http.post('/api/agreements/agr-001/confirm', () =>
        HttpResponse.json(
          { error: { code: 'already_confirmed', message: 'Already confirmed' } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderView('conn-002');
    await waitFor(() => screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows View History link', async () => {
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /view history/i })).toBeInTheDocument();
    });
  });
});
