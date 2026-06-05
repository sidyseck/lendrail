# LendRail — M0 (Foundation) Frontend Technical Specification

| Field | Value |
|---|---|
| Milestone | M0 — Foundation (frontend only) |
| Scope | **F-010** (React + Vite auth scaffold) + the **F-060 frontend obligation** (`npm run generate-client`) |
| Based on | MASTER_PRD.md v0.1, ARCHITECTURE.md v0.2, FEATURES.md, specs/M0-backend-techspec.md (the API contract) |
| Status | Implementation-ready spec |
| Audience | Frontend engineer implementing M0 |

---

## 0. Purpose and guiding principles

F-010 scaffolds the entire frontend and nothing domain-specific. The deliverable is: a React + TypeScript + Vite app served by Vite on `localhost:5173`, styled with Tailwind + shadcn/ui, routed with React Router v6, an in-memory auth context that stores and forwards the JWT, a login page that calls `POST /auth/login`, a `ProtectedRoute` wrapper, an empty dashboard shell, and placeholder route shells for `/register/supplier` and `/register/agent` (their real forms are M1: F-014, F-016). It also folds in the F-060 frontend half: a `npm run generate-client` script that runs `openapi-typescript` against the backend's `/openapi.json` to produce `src/api/types.gen.ts`.

Non-negotiable conventions:

- **Token in memory only.** The JWT lives in React state (and a module-level holder for the non-React API client), **never** `localStorage`/`sessionStorage`/cookies. This is an explicit F-010 acceptance criterion. The page-refresh tradeoff is documented and accepted (§4.4).
- **Generated types are the single source of truth.** `src/api/types.gen.ts` is generated from `/openapi.json`. Hand-written code **must not** redefine backend DTOs (`LoginRequest`, `TokenResponse`, the error envelope). It imports them from the generated file. (F-060.)
- **Backend contract is fixed.** Login is `POST /auth/login` → `{ "access_token": "...", "token_type": "bearer" }` on 200, `{ "error": { "code": "unauthorized", "message": "..." } }` with HTTP 401 on bad credentials. Every error response across the API uses the envelope `{"error":{"code","message"}}`. The JWT carries `sub` (user_id), `org_id` (nullable in M0), `role` claims. (Backend spec §6, §14.)
- **Everything local via Docker Compose.** Vite dev server on 5173; backend api on 8000. In the browser, calls go to `/api/*` and Vite's dev proxy forwards them to the api container — this keeps the JWT/CORS story clean (same-origin from the browser's perspective, no CORS preflight, no backend CORS config needed for local dev). (§2.3.)
- **Thin M0.** Only login + protected empty dashboard + route shells. No domain pages, no role-specific navigation, no API methods beyond `login()` and one protected smoke call (`GET /auth/me`).
- **`tsc --noEmit` is zero-error, enforced in CI.** (F-010 acceptance + §8.)

> **Opinionated choice (justified inline where non-obvious):** no Next.js, no Redux, no React Query in M0. The architecture (§2) already rules out SSR. State is tiny (one token + one user), so a single React context plus a hand-written fetch wrapper is the right weight. React Query / TanStack arrives when domain data fetching does (M1+), not now.

---

## 1. Directory & file layout

Complete proposed `frontend/` tree:

