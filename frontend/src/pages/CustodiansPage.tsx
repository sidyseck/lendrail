// src/pages/CustodiansPage.tsx
//
// Supplier-only page for managing org-level custodian API keys.
// Lists registered custodians and provides a form to add a new one.

import React, { useEffect, useState } from 'react';
import { registerCustodian, listCustodians } from '@/api/custodiansApi';
import type { CustodianLink } from '@/api/custodiansApi';

function CustodianRow({ c }: { c: CustodianLink }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="py-3 pr-4 text-sm text-gray-800">{c.custodian_id}</td>
      <td className="py-3 pr-4 text-sm text-gray-600">{c.account_ref}</td>
      <td className="py-3 pr-4">
        <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
          {c.status}
        </span>
      </td>
      <td className="py-3 text-xs text-gray-400">
        {new Date(c.created_at).toLocaleDateString()}
      </td>
    </tr>
  );
}

interface FormState {
  custodianId: string;
  accountRef: string;
  plaintextKey: string;
}

const EMPTY_FORM: FormState = { custodianId: '', accountRef: '', plaintextKey: '' };

export function CustodiansPage() {
  const [custodians, setCustodians] = useState<CustodianLink[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await listCustodians();
      setCustodians(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load custodians.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function validate(): string | null {
    if (!form.custodianId.trim()) return 'Custodian ID is required.';
    if (!form.accountRef.trim()) return 'Account Reference is required.';
    if (!form.plaintextKey.trim()) return 'API Key is required.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    setSubmitError(null);
    setSuccessBanner(null);

    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }

    setIsSubmitting(true);
    try {
      await registerCustodian({
        custodian_id: form.custodianId.trim(),
        account_ref: form.accountRef.trim(),
        plaintext_key: form.plaintextKey,
      });
      setForm(EMPTY_FORM);
      setSuccessBanner(`Custodian "${form.custodianId.trim()}" registered successfully.`);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const displayError = validationError ?? submitError;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Custodians</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage custodian API keys for your organization. Keys are encrypted at rest.
        </p>
      </div>

      {/* Add Custodian form */}
      <div className="mb-8 border border-gray-200 rounded-lg p-5 bg-gray-50">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Register New Custodian</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="custodian-id" className="block text-sm font-medium text-gray-700 mb-1">
              Custodian ID
            </label>
            <input
              id="custodian-id"
              type="text"
              value={form.custodianId}
              onChange={(e) => setForm((f) => ({ ...f, custodianId: e.target.value }))}
              placeholder="e.g. fireblocks"
              className="w-full max-w-sm border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="account-ref" className="block text-sm font-medium text-gray-700 mb-1">
              Account Reference
            </label>
            <input
              id="account-ref"
              type="text"
              value={form.accountRef}
              onChange={(e) => setForm((f) => ({ ...f, accountRef: e.target.value }))}
              placeholder="e.g. vault-123"
              className="w-full max-w-sm border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="plaintext-key" className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            {/* type="password" prevents browser from logging/autocompleting secrets */}
            <input
              id="plaintext-key"
              type="password"
              autoComplete="new-password"
              value={form.plaintextKey}
              onChange={(e) => setForm((f) => ({ ...f, plaintextKey: e.target.value }))}
              className="w-full max-w-sm border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>

          {displayError && (
            <p role="alert" className="text-sm text-red-600">
              {displayError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Registering…' : 'Register Custodian'}
          </button>
        </form>
      </div>

      {successBanner && (
        <div className="mb-4 rounded bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {successBanner}
        </div>
      )}

      {/* Custodian list */}
      <h2 className="text-base font-semibold text-gray-800 mb-3">Registered Custodians</h2>

      {isLoading && <p className="text-sm text-gray-500">Loading custodians…</p>}

      {!isLoading && loadError && (
        <p role="alert" className="text-sm text-red-600">{loadError}</p>
      )}

      {!isLoading && !loadError && custodians.length === 0 && (
        <p className="text-sm text-gray-500">No custodians registered yet.</p>
      )}

      {!isLoading && !loadError && custodians.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Custodian ID</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Account Ref</th>
              <th className="py-2 pr-4 text-left font-medium text-gray-600">Status</th>
              <th className="py-2 text-left font-medium text-gray-600">Registered</th>
            </tr>
          </thead>
          <tbody>
            {custodians.map((c) => (
              <CustodianRow key={c.custodian_link_id} c={c} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
