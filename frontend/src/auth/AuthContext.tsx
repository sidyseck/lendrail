import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { clearToken, getToken, setToken } from './tokenStore';

interface DecodedToken {
  sub: string; // user_id
  org_id: string | null; // nullable in M0 (backend AuthUser.org_id is optional)
  role: 'supplier' | 'agent' | 'admin';
  exp: number; // unix seconds
}

interface AuthState {
  isAuthenticated: boolean; // derived: token present AND not expired
  role: DecodedToken['role'] | null;
  orgId: string | null;
}

interface AuthContextValue extends AuthState {
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Decode the token and check the exp claim.
 * Returns null if the token is missing, malformed, or expired.
 * NOTE: this is an UNVERIFIED decode — used for UI hints only, never for authorization.
 */
function decodeAndValidate(token: string): DecodedToken | null {
  try {
    const decoded = jwtDecode<DecodedToken>(token);
    // FIX 4: check exp claim — expired token is treated as no token
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  const [authState, setAuthState] = useState<AuthState>(() => {
    // On mount: check whether a token already exists in the store.
    // After a hard browser refresh this will always be null — that is intentional.
    const existing = getToken();
    if (!existing) {
      return { isAuthenticated: false, role: null, orgId: null };
    }
    const decoded = decodeAndValidate(existing);
    if (!decoded) {
      clearToken();
      return { isAuthenticated: false, role: null, orgId: null };
    }
    return {
      isAuthenticated: true,
      role: decoded.role,
      orgId: decoded.org_id,
    };
  });

  const logout = useCallback(() => {
    clearToken();
    setAuthState({ isAuthenticated: false, role: null, orgId: null });
    // FIX 1: no refresh endpoint — redirect to /login with ?next= so the user can resume.
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    navigate(`/login?next=${next}`, { replace: true });
  }, [navigate]);

  const login = useCallback(
    (token: string) => {
      // FIX 4(a): check exp on token-set
      const decoded = decodeAndValidate(token);
      if (!decoded) {
        // Reject a token that is already expired at the moment of login.
        logout();
        return;
      }
      setToken(token);
      setAuthState({
        isAuthenticated: true,
        role: decoded.role,
        orgId: decoded.org_id,
      });
    },
    [logout],
  );

  // FIX 4(a): re-check expiry on every render cycle.
  // Covers the case where the app stays open past token expiry without a network call.
  useEffect(() => {
    if (!authState.isAuthenticated) return;
    const token = getToken();
    if (!token || !decodeAndValidate(token)) {
      logout();
    }
  });

  return (
    <AuthContext.Provider value={{ ...authState, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
