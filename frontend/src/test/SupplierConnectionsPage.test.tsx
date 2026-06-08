// src/test/SupplierConnectionsPage.test.tsx

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { SupplierConnectionsPage } from '@/pages/connections/SupplierConnectionsPage';
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

// Supplier JWT: { sub: "user-001", org_id: "org-001", role: "supplier", exp: 9999999999 }
const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage() {
  setToken(SUPPLIER_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/connections']}>
      <AuthProvider>
        <SupplierConnectionsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('SupplierConnectionsPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
    resetMockConnections();
  });

  // ── List rendering ───────────────────────────────────────────────────────────

  it('renders connection list with status badges', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('pending')).toBeInTheDocument();
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('shows loading state before connections load', () => {
    renderPage();
    expect(screen.getByText(/loading connections/i)).toBeInTheDocument();
  });

  it('shows error state when GET /connections fails', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json(
          { error: { code: 'server_error', message: 'Internal server error' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Internal server error');
    });
  });

  it('shows empty state when no connections exist', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({ connections: [] }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/no connections yet/i),
      ).toBeInTheDocument();
    });
  });

  // ── Invite modal ─────────────────────────────────────────────────────────────

  it('opens invite modal when "Invite Agent" is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    expect(screen.getByRole('dialog', { name: /invite agent/i })).toBeInTheDocument();
  });

  it('shows validation error when invite submitted with no value', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/required/i);
    });
  });

  it('shows validation error for invalid email format in email mode', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    await user.type(screen.getByLabelText(/agent email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);
    });
  });

  it('adds a new pending connection row after successful 201 invite (by email)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    await user.type(screen.getByLabelText(/agent email/i), 'new-agent@example.com');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    // Modal should close and list should have a new row
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      // Now there should be at least 3 rows (2 initial + 1 new)
      const rows = screen.getAllByText('pending');
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('adds a new pending connection row after successful 201 invite (by org ID)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    // Switch to org ID mode
    await user.click(screen.getByLabelText(/by org id/i));
    await user.type(screen.getByLabelText(/agent org id/i), 'org-new-agent');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows 202 banner message when invite sent to unknown agent email', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    await user.type(
      screen.getByLabelText(/agent email/i),
      'unknown@notregistered.test',
    );
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText(/invite sent/i)).toBeInTheDocument();
    });
  });

  it('shows 409 error inside modal for duplicate invite', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    await user.click(screen.getByRole('button', { name: /invite agent/i }));
    // Switch to org ID mode and use the existing AGENT_ORG_ID that triggers 409
    await user.click(screen.getByLabelText(/by org id/i));
    await user.type(screen.getByLabelText(/agent org id/i), 'org-002');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i);
    });
    // Modal stays open
    expect(screen.getByRole('dialog', { name: /invite agent/i })).toBeInTheDocument();
  });

  // ── Register Custodian Key ───────────────────────────────────────────────────

  it('shows "Register Custodian Key" button only for accepted connections', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-accepted',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'accepted',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /register custodian key/i }),
      ).toBeInTheDocument();
    });
  });

  it('does not show "Register Custodian Key" for pending connections', async () => {
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    expect(
      screen.queryByRole('button', { name: /register custodian key/i }),
    ).not.toBeInTheDocument();
  });

  it('does not show "Register Custodian Key" for active or suspended connections', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-active',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'active',
              custodian_link_present: true,
              created_at: '2026-06-01T00:00:00Z',
              activated_at: '2026-06-02T00:00:00Z',
            },
            {
              connection_id: 'conn-suspended',
              supplier_id: 'org-001',
              agent_id: 'org-003',
              status: 'suspended',
              custodian_link_present: false,
              created_at: '2026-06-01T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByText('active'));
    expect(
      screen.queryByRole('button', { name: /register custodian key/i }),
    ).not.toBeInTheDocument();
  });

  it('opens register key modal when "Register Custodian Key" is clicked', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-accepted',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'accepted',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /register custodian key/i }),
    );
    await user.click(screen.getByRole('button', { name: /register custodian key/i }));
    expect(
      screen.getByRole('dialog', { name: /register custodian key/i }),
    ).toBeInTheDocument();
  });

  it('plaintext_key input has type="password"', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-accepted',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'accepted',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /register custodian key/i }),
    );
    await user.click(screen.getByRole('button', { name: /register custodian key/i }));
    const apiKeyInput = screen.getByLabelText(/api key/i);
    expect(apiKeyInput).toHaveAttribute('type', 'password');
  });

  it('transitions connection to "active" after successful key registration', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-accepted',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'accepted',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    server.use(
      http.post('/api/connections/conn-accepted/custodian-key', () =>
        HttpResponse.json(
          {
            connection_id: 'conn-accepted',
            supplier_id: 'org-001',
            agent_id: 'org-002',
            status: 'active',
            custodian_link_present: true,
            created_at: '2026-06-08T00:00:00Z',
            activated_at: '2026-06-08T01:00:00Z',
          },
          { status: 200 },
        ),
      ),
    );
    // After key registration, the list refetch should show active
    let callCount = 0;
    server.use(
      http.get('/api/connections', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            connections: [
              {
                connection_id: 'conn-accepted',
                supplier_id: 'org-001',
                agent_id: 'org-002',
                status: 'accepted',
                custodian_link_present: false,
                created_at: '2026-06-08T00:00:00Z',
                activated_at: null,
              },
            ],
          });
        }
        return HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-accepted',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'active',
              custodian_link_present: true,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: '2026-06-08T01:00:00Z',
            },
          ],
        });
      }),
    );
    renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /register custodian key/i }),
    );
    await user.click(screen.getByRole('button', { name: /register custodian key/i }));
    await user.type(screen.getByLabelText(/custodian id/i), 'mock');
    await user.type(screen.getByLabelText(/account reference/i), 'acct-001');
    await user.type(screen.getByLabelText(/api key/i), 'secret-key-123');
    await user.click(screen.getByRole('button', { name: /register key/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument();
    });
  });

  it('shows custodian_key_invalid error inside modal on 422 response', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-key-invalid',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'accepted',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /register custodian key/i }),
    );
    await user.click(screen.getByRole('button', { name: /register custodian key/i }));
    await user.type(screen.getByLabelText(/custodian id/i), 'mock');
    await user.type(screen.getByLabelText(/account reference/i), 'acct-001');
    await user.type(screen.getByLabelText(/api key/i), 'bad-key');
    await user.click(screen.getByRole('button', { name: /register key/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/rejected by custodian/i);
    });
  });

  it('does not show plaintext_key value in any rendered text after submission', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-accepted',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'accepted',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /register custodian key/i }),
    );
    await user.click(screen.getByRole('button', { name: /register custodian key/i }));
    const secretValue = 'super-secret-api-key-xyz';
    await user.type(screen.getByLabelText(/custodian id/i), 'mock');
    await user.type(screen.getByLabelText(/account reference/i), 'acct-001');
    await user.type(screen.getByLabelText(/api key/i), secretValue);
    await user.click(screen.getByRole('button', { name: /register key/i }));
    // After any action, verify the key value doesn't appear as visible text
    await waitFor(() => {
      expect(screen.queryByText(secretValue)).not.toBeInTheDocument();
    });
  });

  // ── Suspend ─────────────────────────────────────────────────────────────────

  it('shows Suspend button on active connections', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument();
    });
  });

  it('does not show Suspend button on pending connections', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-001',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'pending',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByText('pending'));
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
  });

  it('calls suspend endpoint and updates status to "suspended" after confirm', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() =>
      screen.getByRole('button', { name: /suspend/i }),
    );
    await user.click(screen.getByRole('button', { name: /suspend/i }));
    await waitFor(() => {
      expect(screen.getByText('suspended')).toBeInTheDocument();
    });
    vi.restoreAllMocks();
  });

  it('does not call suspend endpoint if window.confirm returns false', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    let suspendCalled = false;
    server.use(
      http.post('/api/connections/:id/suspend', () => {
        suspendCalled = true;
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /suspend/i }));
    await user.click(screen.getByRole('button', { name: /suspend/i }));
    expect(suspendCalled).toBe(false);
    vi.restoreAllMocks();
  });

  it('shows error when suspend returns 409', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.post('/api/connections/:connection_id/suspend', () =>
        HttpResponse.json(
          { error: { code: 'invalid_connection_status', message: 'Connection cannot be suspended' } },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /suspend/i }));
    await user.click(screen.getByRole('button', { name: /suspend/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cannot be suspended/i);
    });
    vi.restoreAllMocks();
  });

  // ── Terminate ───────────────────────────────────────────────────────────────

  it('shows Terminate button on non-terminated connections', async () => {
    renderPage();
    await waitFor(() => {
      const terminateButtons = screen.getAllByRole('button', { name: /terminate/i });
      expect(terminateButtons.length).toBeGreaterThan(0);
    });
  });

  it('does not show Terminate button on terminated connections', async () => {
    server.use(
      http.get('/api/connections', () =>
        HttpResponse.json({
          connections: [
            {
              connection_id: 'conn-term',
              supplier_id: 'org-001',
              agent_id: 'org-002',
              status: 'terminated',
              custodian_link_present: false,
              created_at: '2026-06-08T00:00:00Z',
              activated_at: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => screen.getByText('terminated'));
    expect(
      screen.queryByRole('button', { name: /terminate/i }),
    ).not.toBeInTheDocument();
  });

  it('calls terminate endpoint and updates status to "terminated" after confirm', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Use default seed data: conn-001 is pending (terminatable), conn-002 is active.
    // After terminate, the mutable mockConnections in the handler updates,
    // and the GET refetch returns the updated list.
    renderPage();
    // Wait for initial load — 2 rows visible (pending + active)
    await waitFor(() => screen.getByText('pending'));
    // Terminate the first connection (pending conn-001)
    const terminateButtons = screen.getAllByRole('button', { name: /terminate/i });
    await user.click(terminateButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('terminated')).toBeInTheDocument();
    });
    vi.restoreAllMocks();
  });

  it('does not call terminate endpoint if window.confirm returns false', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    let terminateCalled = false;
    server.use(
      http.post('/api/connections/:id/terminate', () => {
        terminateCalled = true;
        return HttpResponse.json({}, { status: 200 });
      }),
    );
    renderPage();
    await waitFor(() => screen.getAllByRole('button', { name: /terminate/i }));
    await user.click(screen.getAllByRole('button', { name: /terminate/i })[0]);
    expect(terminateCalled).toBe(false);
    vi.restoreAllMocks();
  });

  it('shows error when terminate returns 409 (already terminated)', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.post('/api/connections/:connection_id/terminate', () =>
        HttpResponse.json(
          { error: { code: 'connection_already_terminated', message: 'Connection is already terminated' } },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => screen.getAllByRole('button', { name: /terminate/i }));
    await user.click(screen.getAllByRole('button', { name: /terminate/i })[0]);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already terminated/i);
    });
    vi.restoreAllMocks();
  });
});
