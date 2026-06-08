// src/hooks/useConnectionAction.ts

import { useState } from 'react';

export interface UseConnectionActionReturn<T> {
  execute: (fn: () => Promise<T>) => Promise<T | null>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useConnectionAction<T = void>(): UseConnectionActionReturn<T> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function execute(fn: () => Promise<T>): Promise<T | null> {
    setIsLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  return { execute, isLoading, error, clearError: () => setError(null) };
}
