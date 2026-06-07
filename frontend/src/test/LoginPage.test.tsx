import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { clearToken } from '@/auth/tokenStore';

// Mock useNavigate so we can assert redirects without a full browser router.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
  });

  it('renders email and password fields and a submit button', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it('redirects to /dashboard on successful login', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'agent@lendrail.test');
    await user.type(screen.getByLabelText(/password/i), 'password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
        replace: true,
      });
    });
  });

  it('shows an inline error on invalid credentials without reloading', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'wrong@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // MSW mirrors the real backend: { error: { code: 'unauthorized', message: 'invalid_credentials' } }.
    // LoginPage maps that to friendly copy via friendlyAuthError().
    await waitFor(() => {
      expect(
        screen.getByText(/email or password is incorrect/i),
      ).toBeInTheDocument();
    });

    // No navigation occurred
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), 'agent@lendrail.test');
    await user.type(screen.getByLabelText(/password/i), 'password');

    const button = screen.getByRole('button', { name: /sign in/i });
    await user.click(button);

    // Button must be disabled immediately after click (before response arrives)
    expect(button).toBeDisabled();
  });
});
