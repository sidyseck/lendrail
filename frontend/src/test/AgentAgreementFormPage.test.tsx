// src/test/AgentAgreementFormPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { AgentAgreementFormPage } from '@/pages/agreements/AgentAgreementFormPage';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockAgreements } from '@/mocks/handlers/agreements';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Agent JWT: { sub: "user-002", org_id: "org-002", role: "agent", exp: 9999999999 }
const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

// Supplier JWT (to test 403)
const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage(connectionId = 'conn-new') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/connections/${connectionId}/agreement/new`]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/dashboard/connections/:connectionId/agreement/new"
            element={<AgentAgreementFormPage />}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AgentAgreementFormPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
    resetMockAgreements();
    // Default: no existing agreement for conn-new
    server.use(
      http.get('/api/connections/conn-new/agreement', () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
    );
  });

  it('renders all form fields', async () => {
    setToken(AGENT_TOKEN);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/assets in scope/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/eligible collateral/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/initial ltv/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/margin call ltv/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recall notice/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max loan days/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/day count basis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/agent fee/i)).toBeInTheDocument();
  });

  it('shows validation error for empty assets_in_scope', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/assets in scope/i));
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /assets in scope/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error for empty eligible_collateral', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/assets in scope/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /eligible collateral/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error when initial_ltv_pct = 0', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/initial ltv/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '0');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /initial ltv/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error when initial_ltv_pct = 100', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/initial ltv/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '100');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /initial ltv/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error when margin_call_ltv_pct <= initial_ltv_pct', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/initial ltv/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '65');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
    await user.type(screen.getByLabelText(/agent fee/i), '50');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((a) => /margin call.*greater than.*initial/i.test(a.textContent ?? '')),
      ).toBe(true);
    });
  });

  it('shows validation error for recall_notice_days = 0', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/recall notice/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '0');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /recall notice/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error for max_loan_days = 0', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/max loan days/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '0');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /max loan days/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error for agent_fee_bps > 10000', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/agent fee/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
    await user.type(screen.getByLabelText(/agent fee/i), '10001');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /agent fee/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error when day_count_basis not selected', async () => {
    setToken(AGENT_TOKEN);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/day count basis/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.type(screen.getByLabelText(/agent fee/i), '50');
    // day_count_basis left as empty default
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /day count basis/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('submits valid form and navigates to agreement page on 201', async () => {
    setToken(AGENT_TOKEN);
    server.use(
      http.post('/api/connections/conn-new/agreement', () =>
        HttpResponse.json(
          {
            agreement_id: 'agr-new',
            connection_id: 'conn-new',
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
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/assets in scope/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
    await user.type(screen.getByLabelText(/agent fee/i), '50');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/dashboard/connections/conn-new/agreement',
      );
    });
  });

  it('shows API error on 409 pending_agreement_exists', async () => {
    setToken(AGENT_TOKEN);
    server.use(
      http.post('/api/connections/conn-new/agreement', () =>
        HttpResponse.json(
          {
            error: {
              code: 'pending_agreement_exists',
              message: 'A pending agreement already exists for this connection',
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/assets in scope/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
    await user.type(screen.getByLabelText(/agent fee/i), '50');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/pending agreement already exists/i);
    });
  });

  it('shows API error on 403 (supplier JWT)', async () => {
    setToken(SUPPLIER_TOKEN);
    server.use(
      http.get('/api/connections/conn-new/agreement', () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
      ),
      http.post('/api/connections/conn-new/agreement', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Only agents can create agreements' } },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByLabelText(/assets in scope/i));
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
    await user.type(screen.getByLabelText(/agent fee/i), '50');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/only agents/i);
    });
  });

  it('pre-populates form when existing agreement present (amend mode)', async () => {
    setToken(AGENT_TOKEN);
    server.use(
      http.get('/api/connections/conn-amend/agreement', () =>
        HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-amend',
          version: 1,
          assets_in_scope: ['BTC', 'ETH'],
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
        }),
      ),
    );
    renderPage('conn-amend');
    await waitFor(() => {
      const input = screen.getByLabelText(/assets in scope/i) as HTMLInputElement;
      expect(input.value).toContain('BTC');
    });
  });

  it('amend: calls PUT /agreements/:id and navigates on 201', async () => {
    setToken(AGENT_TOKEN);
    server.use(
      http.get('/api/connections/conn-amend/agreement', () =>
        HttpResponse.json({
          agreement_id: 'agr-001',
          connection_id: 'conn-amend',
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
        }),
      ),
      http.put('/api/agreements/agr-001', () =>
        HttpResponse.json(
          {
            agreement_id: 'agr-002',
            connection_id: 'conn-amend',
            version: 2,
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
            created_at: '2026-06-09T00:00:00Z',
          },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage('conn-amend');
    await waitFor(() => {
      const input = screen.getByLabelText(/assets in scope/i) as HTMLInputElement;
      expect(input.value).toBe('BTC');
    });
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/dashboard/connections/conn-amend/agreement',
      );
    });
  });
});
