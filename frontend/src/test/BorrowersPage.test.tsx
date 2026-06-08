import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { clearToken, setToken } from '@/auth/tokenStore';
import { resetMockBorrowers } from '@/mocks/handlers/borrowers';
import { resetMockConnections } from '@/mocks/handlers/connections';
import { BorrowersPage } from '@/pages/borrowers/BorrowersPage';

const AGENT_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTAwMiIsIm9yZ19pZCI6Im9yZy0wMDIiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-sig';

function renderPage() {
  setToken(AGENT_TOKEN);
  return render(
    <MemoryRouter initialEntries={['/dashboard/borrowers']}>
      <AuthProvider>
        <BorrowersPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('BorrowersPage', () => {
  beforeEach(() => {
    clearToken();
    resetMockConnections();
    resetMockBorrowers();
  });

  it('creates and lists a managed borrower', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Blue River Trading')).toBeInTheDocument());
    await user.type(screen.getByLabelText(/^name$/i), 'Direct Borrower');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
    await user.type(screen.getByLabelText(/contact email/i), 'direct@example.com');
    await user.click(screen.getByRole('button', { name: /create borrower/i }));

    await waitFor(() => expect(screen.getByText('Direct Borrower')).toBeInTheDocument());
    expect(screen.getByText('direct@example.com')).toBeInTheDocument();
  });
});
