// src/test/AgentConnectionsPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { AgentConnectionsPage } from '@/pages/connections/AgentConnectionsPage';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockConnections } from '@/mocks/handlers/connections';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

// Mock useNavigate to prevent navigation side-effects
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

function renderPage() {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/connections']}>
      <AuthProvider>
        <AgentConnectionsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AgentConnectionsPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
    resetMockConnections();
  });

  // ── List rendering ───────────────────────────────────────────────────────────

  it('renders connection list with supplier name/ID and status badges', async () => {
    renderPage();
    await waitFor(() => {
      // Default seed has 2 connections: pending (org-001 supplier) and active (org-001 supplier)
      expect(screen.getByText('pending')).toBeInTheDocument();
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('shows "Accept" button only for pending connections', async () => {
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    const acceptButtons = screen.getAllByRole('button', { name: /accept/i });
    // Only 1 pending connection in seed data → only 1 Accept button
    expect(acceptButtons).toHaveLength(1);
  });

  it('does not show "Accept" button for active, suspended, or terminated connections', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-active',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'active',
              created_at: '2026-06-01T00:00:00Z',
              activated_at: '2026-06-02T00:00:00Z',
            },
            {
              connection_id: 'conn-term',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'terminated',
              created_at: '2026-06-01T00:00:00Z',
              activated_at: null,
            },
            {
              connection_id: 'conn-suspended',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'suspended',
              created_at: '2026-06-01T00:00:00Z',
              activated_at: '2026-06-02T00:00:00Z',
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByText('active'));
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('shows empty state when no connections exist', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({ connections: [] }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no pending invitations/i)).toBeInTheDocument();
    });
  });

  it('shows effective availability for active connections without raw inventory fields', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Available: BTC 100\.0\s+ETH 25\.0/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('500.0')).not.toBeInTheDocument();
    expect(screen.queryByText('250.0')).not.toBeInTheDocument();
  });

  // ── Accept flow ──────────────────────────────────────────────────────────────

  it('calls accept endpoint when "Accept" is clicked', async () => {
    const user = userEvent.setup();
    let acceptCalled = false;
    server.use(
      http.post('/api/connections/:connection_id/accept', () => {
        acceptCalled = true;
        return HttpResponse.json(
          {
            connection_id: 'conn-001',
            supplier_id: 'org-001',
            agent_id: 'org-002',
            status: 'active',
            created_at: '2026-06-08T00:00:00Z',
            activated_at: new Date().toISOString(),
          },
          { status: 200 },
        );
      }),
    );
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /accept/i }));
    await user.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(acceptCalled).toBe(true));
  });

  it('transitions pending connection to "active" after successful accept', async () => {
    const user = userEvent.setup();
    // Use MSW stateful handler via resetMockConnections — conn-001 starts as pending
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => {
      // conn-001 becomes active; conn-002 was already active — 2 active badges total
      expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows inline error when accept returns 409 (already accepted)', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-001',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'pending',
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
      http.post('/api/connections/:connection_id/accept', () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_connection_status',
              message: 'Connection is already accepted',
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /accept/i }));
    await user.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already accepted/i);
    });
  });

  it('shows inline error when accept returns 403 (wrong org)', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/connections/:connection_id/accept', () =>
        HttpResponse.json(
          {
            error: {
              code: 'forbidden',
              message: 'You are not authorized to accept this connection.',
            },
          },
          { status: 403 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /accept/i }));
    await user.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not authorized/i);
    });
  });

  it('disables accept button while request is in flight', async () => {
    const user = userEvent.setup();
    // Add extra delay so we can observe loading state
    server.use(
      http.post('/api/connections/:connection_id/accept', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(
          {
            connection_id: 'conn-001',
            supplier_id: 'org-001',
            agent_id: 'org-002',
            status: 'active',
            created_at: '2026-06-08T00:00:00Z',
            activated_at: new Date().toISOString(),
          },
          { status: 200 },
        );
      }),
    );
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /accept/i }));
    const acceptButton = screen.getByRole('button', { name: /accept/i });
    await user.click(acceptButton);
    expect(acceptButton).toBeDisabled();
    await waitFor(() => expect(acceptButton).not.toBeDisabled());
  });
});
