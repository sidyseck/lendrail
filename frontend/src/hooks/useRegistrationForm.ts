import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/api/client';

export interface RegistrationResult {
  org_id: string;
  access_token: string;
  token_type: 'bearer';
}

export interface UseRegistrationFormReturn {
  isLoading: boolean;
  serverError: string | null;
  submitRegistration: (
    endpoint: '/orgs/register/supplier' | '/orgs/register/agent',
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

export function useRegistrationForm(): UseRegistrationFormReturn {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function submitRegistration(
    endpoint: '/orgs/register/supplier' | '/orgs/register/agent',
    payload: Record<string, unknown>,
  ): Promise<void> {
    setServerError(null);
    setIsLoading(true);

    try {
      const { data, error: apiError, response } = await apiClient.POST(endpoint, {
        body: payload as never,
      });

      if (response.status === 409) {
        setServerError('Email already registered');
        return;
      }

      if (response.status === 422) {
        const errBody = apiError as { error?: { message?: string } } | undefined;
        const msg =
          errBody?.error?.message ?? 'Validation failed. Please check your inputs.';
        setServerError(msg);
        return;
      }

      if (!response.ok || apiError || !data) {
        setServerError('Registration failed. Please try again.');
        return;
      }

      const result = data as RegistrationResult;
      login(result.access_token);
      navigate('/dashboard', { replace: true });
    } catch {
      setServerError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return { isLoading, serverError, submitRegistration };
}
