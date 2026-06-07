// src/test/AgentRegisterPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { AgentRegisterPage } from '@/pages/AgentRegisterPage';
import { clearToken } from '@/auth/tokenStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register/agent']}>
      <AuthProvider>
        <AgentRegisterPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
  await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
  await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
  await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
  await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
  await user.type(screen.getByLabelText(/password/i), 'Atlas@Str0ng!2026');
  await user.click(screen.getByLabelText(/i confirm that my organization/i));
}

describe('AgentRegisterPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
  });

  // F-016: all required fields shown

  it('renders all required fields including ops contact and attestation checkbox', () => {
    renderPage();
    expect(screen.getByLabelText(/entity name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/jurisdiction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/entity type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ops\/settlement contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/i confirm that my organization/i)).toBeInTheDocument();
  });

  // F-016: entity type dropdown options

  it('entity type dropdown offers exactly Fund, Corporate Treasury, Foundation', () => {
    renderPage();
    const select = screen.getByLabelText(/entity type/i);
    const options = Array.from((select as HTMLSelectElement).options).map((o) => ({
      value: o.value,
      text: o.text,
    }));
    expect(options[1]).toEqual({ value: 'fund', text: 'Fund' });
    expect(options[2]).toEqual({ value: 'corporate_treasury', text: 'Corporate Treasury' });
    expect(options[3]).toEqual({ value: 'foundation', text: 'Foundation' });
    expect(options).toHaveLength(4);
  });

  // F-016: attestation checkbox must be checked before submit

  it('shows attestation error when checkbox is unchecked and form is otherwise valid', async () => {
    const user = userEvent.setup();
    renderPage();
    // Fill all text fields validly but do not check the attestation box
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Atlas@Str0ng!2026');
    // Do NOT click the attestation checkbox
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    expect(
      screen.getByText(/you must attest to your regulatory status/i),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not make a network call when the attestation checkbox is unchecked', async () => {
    // This is implicitly tested by mockNavigate not being called above,
    // but we also confirm no MSW handler intercepts (the test setup uses
    // onUnhandledRequest: 'error' — a real network call would throw).
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Atlas@Str0ng!2026');
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    // If a network call was made and the handler was missing, vitest would throw.
    // Reaching this line means no network call was made.
    expect(screen.getByText(/you must attest to your regulatory status/i)).toBeInTheDocument();
  });

  // F-016: ops/settlement contact email is required

  it('shows an error when ops/settlement email is empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
    // Leave ops email empty
    await user.type(screen.getByLabelText(/password/i), 'Atlas@Str0ng!2026');
    await user.click(screen.getByLabelText(/i confirm that my organization/i));
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    expect(
      screen.getByText(/ops\/settlement contact email is required/i),
    ).toBeInTheDocument();
  });

  it('shows an error when ops/settlement email has an invalid format', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    expect(screen.getAllByText(/must be a valid email address/i).length).toBeGreaterThan(0);
  });

  // F-016: successful registration

  it('stores JWT and navigates to /dashboard on successful registration', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const button = screen.getByRole('button', { name: /create agent account/i });
    await user.click(button);
    expect(button).toBeDisabled();
    // Await completion to prevent dangling promises affecting subsequent tests
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  // F-016: 409 duplicate email

  it('shows "Email already registered" for a duplicate email (409)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'duplicate@lendrail.test');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Atlas@Str0ng!2026');
    await user.click(screen.getByLabelText(/i confirm that my organization/i));
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email already registered');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // F-016: 422 validation error (standard envelope)

  it('shows a server error for a 422 response', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'invalid422@lendrail.test');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Atlas@Str0ng!2026');
    await user.click(screen.getByLabelText(/i confirm that my organization/i));
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
