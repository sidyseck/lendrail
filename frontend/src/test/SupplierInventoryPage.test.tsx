// src/test/SupplierInventoryPage.test.tsx — F-062 acceptance tests

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '@/auth/AuthContext';
import { SupplierInventoryPage } from '@/pages/inventory/SupplierInventoryPage';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockConnections } from '@/mocks/handlers/connections';
import { resetMockCustodians } from '@/mocks/handlers/custodians';
import { server } from '@/mocks/server';

// Supplier JWT: { sub: "user-001", org_id: "org-001", role: "supplier", exp: 9999999999 }
const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage() {
  setToken(SUPPLIER_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/inventory']}>
      <AuthProvider>
        <SupplierInventoryPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('SupplierInventoryPage', () => {
  beforeEach(() => {
    clearToken();
    resetMockConnections();
    resetMockCustodians();
  });

  // ── Section A: Custodian positions ──────────────────────────────────────────

  it('renders custodian positions table with BTC and ETH rows', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('BTC')).toBeInTheDocument();
      expect(screen.getByText('ETH')).toBeInTheDocument();
    });
    // 500.0 appears in both Section A (custodian balance) and Section B (custodian_balance column)
    expect(screen.getAllByText('500.0').length).toBeGreaterThan(0);
    expect(screen.getByText('2000.0')).toBeInTheDocument();
  });

  it('shows loading state while custodian data loads', () => {
    server.use(
      http.get('/api/custodians', async () => {
        await new Promise((r) => setTimeout(r, 500));
        return HttpResponse.json({ custodians: [] });
      }),
    );
    renderPage();
    expect(screen.getByLabelText(/loading custodian positions/i)).toBeInTheDocument();
  });

  it('shows error when custodians list endpoint fails', async () => {
    server.use(
      http.get('/api/custodians', () =>
        HttpResponse.json({ error: { message: 'Internal error' } }, { status: 500 }),
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
  });

  it('shows stale feed chip for ETH (67 min old, threshold 1h)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByLabelText('stale feed').length).toBeGreaterThan(0);
    });
  });

  it('does NOT show stale feed chip for BTC (10 min old)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('BTC')).toBeInTheDocument();
    });
    // Only ETH is stale; there should be exactly one stale chip
    const staleChips = screen.getAllByLabelText('stale feed');
    expect(staleChips.length).toBe(1);
  });

  it('shows register-custodian link when no custodians registered', async () => {
    server.use(
      http.get('/api/custodians', () => HttpResponse.json({ custodians: [] })),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/register a custodian/i)).toBeInTheDocument(),
    );
  });

  // ── Section B: Agent allocation panels ──────────────────────────────────────

  it('renders one panel per active/suspended connection', async () => {
    renderPage();
    // conn-002 is active, conn-001 is pending (excluded)
    await waitFor(() => {
      expect(screen.getByText('conn-002', { exact: false })).toBeInTheDocument();
    });
    // conn-001 (pending) should not appear
    expect(screen.queryByText('conn-001', { exact: false })).not.toBeInTheDocument();
  });

  it('panel shows published, on-loan, and remaining columns', async () => {
    renderPage();
    await waitFor(() => {
      // conn-002 has BTC=100 published in the mock
      expect(screen.getByText('BTC')).toBeInTheDocument();
    });
    // Column headers — use columnheader role to avoid matching section heading "Published to agents"
    expect(screen.getByRole('columnheader', { name: /^published$/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /on loan/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /remaining/i })).toBeInTheDocument();
  });

  it('shows empty state with Publish button for connection with no published inventory', async () => {
    // Override to return empty scope for conn-002
    server.use(
      http.get('/api/connections/:id/inventory', () =>
        HttpResponse.json({ connection_id: 'conn-002', entries: [] }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no inventory published/i)).toBeInTheDocument();
      expect(screen.getByText(/\+ publish/i)).toBeInTheDocument();
    });
  });

  // ── Section C: Allocation controls ──────────────────────────────────────────

  it('editing published quantity and saving calls PUT inventory-scope', async () => {
    const user = userEvent.setup();
    let putBody: unknown = null;
    server.use(
      http.put('/api/connections/:id/inventory-scope', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument());

    const btcInput = screen.getByLabelText(/published quantity for btc/i);
    await user.clear(btcInput);
    await user.type(btcInput, '150');

    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(putBody).not.toBeNull();
    });
    expect((putBody as { scope: { BTC: number } }).scope.BTC).toBe(150);
  });

  it('shows below-on-loan warning when quantity is reduced below already_booked', async () => {
    // Seed inventory with 30 already booked
    server.use(
      http.get('/api/connections/:id/inventory', () =>
        HttpResponse.json({
          connection_id: 'conn-002',
          entries: [
            {
              asset_type: 'BTC',
              custodian_balance: '500.0',
              published_quantity: '100.0',
              already_booked: '30.0',
              effective_available: '70.0',
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument());

    const btcInput = screen.getByLabelText(/published quantity for btc/i);
    await user.clear(btcInput);
    await user.type(btcInput, '20');

    await waitFor(() => {
      expect(screen.getByText(/below on-loan amount/i)).toBeInTheDocument();
    });
  });

  it('below-on-loan warning does NOT block save', async () => {
    server.use(
      http.get('/api/connections/:id/inventory', () =>
        HttpResponse.json({
          connection_id: 'conn-002',
          entries: [
            {
              asset_type: 'BTC',
              custodian_balance: '500.0',
              published_quantity: '100.0',
              already_booked: '30.0',
              effective_available: '70.0',
            },
          ],
        }),
      ),
    );
    let putCalled = false;
    server.use(
      http.put('/api/connections/:id/inventory-scope', async () => {
        putCalled = true;
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument());

    const btcInput = screen.getByLabelText(/published quantity for btc/i);
    await user.clear(btcInput);
    await user.type(btcInput, '20');
    await waitFor(() => screen.getByText(/below on-loan amount/i));

    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(putCalled).toBe(true));
  });

  it('setting to zero shows confirmation dialog; Cancel does not fire PUT', async () => {
    let putCalled = false;
    server.use(
      http.put('/api/connections/:id/inventory-scope', async () => {
        putCalled = true;
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument());

    const btcInput = screen.getByLabelText(/published quantity for btc/i);
    await user.clear(btcInput);
    await user.type(btcInput, '0');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // "BTC" is inside <strong> so RTL getNodeText misses it — check textContent directly
    expect(screen.getByRole('dialog').textContent).toMatch(/block new bookings for BTC/i);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(putCalled).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('setting to zero and confirming fires PUT with quantity 0', async () => {
    let putBody: unknown = null;
    server.use(
      http.put('/api/connections/:id/inventory-scope', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument());

    const btcInput = screen.getByLabelText(/published quantity for btc/i);
    await user.clear(btcInput);
    await user.type(btcInput, '0');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByRole('dialog'));

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(putBody).not.toBeNull());
    expect((putBody as { scope: { BTC: number } }).scope.BTC).toBe(0);
  });

  it('shows inline error when PUT returns 409', async () => {
    server.use(
      http.put('/api/connections/:id/inventory-scope', () =>
        HttpResponse.json(
          { error: { code: 'invalid_connection_status', message: 'Connection is terminated' } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('BTC')).toBeInTheDocument());

    const btcInput = screen.getByLabelText(/published quantity for btc/i);
    await user.clear(btcInput);
    await user.type(btcInput, '200');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/connection is terminated/i);
  });
});
