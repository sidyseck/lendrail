// src/test/AgreementTermsForm.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgreementTermsForm } from '@/components/agreements/AgreementTermsForm';

function renderForm(overrides?: Partial<Parameters<typeof AgreementTermsForm>[0]>) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <AgreementTermsForm
      onSubmit={onSubmit}
      isSubmitting={false}
      submitError={null}
      {...overrides}
    />,
  );
  return { onSubmit };
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
  await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
  await user.clear(screen.getByLabelText(/initial ltv/i));
  await user.type(screen.getByLabelText(/initial ltv/i), '65');
  await user.clear(screen.getByLabelText(/margin call ltv/i));
  await user.type(screen.getByLabelText(/margin call ltv/i), '80');
  await user.clear(screen.getByLabelText(/recall notice/i));
  await user.type(screen.getByLabelText(/recall notice/i), '2');
  await user.clear(screen.getByLabelText(/max loan days/i));
  await user.type(screen.getByLabelText(/max loan days/i), '90');
  await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
  await user.clear(screen.getByLabelText(/agent fee/i));
  await user.type(screen.getByLabelText(/agent fee/i), '50');
}

describe('AgreementTermsForm', () => {
  it('renders all 8 form fields', () => {
    renderForm();
    expect(screen.getByLabelText(/assets in scope/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/eligible collateral/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/initial ltv/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/margin call ltv/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recall notice/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max loan days/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/day count basis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/agent fee/i)).toBeInTheDocument();
  });

  it('disables submit button while isSubmitting=true', () => {
    renderForm({ isSubmitting: true });
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled();
  });

  it('displays submitError when provided', () => {
    renderForm({ submitError: 'Server error occurred' });
    expect(screen.getByRole('alert')).toHaveTextContent('Server error occurred');
  });

  it('shows validation error for empty assets_in_scope', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /assets in scope/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('shows validation error for empty eligible_collateral', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.some((a) => /eligible collateral/i.test(a.textContent ?? ''))).toBe(true);
    });
  });

  it('calls onSubmit with correctly serialized arrays for assets_in_scope', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const values = onSubmit.mock.calls[0][0] as { assets_in_scope: string };
    expect(values.assets_in_scope).toBe('BTC');
  });

  it('cross-field validation: margin_call_ltv_pct must exceed initial_ltv_pct', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/assets in scope/i), 'BTC');
    await user.type(screen.getByLabelText(/eligible collateral/i), 'USDC');
    await user.type(screen.getByLabelText(/initial ltv/i), '65');
    await user.type(screen.getByLabelText(/margin call ltv/i), '60'); // less than initial
    await user.type(screen.getByLabelText(/recall notice/i), '2');
    await user.type(screen.getByLabelText(/max loan days/i), '90');
    await user.selectOptions(screen.getByLabelText(/day count basis/i), 'actual_360');
    await user.type(screen.getByLabelText(/agent fee/i), '50');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((a) => /margin call.*greater than.*initial/i.test(a.textContent ?? '')),
      ).toBe(true);
    });
  });
});
