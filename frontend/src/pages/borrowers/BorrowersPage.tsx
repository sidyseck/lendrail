import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { createBorrower, listBorrowers } from '@/api/borrowerApi';
import { useAuth } from '@/auth/AuthContext';
import { useConnections } from '@/hooks/useConnections';
import type { BorrowerDetail } from '@/types/borrower';

interface FormValues {
  name: string;
  jurisdiction: string;
  contact_email: string;
  connection_id: string;
}

const EMPTY_FORM: FormValues = {
  name: '',
  jurisdiction: '',
  contact_email: '',
  connection_id: '',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function BorrowersPage() {
  const { role } = useAuth();
  const { connections, isLoading: connectionsLoading } = useConnections();
  const [borrowers, setBorrowers] = useState<BorrowerDetail[]>([]);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const activeConnections = connections.filter((connection) => connection.status === 'active');

  const loadBorrowers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setBorrowers(await listBorrowers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load borrowers.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBorrowers();
  }, [loadBorrowers]);

  if (role !== 'agent') return <Navigate to="/dashboard/loans" replace />;

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await createBorrower({
        name: values.name,
        jurisdiction: values.jurisdiction,
        contact_email: values.contact_email,
        connection_id: values.connection_id || undefined,
      });
      setValues(EMPTY_FORM);
      setSuccess('Borrower created.');
      await loadBorrowers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create borrower.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Borrowers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Onboard and manage borrower records before booking loans.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}

      <section aria-labelledby="create-borrower-heading" className="border-b border-gray-200 pb-6">
        <h2 id="create-borrower-heading" className="mb-4 text-lg font-semibold text-gray-900">
          Create Borrower
        </h2>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Name</span>
            <input
              required
              value={values.name}
              onChange={(event) => updateValue('name', event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Jurisdiction</span>
            <input
              required
              value={values.jurisdiction}
              onChange={(event) => updateValue('jurisdiction', event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Contact Email</span>
            <input
              required
              type="email"
              value={values.contact_email}
              onChange={(event) => updateValue('contact_email', event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Supplier Connection</span>
            <select
              value={values.connection_id}
              onChange={(event) => updateValue('connection_id', event.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
              disabled={connectionsLoading}
            >
              <option value="">Do not link yet</option>
              {activeConnections.map((connection) => (
                <option key={connection.connection_id} value={connection.connection_id}>
                  {connection.supplier_id.slice(0, 8)}...
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSaving ? 'Creating...' : 'Create Borrower'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="managed-borrowers-heading">
        <h2 id="managed-borrowers-heading" className="mb-4 text-lg font-semibold text-gray-900">
          Managed Borrowers
        </h2>
        {isLoading && <p className="text-sm text-gray-500">Loading borrowers...</p>}
        {!isLoading && borrowers.length === 0 && (
          <p className="text-sm text-gray-500">No borrowers have been created yet.</p>
        )}
        {!isLoading && borrowers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Name</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Jurisdiction</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Contact</th>
                  <th className="py-2 pr-4 text-left font-medium text-gray-600">Status</th>
                  <th className="py-2 text-left font-medium text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody>
                {borrowers.map((borrower) => (
                  <tr key={borrower.id} className="border-b border-gray-100">
                    <td className="py-3 pr-4 text-gray-900">{borrower.name}</td>
                    <td className="py-3 pr-4 text-gray-700">{borrower.jurisdiction}</td>
                    <td className="py-3 pr-4 text-gray-700">{borrower.contact_email}</td>
                    <td className="py-3 pr-4 capitalize text-gray-700">{borrower.status}</td>
                    <td className="py-3 text-gray-600">{formatDate(borrower.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
