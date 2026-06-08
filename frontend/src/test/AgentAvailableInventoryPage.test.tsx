// src/test/AgentAvailableInventoryPage.test.tsx — F-063 acceptance tests

import { render, screen, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '@/auth/AuthContext';
import { AgentAvailableInventoryPage } from '@/pages/inventory/AgentAvailableInventoryPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockConnections } from '@/mocks/handlers/connections';
import { resetMockNotifications } from '@/mocks/handlers/notifications';
import { server } from '@/mocks/server';
import type { AllocationNotification } from '@/types/inventory';

// Agent JWT: { sub: "user-002", org_id: "org-002", role: "agent", exp: 9999999999 }
const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function agentInventoryHandler(
  connId: string,
  entries: { asset_type: string; effective_available: string }[],
) {
  return http.get(`/api/connections/${connId}/inventory`, async () => {
    await new Promise((r) => setTimeout(r, 20));
    return HttpResponse.json({ connection_id: connId, entries });
  });
}

function renderPage() {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/available-inventory']}>
      <AuthProvider>
        <AgentAvailableInventoryPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderDashboard() {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/connections']}>
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AgentAvailableInventoryPage', () => {
  beforeEach(() => {
    clearToken();
    resetMockConnections();
    resetMockNotifications();
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
  });

  // ── Section A: Aggregated totals ────────────────────────────────────────────

  it('renders aggregated totals table with BTC and ETH rows', async () => {
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '70.0' },
        { asset_type: 'ETH', effective_available: '20.0' },
      ]),
    );

    renderPage();
    // Section A shows String(number) totals: "70", "20" (no trailing .0).
    // Section B shows raw effective_available strings: "70.0", "20.0".
    // Use these unique values to verify Section A loaded correctly.
    await waitFor(() => {
      expect(screen.getByText('70')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
    });
    // BTC and ETH appear in both sections (A + B)
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ETH').length).toBeGreaterThan(0);
  });

  it('aggregates effective_available across multiple connections', async () => {
    server.use(
      http.get('/api/connections', async () => {
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-002',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'active',
              created_at: '2026-06-01T00:00:00Z',
              activated_at: '2026-06-02T00:00:00Z',
            },
            {
              connection_id: 'conn-003',
              supplier_id: 'org-004',
              agent_id: 'org-002',
              status: 'active',
              created_at: '2026-06-01T00:00:00Z',
              activated_at: '2026-06-02T00:00:00Z',
            },
          ],
        });
      }),
      agentInventoryHandler('conn-002', [{ asset_type: 'BTC', effective_available: '70' }]),
      agentInventoryHandler('conn-003', [{ asset_type: 'BTC', effective_available: '30' }]),
    );

    renderPage();
    await waitFor(() => {
      const totalsSection = screen.getByRole('region', { name: 'Totals' });
      // Sum: 70 + 30 = 100
      expect(within(totalsSection).getByText('100')).toBeInTheDocument();
    });
  });

  it('shows loading state while connections load', () => {
    server.use(
      http.get('/api/connections', async () => {
        await new Promise((r) => setTimeout(r, 500));
        return HttpResponse.json({ connections: [] });
      }),
    );
    renderPage();
    expect(screen.getByLabelText(/loading inventory/i)).toBeInTheDocument();
  });

  it('shows error alert when connections endpoint fails', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({ error: { message: 'Server error' } }, { status: 500 }),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('shows empty state when no active connections', async () => {
    server.use(
      http.get('/api/connections', () => HttpResponse.json({ connections: [] })),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/no inventory available/i)).toBeInTheDocument(),
    );
  });

  it('excludes zero effective_available entries from totals', async () => {
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'SOL', effective_available: '0.0' },
        { asset_type: 'BTC', effective_available: '50.0' },
      ]),
    );
    renderPage();
    await waitFor(() => {
      const totalsSection = screen.getByRole('region', { name: 'Totals' });
      expect(within(totalsSection).getByText('BTC')).toBeInTheDocument();
      expect(within(totalsSection).queryByText('SOL')).not.toBeInTheDocument();
    });
  });

  // ── Section B: Supplier breakdown ──────────────────────────────────────────

  it('renders breakdown rows with supplier, asset, and available columns', async () => {
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '70.0' },
        { asset_type: 'ETH', effective_available: '20.0' },
      ]),
    );
    renderPage();
    await waitFor(() => {
      const breakdownSection = screen.getByRole('region', { name: 'Breakdown by supplier' });
      expect(within(breakdownSection).getAllByText('BTC').length).toBeGreaterThan(0);
    });
  });

  it('excludes zero effective_available from breakdown', async () => {
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '0.0' },
      ]),
    );
    renderPage();
    await waitFor(() => {
      const breakdownSection = screen.getByRole('region', { name: 'Breakdown by supplier' });
      expect(within(breakdownSection).getByText(/no available inventory from suppliers/i)).toBeInTheDocument();
    });
  });

  it('does not show custodian balance or published columns in breakdown', async () => {
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '70.0' },
      ]),
    );
    renderPage();
    await waitFor(() => {
      const breakdownSection = screen.getByRole('region', { name: 'Breakdown by supplier' });
      expect(within(breakdownSection).getAllByText('BTC').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('columnheader', { name: /custodian/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^published$/i })).not.toBeInTheDocument();
  });

  // ── Notification badge (DashboardPage) ─────────────────────────────────────

  it('shows badge on Available Inventory nav link when unread notifications exist', async () => {
    // resetMockNotifications() seeds notif-001 (unread, 5 min ago, connection_id=conn-002)
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('shows 9+ badge when unread count exceeds 9', async () => {
    const many: AllocationNotification[] = Array.from({ length: 10 }, (_, i) => ({
      notification_id: `notif-${i}`,
      event: 'supplier_allocation_changed',
      connection_id: 'conn-002',
      read: false,
      created_at: new Date(Date.now() - i * 60_000).toISOString(),
      payload: {},
    }));
    resetMockNotifications(many);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('9+')).toBeInTheDocument();
    });
  });

  // ── Notification highlights (AgentAvailableInventoryPage) ──────────────────

  it('shows highlight chip on breakdown row for recently-changed connection', async () => {
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '80.0' },
      ]),
    );
    // notif-001 is unread, connection_id=conn-002, created 5 min ago
    renderPage();
    // Hook auto-processes on mount: fetches notifications, sets highlights
    await waitFor(() =>
      expect(screen.getByText(/updated/i)).toBeInTheDocument(),
    );
  });

  it('marks notifications as read on screen visit (calls POST read endpoint)', async () => {
    let readCalled = false;
    server.use(
      http.post('/api/notifications/:id/read', async () => {
        readCalled = true;
        return HttpResponse.json({ notification_id: 'notif-001', read: true });
      }),
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '80.0' },
      ]),
    );
    renderPage();
    await waitFor(() => expect(readCalled).toBe(true));
  });

  it('removes highlight chip after 3 seconds (fake timers)', async () => {
    vi.useFakeTimers();
    server.use(
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '80.0' },
      ]),
    );
    renderPage();

    // Run all timers: MSW delays + mark-read call + 3s highlight clear timer
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.queryByText(/updated/i)).not.toBeInTheDocument();
  });

  it('degrades gracefully when notifications endpoint returns 404', async () => {
    server.use(
      http.get('/api/notifications', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
      agentInventoryHandler('conn-002', [
        { asset_type: 'BTC', effective_available: '70.0' },
      ]),
    );
    renderPage();
    await waitFor(() => {
      const totalsSection = screen.getByRole('region', { name: 'Totals' });
      expect(within(totalsSection).getByText('BTC')).toBeInTheDocument();
    });
    // No crash, no highlight chips
    expect(screen.queryByText(/updated/i)).not.toBeInTheDocument();
  });
});
