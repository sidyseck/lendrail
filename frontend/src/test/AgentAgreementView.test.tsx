// src/test/AgentAgreementView.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { AgentAgreementView } from '@/pages/agreements/AgentAgreementView';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockAgreements } from '@/mocks/handlers/agreements';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Agent JWT
const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderView(connectionId = 'conn-002') {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter
      initialEntries={[`/dashboard/connections/${connectionId}/agreement`]}
    >
      <AuthProvider>
        <AgentAgreementView connectionId={connectionId} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AgentAgreementView', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
    resetMockAgreements();
  });

  it('renders "No agreement yet" and Enter Agreement Terms link when 404', async () => {
    server.use(
      http.get('/api/connections/conn-none/agreement', () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
    );
    renderView('conn-none');
    await waitFor(() => {
      expect(screen.getByText(/no agreement yet/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /enter agreement terms/i })).toBeInTheDocument();
    });
  });

  it('renders AgreementReadOnlyCard when agreement present', async () => {
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByText(/agreement v1/i)).toBeInTheDocument();
    });
  });

  it('shows Amend Terms button when agreement present', async () => {
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /amend terms/i })).toBeInTheDocument();
    });
  });

  it('shows Confirm button when agent has not yet confirmed', async () => {
    renderView('conn-002');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
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
          confirmed_by_supplier_at: null,
          confirmed_by_agent_at: '2026-06-08T02:00:00Z',
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

  it('after agent confirm, agreement status updates', async () => {
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
          confirmed_by_agent_at: '2026-06-08T02:00:00Z',
          status: 'active',
          created_at: '2026-06-08T00:00:00Z',
        }),
      ),
    );
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
          confirmed_by_agent_at: '2026-06-08T02:00:00Z',
          status: 'active',
          created_at: '2026-06-08T00:00:00Z',
        });
      }),
    );
    const user = userEvent.setup();
    renderView('conn-002');
    await waitFor(() => screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      // Confirm button should disappear after both confirmed + active
      expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
    });
  });
});
