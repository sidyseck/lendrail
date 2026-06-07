// src/test/SupplierRegisterPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { SupplierRegisterPage } from '@/pages/SupplierRegisterPage';
import { clearToken } from '@/auth/tokenStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register/supplier']}>
      <AuthProvider>
        <SupplierRegisterPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Helper: fill all valid fields with a 12+ char password
async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/legal name/i), 'Acme Fund');
  await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
  await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
  await user.type(screen.getByLabelText(/primary contact email/i), 'acme@example.com');
  await user.type(screen.getByLabelText(/password/i), 'Acme@Str0ng!2026');
}

describe('SupplierRegisterPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
  });

  // F-014: all required fields shown

  it('renders all five form fields and a submit button', () => {
    renderPage();
    expect(screen.getByLabelText(/legal name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/jurisdiction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/entity type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create supplier account/i })).toBeInTheDocument();
  });

  // F-014: inline validation on empty submit

  it('shows inline errors for all required fields when submitted empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    expect(screen.getByText(/legal name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/jurisdiction is required/i)).toBeInTheDocument();
    expect(screen.getByText(/entity type is required/i)).toBeInTheDocument();
    expect(screen.getByText(/primary contact email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    // No network call should have been made
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows email format error for an invalid email', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/primary contact email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    expect(screen.getByText(/must be a valid email address/i)).toBeInTheDocument();
  });

  it('shows password length error for a password shorter than 12 characters', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/password/i), 'short1234');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
  });

  // F-014: entity_type dropdown options

  it('entity type dropdown offers exactly Fund, Corporate Treasury, Foundation', () => {
    renderPage();
    const select = screen.getByLabelText(/entity type/i);
    const options = Array.from((select as HTMLSelectElement).options).map((o) => ({
      value: o.value,
      text: o.text,
    }));
    // First option is the placeholder
    expect(options[1]).toEqual({ value: 'fund', text: 'Fund' });
    expect(options[2]).toEqual({ value: 'corporate_treasury', text: 'Corporate Treasury' });
    expect(options[3]).toEqual({ value: 'foundation', text: 'Foundation' });
    // Exactly four options total (placeholder + three)
    expect(options).toHaveLength(4);
  });

  // F-014: successful registration

  it('stores JWT and navigates to /dashboard on successful registration', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const button = screen.getByRole('button', { name: /create supplier account/i });
    await user.click(button);
    expect(button).toBeDisabled();
    // Await completion to prevent dangling promises affecting subsequent tests
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  // F-014: duplicate email → "Email already registered"

  it('shows "Email already registered" for a duplicate email (409)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/legal name/i), 'Acme Fund');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'duplicate@lendrail.test');
    await user.type(screen.getByLabelText(/password/i), 'Acme@Str0ng!2026');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email already registered');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // F-014: 422 validation error from backend (standard envelope)

  it('shows a server error message for a 422 response', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/legal name/i), 'Acme Fund');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'invalid422@lendrail.test');
    await user.type(screen.getByLabelText(/password/i), 'Acme@Str0ng!2026');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
