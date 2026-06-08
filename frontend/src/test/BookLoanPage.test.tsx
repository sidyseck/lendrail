import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { setToken, clearToken } from '@/auth/tokenStore';
import { resetMockBorrowers } from '@/mocks/handlers/borrowers';
import { resetMockConnections } from '@/mocks/handlers/connections';
import { resetMockLoans } from '@/mocks/handlers/loans';
import { BookLoanPage } from '@/pages/loans/BookLoanPage';

const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage() {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/book-loan?connection_id=conn-002&asset_type=BTC']}>
      <AuthProvider>
        <Routes>
          <Route path="/dashboard/book-loan" element={<BookLoanPage />} />
          <Route path="/dashboard/loans/:loanId" element={<div>Loan detail loaded</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('BookLoanPage', () => {
  beforeEach(() => {
    clearToken();
    resetMockConnections();
    resetMockBorrowers();
    resetMockLoans();
  });

  it('lets an agent create a borrower and book a loan', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/100\.0 BTC/i)).toBeInTheDocument());

    await user.type(screen.getByLabelText(/^name$/i), 'Direct Borrower');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
    await user.type(screen.getByLabelText(/contact email/i), 'direct@example.com');
    await user.click(screen.getByRole('button', { name: /create borrower/i }));

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Direct Borrower' })).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText(/^quantity$/i), '0.50');
    await user.type(screen.getByLabelText(/rate bps/i), '500');
    await user.type(screen.getByLabelText(/collateral quantity/i), '15000');
    await user.type(screen.getByLabelText(/collateral value usd/i), '15000');
    await user.click(screen.getByRole('button', { name: /^book loan$/i }));

    await waitFor(() => expect(screen.getByText(/loan detail loaded/i)).toBeInTheDocument());
  });
});
