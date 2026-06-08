import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { clearToken, setToken } from '@/auth/tokenStore';
import { resetMockBorrowers } from '@/mocks/handlers/borrowers';
import { resetMockConnections } from '@/mocks/handlers/connections';
import { resetMockLoans } from '@/mocks/handlers/loans';
import { LoanListPage } from '@/pages/loans/LoanListPage';

const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage() {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/loans?connection_id=conn-002&asset_type=BTC']}>
      <AuthProvider>
        <LoanListPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoanListPage', () => {
  beforeEach(() => {
    clearToken();
    resetMockConnections();
    resetMockBorrowers();
    resetMockLoans();
  });

  it('books a loan from the compact strip above the loan list', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: /^book loan$/i })).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Blue River Trading' })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText(/approved borrower/i), 'borrower-001');
    await user.type(screen.getByLabelText(/^quantity$/i), '0.50');
    await user.type(screen.getByLabelText(/rate bps/i), '500');
    await user.type(screen.getByLabelText(/collateral quantity/i), '15000');
    await user.type(screen.getByLabelText(/collateral value usd/i), '15000');
    await user.click(screen.getByRole('button', { name: /^book$/i }));

    await waitFor(() => expect(screen.getByText('Booked Borrower')).toBeInTheDocument());
  });
});
