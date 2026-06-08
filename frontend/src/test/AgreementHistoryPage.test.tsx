// src/test/AgreementHistoryPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { AgreementHistoryPage } from '@/pages/agreements/AgreementHistoryPage';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockAgreements } from '@/mocks/handlers/agreements';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage(connectionId = 'conn-002') {
  setToken(SUPPLIER_TOKEN);
  return render(
    <MemoryRouter
      initialEntries={[`/dashboard/connections/${connectionId}/agreement/history`]}
    >
      <AuthProvider>
        <Routes>
          <Route
            path="/dashboard/connections/:connectionId/agreement/history"
            element={<AgreementHistoryPage />}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AgreementHistoryPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
    resetMockAgreements();
  });

  it('renders history table with all versions', async () => {
    server.use(
      http.get('/api/connections/conn-002/agreement/history', () =>
        HttpResponse.json({
          agreements: [
            {
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
            },
            {
              agreement_id: 'agr-002',
              connection_id: 'conn-002',
              version: 2,
              assets_in_scope: ['BTC', 'ETH'],
              eligible_collateral: ['USDC'],
              initial_ltv_pct: '70.0000',
              margin_call_ltv_pct: '85.0000',
              recall_notice_days: 3,
              max_loan_days: 180,
              day_count_basis: 'actual_365',
              agent_fee_bps: 75,
              confirmed_by_supplier_at: null,
              confirmed_by_agent_at: null,
              status: 'pending_confirmation',
              created_at: '2026-06-09T00:00:00Z',
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument();
      expect(screen.getByText('v2')).toBeInTheDocument();
    });
  });

  it('versions are ordered by version ascending', async () => {
    server.use(
      http.get('/api/connections/conn-002/agreement/history', () =>
        HttpResponse.json({
          agreements: [
            {
              agreement_id: 'agr-002',
              connection_id: 'conn-002',
              version: 2,
              assets_in_scope: ['BTC'],
              eligible_collateral: ['USDC'],
              initial_ltv_pct: '70.0000',
              margin_call_ltv_pct: '85.0000',
              recall_notice_days: 3,
              max_loan_days: 180,
              day_count_basis: 'actual_365',
              agent_fee_bps: 75,
              confirmed_by_supplier_at: null,
              confirmed_by_agent_at: null,
              status: 'pending_confirmation',
              created_at: '2026-06-09T00:00:00Z',
            },
            {
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
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // rows[0] is header; rows[1] = first data row (v1), rows[2] = second (v2)
      expect(rows[1].textContent).toMatch(/v1/);
      expect(rows[2].textContent).toMatch(/v2/);
    });
  });

  it('latest version is visually distinguished', async () => {
    // Seed data has agr-001 with version 1 for conn-002
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('(current)')).toBeInTheDocument();
    });
  });

  it('shows empty state when no history', async () => {
    server.use(
      http.get('/api/connections/conn-none/agreement/history', () =>
        HttpResponse.json({ agreements: [] }),
      ),
    );
    renderPage('conn-none');
    await waitFor(() => {
      expect(screen.getByText(/no agreement versions yet/i)).toBeInTheDocument();
    });
  });

  it('shows error when API returns 403', async () => {
    server.use(
      http.get('/api/connections/conn-002/agreement/history', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Access denied' } },
          { status: 403 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/access denied/i);
    });
  });
});
