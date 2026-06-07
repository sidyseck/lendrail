import createClient, { type Middleware } from 'openapi-fetch';
import { jwtDecode } from 'jwt-decode';
import type { paths } from './types.gen';
import { clearToken, getToken } from '../auth/tokenStore';

function redirectToLogin(): void {
  const next = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
  window.location.replace(`/login?next=${next}`);
}

// FIX 4(b): check exp before attaching Authorization header
function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<{ exp?: number }>(token);
    return decoded.exp ? decoded.exp * 1000 < Date.now() : false;
  } catch {
    return true;
  }
}

const authMiddleware: Middleware = {
  async onRequest(request) {
    const token = getToken();

    if (!token) {
      // No token — pass request through unauthenticated.
      // Backend will return 401; the response handler below redirects.
      return request;
    }

    // FIX 4(b): expired token — redirect immediately, do not send the request
    if (isTokenExpired(token)) {
      clearToken();
      redirectToLogin();
      throw new Error('Token expired');
    }

    // Token present and valid — attach Bearer header
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return new Request(request, { headers });
  },

  async onResponse(response, _options, request) {
    // The login endpoint legitimately returns 401 for bad credentials — the
    // LoginPage renders that inline. Don't treat it as a session-expiry redirect.
    const isLoginRequest = new URL(request.url).pathname.endsWith('/auth/login');
    if (response.status === 401 && !isLoginRequest) {
      // FIX 1: no refresh endpoint — clear token and redirect to login.
      // Do NOT call any refreshToken() endpoint. None exists.
      clearToken();
      redirectToLogin();
      throw new Error('Unauthorized');
    }
    return response;
  },
};

// baseUrl is '<origin>/api' — Vite proxy strips the '/api' prefix before
// forwarding to http://api:8000. The origin is prepended (rather than a bare
// '/api') because the underlying fetch/Request implementation does not resolve
// relative URLs against the document origin in non-browser (test) runtimes.
const baseUrl =
  typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

export const apiClient = createClient<paths>({
  baseUrl,
  // Resolve globalThis.fetch lazily per call rather than capturing it at client
  // creation. This lets test-time interceptors (MSW) that patch the global fetch
  // after this module loads still take effect.
  fetch: (...args) => globalThis.fetch(...args),
});

apiClient.use(authMiddleware);