```
frontend/
├── Dockerfile                       # dev image (Node 20), see §3
├── .dockerignore
├── index.html                       # Vite entry HTML, mounts #root
├── package.json                     # pinned deps + scripts (§10)
├── package-lock.json
├── tsconfig.json                    # references app + node configs
├── tsconfig.app.json                # strict app config (§2.2)
├── tsconfig.node.json               # config for vite.config.ts itself
├── vite.config.ts                   # dev server host/port + /api proxy (§2.1)
├── tailwind.config.ts               # Tailwind + shadcn theme tokens (§2.4)
├── postcss.config.js                # tailwindcss + autoprefixer
├── components.json                  # shadcn/ui CLI config (§2.4)
├── .eslintrc.cjs                    # ESLint flat-compat config (§2.5)
├── .prettierrc.json                 # Prettier config (§2.5)
├── .env.development                 # VITE_API_BASE_URL=/api (proxied)
├── .env.example                     # documents every VITE_* var
├── vitest.config.ts                 # test config, jsdom env (§9)
└── src/
    ├── main.tsx                     # ReactDOM root, mounts <App/> in <BrowserRouter>
    ├── App.tsx                      # <AuthProvider><AppRouter/></AuthProvider>
    ├── index.css                    # Tailwind directives + shadcn CSS variables
    ├── vite-env.d.ts                # Vite client types + ImportMetaEnv typing
    ├── app/
    │   └── router.tsx               # route table, ProtectedRoute composition (§6)
    ├── auth/
    │   ├── AuthContext.tsx          # context object + types (§4)
    │   ├── AuthProvider.tsx         # provider implementation (state, login, logout)
    │   ├── useAuth.ts               # hook with null-guard
    │   └── ProtectedRoute.tsx       # redirect-to-/login wrapper (§6.2)
    ├── api/
    │   ├── types.gen.ts             # GENERATED by openapi-typescript — do not edit (§5)
    │   ├── client.ts                # typed fetch wrapper: Bearer + error envelope (§5)
    │   ├── tokenStore.ts            # module-level in-memory token holder (§4.3)
    │   ├── ApiError.ts              # typed error class for the envelope (§5.2)
    │   └── auth.ts                  # login()/me() thin endpoint functions (§5.3)
    ├── pages/
    │   ├── Login.tsx                # login form (§7)
    │   ├── Dashboard.tsx            # empty protected shell
    │   ├── RegisterSupplier.tsx     # M1 placeholder shell (route exists now)
    │   ├── RegisterAgent.tsx        # M1 placeholder shell (route exists now)
    │   └── NotFound.tsx             # 404 fallback
    ├── components/
    │   ├── ui/                      # shadcn/ui primitives (generated by CLI)
    │   │   ├── button.tsx
    │   │   ├── input.tsx
    │   │   ├── label.tsx
    │   │   ├── card.tsx
    │   │   └── alert.tsx
    │   └── layout/
    │       └── AppShell.tsx         # minimal authed layout (header + <Outlet/>)
    └── lib/
        └── utils.ts                 # cn() — clsx + tailwind-merge (shadcn convention)

frontend/src/__tests__/             # OR colocated *.test.tsx (see §9)
    ├── setup.ts                     # RTL + jest-dom + MSW server lifecycle
    ├── mocks/
    │   ├── server.ts                # MSW node server
    │   └── handlers.ts              # /api/auth/login handlers (success + 401)
    ├── Login.test.tsx
    ├── ProtectedRoute.test.tsx
    ├── AuthProvider.test.tsx
    └── client.test.ts
```

Top-level repo files this feature touches (jointly owned with F-001):

```
/docker-compose.yml      # the `frontend` service entry (command, port, depends_on) — §3
```

---

## 2. Tooling & build config

### 2.1 Vite config — dev server + proxy

