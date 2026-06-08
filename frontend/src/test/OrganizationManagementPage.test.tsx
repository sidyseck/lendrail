import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { OrganizationManagementPage } from '@/pages/OrganizationManagementPage';
import { clearToken, setToken } from '@/auth/tokenStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const SUPPLIER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMSIsIm9yZ19pZCI6Im9yZy0wMDEiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage() {
  setToken(SUPPLIER_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/organization']}>
      <AuthProvider>
        <OrganizationManagementPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('OrganizationManagementPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearToken();
  });

  it('renders organization, account, user, and role placeholders', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: /organization management/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save organization name/i })).toBeInTheDocument();
    expect(screen.getByText(/organization id/i)).toBeInTheDocument();
    expect(screen.getByText(/initial creator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
    expect(screen.getByText(/supplier write: manage inventory scope/i)).toBeInTheDocument();
    expect(screen.getByText(/agent lender write: onboard borrowers/i)).toBeInTheDocument();
  });

  it('creates an account and attaches a user with a role', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/legal entity name/i), 'Meridian BTC Treasury');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Wyoming, US');
    await user.selectOptions(screen.getByLabelText(/account type/i), 'supplier');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.getAllByText('Meridian BTC Treasury').length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText(/full name/i), 'Morgan Chen');
    await user.type(screen.getByLabelText(/^email$/i), 'morgan@example.com');
    await user.selectOptions(screen.getByLabelText(/^account$/i), 'Meridian BTC Treasury');
    await user.selectOptions(screen.getByLabelText(/^role$/i), 'Supplier Operator (write)');
    await user.click(screen.getByRole('button', { name: /create user/i }));

    expect(screen.getByText('Morgan Chen')).toBeInTheDocument();
    expect(screen.getByText('morgan@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Supplier Operator').length).toBeGreaterThan(0);
  });
});
