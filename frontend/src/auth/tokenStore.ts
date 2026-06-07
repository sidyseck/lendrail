// Module-level variable — never persisted to storage.
// This is the only location in the codebase that holds the raw token string.

let _token: string | null = null;

export function getToken(): string | null {
  return _token;
}

export function setToken(token: string): void {
  _token = token;
}

export function clearToken(): void {
  _token = null;
}
