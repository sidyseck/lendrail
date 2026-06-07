import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Maps the backend's error envelope to user-facing copy. The API returns
// terse codes/messages (e.g. code "unauthorized", message "invalid_credentials");
// we surface friendly text rather than the raw wire value.
function friendlyAuthError(code?: string, message?: string): string {
  if (code === 'unauthorized' || message === 'invalid_credentials') {
    return 'Email or password is incorrect';
  }
  return message ?? 'Sign in failed. Please try again.';
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // no full page reload
    setError(null);
    setIsLoading(true);

    try {
      const {
        data,
        error: apiError,
        response,
      } = await apiClient.POST('/auth/login', {
        body: { email, password },
      });

      if (!response.ok || apiError || !data) {
        // Read from the backend error envelope: { error: { code, message } }
        const envelope = (apiError as
          | { error?: { code?: string; message?: string } }
          | undefined)?.error;
        setError(friendlyAuthError(envelope?.code, envelope?.message));
        return;
      }

      // Success: store JWT in memory and redirect.
      login(data.access_token);

      // Respect ?next= so the user resumes where they were before the redirect.
      const next = searchParams.get('next');
      navigate(next ? decodeURIComponent(next) : '/dashboard', {
        replace: true,
      });
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">
          Sign in to LendRail
        </h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-4 flex flex-col gap-2 text-center text-sm text-gray-500">
          <p>
            New supplier?{' '}
            <Link to="/register/supplier" className="text-blue-600 hover:underline">
              Register as Supplier
            </Link>
          </p>
          <p>
            New agent?{' '}
            <Link to="/register/agent" className="text-blue-600 hover:underline">
              Register as Agent
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
