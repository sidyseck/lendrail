import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { clearToken, setToken } from '@/auth/tokenStore';
import { resetMockAgreements } from '@/mocks/handlers/agreements';
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
    resetMockAgreements();
  });

  it('books a loan from the redesigned ticket above the loan list', async () => {
    const user = userEvent.setup();
    renderPage();

    // Ticket is expanded by default because we arrived with ?connection_id&asset_type.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^book loan$/i })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Blue River Trading' })).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByLabelText(/approved borrower/i), 'borrower-001');
    await user.type(screen.getByLabelText(/^quantity$/i), '0.50');

    // Price may have been snapshotted from the stream; clear before typing.
    await user.clear(screen.getByLabelText(/asset price usd/i));
    await user.type(screen.getByLabelText(/asset price usd/i), '63500');

    // Gap B: agreement agr-001 on conn-002 pre-fills booking 65 / margin 80 / liquidation 90.
    // Clear each LTV field before re-typing so we do not append onto the default.
    await user.clear(screen.getByLabelText(/booking ltv/i));
    await user.type(screen.getByLabelText(/booking ltv/i), '50');
    await user.clear(screen.getByLabelText(/margin call ltv/i));
    await user.type(screen.getByLabelText(/margin call ltv/i), '80');
    await user.clear(screen.getByLabelText(/liquidation ltv/i));
    await user.type(screen.getByLabelText(/liquidation ltv/i), '90');

    await user.type(screen.getByLabelText(/rate bps/i), '500');

    // Default collateral type is CASH_USD, so collateral quantity is locked and not
    // rendered as an input — drive the collateral VALUE; quantity mirrors it.
    expect(screen.queryByLabelText(/collateral quantity/i)).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(/collateral value usd/i));
    await user.type(screen.getByLabelText(/collateral value usd/i), '15000');

    // SPEC §8: an explicit confirmation step precedes the POST.
    await user.click(screen.getByRole('button', { name: /review booking/i }));
    await user.click(screen.getByRole('button', { name: /confirm & book loan/i }));

    await waitFor(() => expect(screen.getByText('Booked Borrower')).toBeInTheDocument());
  });
});