The browser always calls `/api/...`; Vite proxies to the api container. This means: no CORS in local dev, no hardcoded `http://localhost:8000` in app code, and the same code works in Docker (where the backend host is `api`, not `localhost`).

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// In Docker the backend is reachable as http://api:8000; on bare metal as http://localhost:8000.
// Driven by an env var so the same config serves both.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }, // matches tsconfig paths
  },
  server: {
    host: true,        // bind 0.0.0.0 so the container port is reachable (== `npm run dev -- --host`)
    port: 5173,
    strictPort: true,  // fail loudly rather than silently picking another port
    proxy: {
      // Browser → /api/auth/login  ⇒  api container /auth/login
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
```

> **Choice:** proxy `/api` → backend root and strip the prefix, rather than the backend mounting routes under `/api`. The backend spec mounts routers at `/auth/login`, `/healthz` (no `/api` prefix), so the rewrite keeps the backend contract untouched and the frontend origin clean. `VITE_API_PROXY_TARGET` is `http://api:8000` inside Docker (set in compose), `http://localhost:8000` for bare-metal dev (default).

`VITE_API_BASE_URL=/api` (in `.env.development`) is what the fetch client prepends to every path; it is the only base-URL knob app code sees.

### 2.2 TypeScript config (strict)

```jsonc
// tsconfig.json  (solution-style, references the two real configs)
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

```jsonc
// tsconfig.app.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "useDefineForClassFields": true,

    "strict": true,                         // F-010: tsc --noEmit must be clean under strict
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,       // safer indexing; pairs well with generated types
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,

    "skipLibCheck": true,                   // skip d.ts of deps; our own code is still fully checked
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,                         // Vite/esbuild emits; tsc is type-check only

    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

```jsonc
// tsconfig.node.json — just for vite.config.ts / vitest.config.ts tooling files
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

> **Choice:** `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` on. The generated OpenAPI types make heavy use of optional fields; these flags surface "could be undefined" at compile time so the login flow can't silently read a missing `access_token`.

### 2.3 The JWT/CORS story (why the proxy)

In Docker, the React bundle is served from `http://localhost:5173`; the API is `http://api:8000` (internal) / `http://localhost:8000` (host). If the browser called the API origin directly, every request would be cross-origin → CORS preflight → the backend would need CORS middleware. By calling same-origin `/api/...` and letting Vite's dev server proxy server-side, **the browser sees one origin**, no preflight, and the `Authorization: Bearer` header passes straight through. The backend spec ships **no CORS config** for local dev — this proxy is why that's fine. (Production swaps this for a real reverse proxy / same-domain deploy; out of M0 scope.)

### 2.4 Tailwind + shadcn/ui setup

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // shadcn token bridge — values come from CSS variables in index.css
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)" },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

```jsonc
// components.json  (shadcn/ui CLI config — drives `npx shadcn add ...`)
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" }
}
```

`src/index.css` holds `@tailwind base; @tailwind components; @tailwind utilities;` plus the shadcn `:root` / `.dark` CSS-variable blocks. `src/lib/utils.ts` exports the standard `cn()`:

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

> **Choice:** shadcn/ui components are **vendored into `src/components/ui/`** via the CLI (not an npm dependency). M0 only needs `button`, `input`, `label`, `card`, `alert` for the login page. Add more per-feature later. This is the documented shadcn pattern and matches ARCHITECTURE §2 ("unstyled-but-polished primitives; no vendor lock-in").

### 2.5 ESLint / Prettier

```js
// .eslintrc.cjs
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { project: ["./tsconfig.app.json"], tsconfigRootDir: __dirname },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:react-hooks/recommended",
    "prettier", // disables stylistic rules that conflict with Prettier
  ],
  ignorePatterns: ["dist", "src/api/types.gen.ts"], // never lint generated output
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    "@typescript-eslint/no-explicit-any": "error", // F-060: no `any` casts around the API client
  },
};
```

```jsonc
// .prettierrc.json
{ "semi": true, "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```

> **Choice:** `recommended-type-checked` (typed linting) so rules like `no-floating-promises` catch an un-awaited `login()`. The generated `types.gen.ts` is excluded from lint (it's a build artifact) but **not** from `tsc` — it must still type-check.

---

## 3. Docker integration

### `frontend/Dockerfile` (dev)

```dockerfile
# frontend/Dockerfile — DEV image. Production build (multi-stage + nginx) is out of M0 scope.
FROM node:20-slim
WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# App source (also bind-mounted in compose for hot reload)
COPY . .

EXPOSE 5173
# --host makes Vite bind 0.0.0.0 so the published port is reachable from the host
CMD ["npm", "run", "dev", "--", "--host"]
```

### docker-compose `frontend` service

Matches what the backend spec (§3) already references (`command: npm run dev -- --host`, port 5173, `depends_on: api`):

```yaml
# docker-compose.yml (frontend service — the rest of the stack is owned by F-001/backend)
  frontend:
    build: ./frontend
    command: npm run dev -- --host
    environment:
      # Inside the compose network the backend is reachable as http://api:8000
      VITE_API_PROXY_TARGET: http://api:8000
    ports: ["5173:5173"]
    volumes:
      - ./frontend:/app          # source bind-mount for HMR
      - /app/node_modules        # anonymous volume: keep container's node_modules, don't shadow with host
    depends_on: [api]
```

> **Notes.** (1) `VITE_API_PROXY_TARGET=http://api:8000` is read by `vite.config.ts` so the dev-server proxy targets the api **container** (service DNS name), not `localhost`. The browser still only ever sees `/api`. (2) The anonymous `node_modules` volume prevents the host (possibly empty / wrong-arch) `node_modules` from shadowing the image's. (3) `depends_on: [api]` orders startup but does **not** wait for the api to be ready; the frontend tolerates an unavailable backend (login simply fails until the api answers) — no readiness gate needed for a dev SPA. (4) The F-001 acceptance criteria "`curl http://localhost:5173` returns HTML" and full `compose down -v` / `up` are satisfied by this service; they are jointly owned with F-001 at integration time (backend spec §17, deferred minor 4).

---

## 4. Auth context & token handling

### 4.1 The AuthContext shape (TypeScript interface)

```ts
// src/auth/AuthContext.tsx
import { createContext } from "react";

/** Decoded, app-facing identity. Derived from the JWT claims (sub/org_id/role). */
export interface AuthUser {
  userId: string;
  orgId: string | null; // nullable in M0 — backend sets org_id once orgs exist (M1)
  role: "supplier" | "agent" | "admin";
}

export interface AuthState {
  /** The raw JWT, or null when logged out. Lives in memory only. */
  token: string | null;
  /** Decoded identity, or null when logged out. */
  user: AuthUser | null;
  /** True after the very first render settles (always immediate in M0 — see §4.4). */
  isAuthenticated: boolean;
}

export interface AuthContextValue extends AuthState {
  /**
   * Calls POST /auth/login. On success stores the token in memory (state + module holder)
   * and resolves. On failure throws an ApiError carrying the backend envelope — the caller
   * (Login page) renders the message inline. Never throws on a 200.
   */
  login: (email: string, password: string) => Promise<void>;
  /** Clears the token from state and the module holder. Pure client-side. */
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
```

### 4.2 The provider

```tsx
// src/auth/AuthProvider.tsx
import { useCallback, useMemo, useState } from "react"; // (useCallback/useState/useMemo)
import { AuthContext, type AuthContextValue, type AuthUser } from "./AuthContext";
import { setToken as setTokenInStore, clearToken } from "@/api/tokenStore";
import { login as loginRequest } from "@/api/auth";

// Minimal JWT payload decode (base64url of the middle segment). No verification —
// the backend already verified the signature; the client only needs the claims to
// render role-aware UI later. We do NOT trust this for authorization decisions.
function decodeClaims(token: string): AuthUser {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return {
    userId: String(payload.sub),
    orgId: payload.org_id ? String(payload.org_id) : null,
    role: payload.role,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const { access_token } = await loginRequest({ email, password }); // throws ApiError on 401
    setTokenInStore(access_token); // module holder → used by the non-React fetch client
    setTokenState(access_token); // React state → drives ProtectedRoute / re-render
    setUser(decodeClaims(access_token));
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, isAuthenticated: token !== null, login, logout }),
    [token, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

```ts
// src/auth/useAuth.ts
import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./AuthContext";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
```

### 4.3 Token storage — in memory, two places, one source of truth

The token lives in **React state** (drives re-render / route guards) and is **mirrored** into a module-level holder so the non-React fetch client can read it synchronously on every request:

```ts
// src/api/tokenStore.ts
// Module-singleton token holder. NOT persisted. Cleared on full page reload.
// The fetch client reads getToken() to attach the Bearer header; AuthProvider is the
// only writer (keeps it in lockstep with React state).
let _token: string | null = null;
export function setToken(t: string): void {
  _token = t;
}
export function clearToken(): void {
  _token = null;
}
export function getToken(): string | null {
  return _token;
}
```

> **Choice:** mirror rather than read context inside the client. The fetch client is a plain function called outside React's render tree; it can't use hooks. The module holder gives it synchronous access while `AuthProvider` remains the single writer, so state and holder never diverge.

### 4.4 The page-refresh tradeoff (explicit)

Because the token is in memory only (per the F-010 acceptance criterion: "stores the token in memory (not `localStorage`)"), **a full browser refresh or new tab loses the session** — `getToken()` returns `null`, `isAuthenticated` is `false`, and `ProtectedRoute` bounces the user to `/login`. This is the intended security posture for M0 (no token sitting in `localStorage` where XSS could exfiltrate it).

Mitigations and their status:
- **Silent re-login / refresh-token rotation: OUT OF SCOPE for M0.** The backend issues a single short-lived access token (`JWT_EXPIRES_MINUTES`, default 60) and has no `/auth/refresh` endpoint. Documented limitation, accepted.
- **httpOnly refresh cookie:** the production-grade answer (refresh token in an httpOnly cookie, access token in memory) is deferred — it needs a backend endpoint that does not exist in M0.
- **M0 behavior:** after refresh the user simply logs in again. Acceptable for a foundation milestone with no persisted domain data to lose.

This limitation is called out here so a tech lead signs off on it deliberately rather than discovering it in QA.

---

## 5. API client layer

### 5.1 Generated types (`npm run generate-client`)

`openapi-typescript` reads the backend's live `/openapi.json` and emits `src/api/types.gen.ts`. This file is the **single source of truth** for every request/response shape (F-060). Hand-written code imports from it and never re-declares a backend DTO.

```jsonc
// package.json (scripts excerpt) — full file in §10
{
  "scripts": {
    "generate-client": "openapi-typescript http://localhost:8000/openapi.json -o src/api/types.gen.ts"
  }
}
```

- Run locally against the running backend (`docker compose up api`, then `npm run generate-client`).
- The generated file exposes a `paths` interface (operations keyed by path + method) and a `components["schemas"]` map. We extract named shapes from it:

```ts
// Convenience aliases living in client.ts (NOT redefinitions — they reference generated types)
import type { paths, components } from "@/api/types.gen";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type TokenResponse = components["schemas"]["TokenResponse"];
// The backend error envelope component, if named in the schema; otherwise typed in §5.2.
```

> **Decision:** `types.gen.ts` is committed to the repo (not gitignored). Reason: CI and `tsc` must type-check without a live backend, and reviewers should see schema diffs in PRs. Regeneration is a deliberate, reviewable step — drift is caught in code review and by the CI gate (§8), not hidden behind a build step. The file carries a `// AUTO-GENERATED — do not edit. Run: npm run generate-client` banner (and is ESLint-ignored, §2.5).

### 5.2 Typed error for the envelope

Every non-2xx response from the backend is `{"error":{"code","message"}}` (backend spec §14). The client parses it into a typed `ApiError`:

```ts
// src/api/ApiError.ts
/** Mirrors the backend error envelope: { "error": { "code", "message" } }. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
  static isApiError(e: unknown): e is ApiError {
    return e instanceof ApiError;
  }
}
```

### 5.3 The typed fetch wrapper

A single low-level `request<T>()` that (a) prepends the base URL, (b) attaches the Bearer token from `tokenStore` to **every** request, (c) parses the error envelope into `ApiError`, (d) returns the typed body.

```ts
// src/api/client.ts
import { getToken } from "./tokenStore";
import { ApiError, type ApiErrorBody } from "./ApiError";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api"; // "/api" → Vite proxy → backend

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // (b) attach Bearer to every request when a token is present
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    // (c) parse the backend envelope { error: { code, message } } into a typed ApiError
    let code = "unknown_error";
    let message = res.statusText || "Request failed";
    try {
      const data = (await res.json()) as Partial<ApiErrorBody>;
      if (data.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
      }
    } catch {
      /* non-JSON body (e.g. proxy 502) — keep the status-text fallback */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T; // (d) caller supplies the generated type as T
}
```

### 5.4 The `login()` call, end to end

```ts
// src/api/auth.ts
import { request } from "./client";
import type { LoginRequest, TokenResponse } from "./client"; // aliases over generated types
import type { components } from "./types.gen";

export function login(body: LoginRequest): Promise<TokenResponse> {
  // T is the generated TokenResponse → { access_token: string; token_type: "bearer" }
  return request<TokenResponse>("/auth/login", { method: "POST", body });
}

// Protected smoke call used to prove the Bearer token is attached (backend GET /auth/me).
export function me(): Promise<components["schemas"]["AuthUserResponse"] | Record<string, unknown>> {
  return request("/auth/me");
}
```

End-to-end trace of a successful login:

1. `Login.tsx` calls `await auth.login(email, password)`.
2. `AuthProvider.login` calls `loginRequest({ email, password })` → `request<TokenResponse>("/auth/login", …)`.
3. `request` POSTs to `/api/auth/login`; Vite proxy strips `/api` → backend `POST /auth/login`.
4. Backend returns `200 { "access_token": "...", "token_type": "bearer" }` (or `401 { "error": { "code": "unauthorized", … } }`).
5. On 200: `request` returns the typed `TokenResponse`; `AuthProvider` calls `setTokenInStore(access_token)` (module holder) + `setTokenState` (React state) + decodes claims into `user`.
6. From this point every `request()` reads `getToken()` and sends `Authorization: Bearer <jwt>` — verifiable in the browser network tab (F-010 criterion).
7. On 401: `request` throws `ApiError(401, "unauthorized", "...")`; it propagates out of `login()`; `Login.tsx` catches it and renders the message inline (no reload).

---

## 6. Routing

### 6.1 Router setup

React Router v6. `BrowserRouter` is mounted in `main.tsx`; the route table is `app/router.tsx`.

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

```tsx
// src/App.tsx
import { AuthProvider } from "./auth/AuthProvider";
import { AppRouter } from "./app/router";

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
```

```tsx
// src/app/router.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import RegisterSupplier from "@/pages/RegisterSupplier";
import RegisterAgent from "@/pages/RegisterAgent";
import NotFound from "@/pages/NotFound";

export function AppRouter() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<Login />} />
      {/* M1 placeholders — routes/shell exist now; real forms are F-014 / F-016 */}
      <Route path="/register/supplier" element={<RegisterSupplier />} />
      <Route path="/register/agent" element={<RegisterAgent />} />

      {/* protected */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
```

### 6.2 `ProtectedRoute`

```tsx
// src/auth/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

/**
 * Layout-route guard. When there is no token, redirect to /login (preserving the
 * attempted path in router state so a future M1 enhancement can bounce back after login).
 */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
```

> **Choice:** `ProtectedRoute` is a **layout route** (renders `<Outlet/>`), not a wrapper-per-page. One guard wraps the whole authenticated subtree; adding M1 pages means adding child `<Route>`s, not re-wrapping. `replace` avoids polluting browser history with the protected URL.

Route summary (M0):

| Path | Element | Guard | Status |
|---|---|---|---|
| `/login` | `Login` | public | live (F-010) |
| `/register/supplier` | `RegisterSupplier` | public | placeholder shell (M1: F-014) |
| `/register/agent` | `RegisterAgent` | public | placeholder shell (M1: F-016) |
| `/dashboard` | `Dashboard` | protected | live (empty shell) |
| `/` | redirect → `/dashboard` | — | live |
| `*` | `NotFound` | public | live |

The register pages render a minimal "Registration — coming in M1" card so the route resolves and `tsc` passes; their forms are explicitly out of F-010 scope.

---

## 7. Login page

```tsx
// src/pages/Login.tsx
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { ApiError } from "@/api/ApiError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); // (criterion) no full page reload
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/dashboard", { replace: true }); // (criterion) redirect on success
    } catch (err) {
      // (criterion) inline error on invalid credentials, no reload
      setError(
        ApiError.isApiError(err) && err.status === 401
          ? "Invalid email or password."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate aria-label="login">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}
```

### Acceptance-criterion → mechanism map (F-010)

| F-010 acceptance criterion | How it is met |
|---|---|
| `/login` renders email + password fields and a submit button | `Login.tsx`: `<Input type="email">`, `<Input type="password">`, `<Button type="submit">` inside a `<form>` |
| Valid credentials redirect to `/dashboard` and store token **in memory** | `login()` resolves → `navigate("/dashboard")`; token written to React state + `tokenStore` module holder, never `localStorage` (§4.3) |
| Invalid credentials show an inline error **without full page reload** | `e.preventDefault()` + `try/catch` on the `ApiError` (status 401) → `setError(...)` renders `<Alert role="alert">`; SPA never reloads |
| Visiting a protected route without a token redirects to `/login` | `ProtectedRoute` checks `isAuthenticated`; `<Navigate to="/login" replace/>` when false (§6.2) |
| After login, JWT attached as `Bearer` to all API calls (network tab) | `client.request()` reads `getToken()` and sets `Authorization: Bearer <jwt>` on every request (§5.3) |
| `tsc --noEmit` passes with zero type errors | strict `tsconfig.app.json` (§2.2) + generated types (§5); enforced in CI (§8) |

---

## 8. Type-safety gate

How "zero `tsc` errors" is guaranteed and how frontend/backend stay in sync:

1. **Local + CI command:** `npm run typecheck` → `tsc --noEmit -p tsconfig.app.json`. Runs in CI on every PR; a non-zero exit fails the build. This is the literal F-010 criterion.
2. **Strict mode is on** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`) — §2.2.
3. **Generated types are committed and type-checked.** `src/api/types.gen.ts` is in the repo and included in `tsconfig.app.json`'s `include: ["src"]`, so `tsc` validates that every hand-written call site (`request<TokenResponse>`, the `LoginRequest` alias, etc.) matches the backend schema. If the backend changes a DTO, regeneration produces a new `types.gen.ts`; any now-incompatible call site fails `tsc` immediately — that's the sync mechanism.
4. **Drift detection (CI, recommended):** a CI job runs `npm run generate-client` against an ephemeral backend, then `git diff --exit-code src/api/types.gen.ts`. A non-empty diff means the committed types are stale versus the live schema → the job fails, forcing the dev to regenerate and review. This makes "generated types are the single source of truth" enforceable, not aspirational.
5. **No `any` escape hatch:** `@typescript-eslint/no-explicit-any: error` (§2.5) blocks casting around a type mismatch, satisfying F-060's "compiles without casting to `any`".

CI step order: `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test`.

---

## 9. Testing approach

**Stack:** Vitest + React Testing Library + `@testing-library/jest-dom` + `@testing-library/user-event`, jsdom environment. Backend mocked with **MSW** (Mock Service Worker) so the auth flow is tested against realistic HTTP, including the exact backend envelopes.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
```

```ts
// src/__tests__/setup.ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

```ts
// src/__tests__/mocks/handlers.ts
import { http, HttpResponse } from "msw";

// A real, signed-looking JWT is unnecessary; a 3-segment base64url token with a decodable
// payload ({ sub, org_id, role }) is enough for AuthProvider.decodeClaims.
const FAKE_JWT = "h.eyJzdWIiOiJ1MSIsIm9yЗ19pZCI6bnVsbCwicm9sZSI6InN1cHBsaWVyIn0.s"; // illustrative

export const handlers = [
  http.post("/api/auth/login", async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string };
    if (email === "good@x.com" && password === "correct") {
      return HttpResponse.json({ access_token: FAKE_JWT, token_type: "bearer" });
    }
    // exact backend envelope on 401
    return HttpResponse.json(
      { error: { code: "unauthorized", message: "invalid_credentials" } },
      { status: 401 },
    );
  }),
];
```

> **Choice:** MSW over hand-stubbing `fetch`. It exercises the real `client.request()` path (headers, envelope parsing, status handling) and lets tests assert the `Authorization` header was sent. `onUnhandledRequest: "error"` catches accidental real network calls.

### F-010 criterion → concrete test

| Criterion | Test | Assertion |
|---|---|---|
| Login form renders fields + submit | `Login.test.tsx::renders_form` | email input, password input, submit button present (by role/label) |
| Valid creds redirect to `/dashboard`, token in memory | `Login.test.tsx::valid_login_redirects` | render at `/login` in `MemoryRouter`; type `good@x.com`/`correct`; submit; assert navigation to `/dashboard`; assert `getToken()` is non-null and `localStorage.length === 0` |
| Invalid creds inline error, no reload | `Login.test.tsx::invalid_login_shows_error` | submit wrong creds; MSW returns 401 envelope; assert `role="alert"` shows "Invalid email or password."; assert no navigation occurred |
| Protected route w/o token → `/login` | `ProtectedRoute.test.tsx::redirects_when_unauthenticated` | render `/dashboard` with a fresh `AuthProvider` (no token); assert `/login` content renders |
| Protected route with token renders | `ProtectedRoute.test.tsx::renders_when_authenticated` | seed token via login; assert `Dashboard` renders |
| Bearer attached to subsequent calls | `client.test.ts::attaches_bearer` | `setToken("abc")`; call a handler that echoes headers; assert `Authorization: Bearer abc` |
| Error envelope parsed into `ApiError` | `client.test.ts::parses_error_envelope` | MSW returns `{error:{code,message}}` + 422; assert thrown `ApiError` has `.status===422`, `.code`, `.message` |
| Auth context login/logout | `AuthProvider.test.tsx::login_then_logout` | login sets `isAuthenticated`/`user`; `logout()` clears token + `getToken()===null` |

`tsc --noEmit` is validated in CI, not by a unit test (it's a compile gate, §8).

---

## 10. Pinned dependencies — proposed `frontend/package.json`

```jsonc
{
  "name": "lendrail-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.app.json",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "generate-client": "openapi-typescript http://localhost:8000/openapi.json -o src/api/types.gen.ts"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4",
    "tailwindcss-animate": "^1.0.7",
    "lucide-react": "^0.451.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-label": "^2.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vite": "^5.4.8",
    "@vitejs/plugin-react": "^4.3.2",
    "tailwindcss": "^3.4.13",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20",
    "openapi-typescript": "^7.4.1",
    "vitest": "^2.1.2",
    "jsdom": "^25.0.1",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.2",
    "msw": "^2.4.9",
    "eslint": "^8.57.1",
    "@typescript-eslint/parser": "^8.8.0",
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "eslint-plugin-react-hooks": "^4.6.2",
    "eslint-plugin-react-refresh": "^0.4.12",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.3.3",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.16.11"
  }
}
```

> **Pin notes.** React **18** (architecture mandates de-facto standard; 18 over 19 for shadcn/Radix maturity at the time of writing). `react-router-dom` **v6** (v7 reshuffles APIs; v6 is what the spec calls for). `openapi-typescript` **v7** (current major; CLI `-o` output flag). `msw` **v2** (v2 `http`/`HttpResponse` API used in §9). `vitest` **v2** paired with `@testing-library/react` **v16** (React 18 compatible). `eslint` pinned to **8.x** with the `.eslintrc.cjs` legacy config format (flat config + typed linting is fiddlier; 8.x is stable for this setup). shadcn/ui itself is **not** a dependency — components are vendored via the CLI (`npx shadcn@latest add ...`), pulling in only the Radix primitives each component needs (`react-slot` for `Button asChild`, `react-label` for `Label`).

---

## 11. Decisions a tech lead should scrutinize

1. **In-memory token ⇒ refresh loses session (§4.4).** Accepted per F-010, but it means every hard refresh forces re-login and there is no refresh-token path in M0. Confirm this UX is acceptable for the foundation milestone and that the httpOnly-cookie design lands before M1 has real data to lose.
2. **`types.gen.ts` committed, not gitignored, + a CI drift check (§5.1, §8).** Alternative is generating at build time. Committing makes diffs reviewable and CI hermetic but requires discipline (regenerate when the backend changes). Confirm the drift-check CI job is in scope.
3. **`/api` Vite proxy with prefix-strip (§2.1, §2.3).** Keeps CORS out of local dev and the backend contract unprefixed. Confirm the production deploy will also be same-origin (reverse proxy) so the model carries forward, or note where it diverges.
4. **Client-side JWT decode for `role`/`org_id` (§4.2).** Used only for rendering, never authorization (the backend enforces). Confirm reviewers are comfortable with an unverified client-side decode for UI hints.
5. **React 18 / Router v6 / ESLint 8 pins (§10).** Deliberately conservative versus the newest majors (React 19, Router v7, flat ESLint config) for ecosystem stability. Confirm we accept being one major behind in exchange for fewer integration surprises.
6. **shadcn components vendored, not a dependency (§2.4).** Standard shadcn pattern but means component source lives in our repo and we own updates. Confirm this is the intended ownership model.
```
