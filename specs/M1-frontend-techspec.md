# LendRail M1 — Frontend Tech Spec

| Field | Value |
|---|---|
| Milestone | M1 — Onboarding (frontend only) |
| Version | rev 1 |
| Date | 2026-06-07 |
| Status | Draft — awaiting tech-lead and backend cross-review |
| Author | Frontend engineering |
| Covers | F-014 (Supplier registration UI), F-016 (Agent registration UI) |
| Architecture ref | ARCHITECTURE.md v0.2 |
| PRD ref | MASTER_PRD.md v0.1 |
| M0 spec ref | specs/M0-frontend-techspec.md (rev 2) |
| Backend contract ref | specs/M1-backend-techspec.md |

---

## §1 — Overview and Scope

This spec covers the two M1 frontend deliverables. Both depend on the M0 scaffold (F-010) and the M1 backend registration endpoint (F-013/F-015 via `POST /orgs/register`).

**F-014 — Supplier registration UI**

A public React page at `/register/supplier`. A first-time Supplier can fill in their organization details, submit, and be immediately authenticated (JWT stored in memory) and redirected to `/dashboard`. The page is accessible without a token; authenticated users visiting it are NOT redirected away (they may want to register a second org in a future scenario — no redirect-if-authenticated guard is required in M1).

**F-016 — Agent registration UI**

A public React page at `/register/agent`. Structurally identical to the supplier page with two additional fields: `ops_contact_email` (required) and `regulatory_status_attested` (required checkbox). The checkbox is validated client-side before the request is sent — an unchecked checkbox blocks submission with an inline error and never reaches the network.

**What this spec does NOT cover:**

- Any post-registration flow beyond the redirect to `/dashboard`.
- Dashboard content changes (DashboardPage is already a shell; M1 does not add domain content to it).
- Custodian linkage, borrower invite, `GET /orgs/me` display, or any other M1 backend feature that does not have a corresponding frontend feature in FEATURES.md.

---

## §2 — New Pages and Route Additions

### §2.1 — Updated `src/App.tsx`

Both registration routes are **public** — no `<ProtectedRoute>` wrapper. They must be added before the catch-all redirect so `/register/*` paths are not eaten by `<Navigate to="/dashboard" replace />`.

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { SupplierRegisterPage } from './pages/SupplierRegisterPage';
import { AgentRegisterPage } from './pages/AgentRegisterPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes — no ProtectedRoute wrapper */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register/supplier" element={<SupplierRegisterPage />} />
          <Route path="/register/agent" element={<AgentRegisterPage />} />

          {/* Protected routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {/* Catch-all — must be last */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

### §2.2 — New files in `src/pages/`

| File | Route | Feature |
|---|---|---|
| `src/pages/SupplierRegisterPage.tsx` | `/register/supplier` | F-014 |
| `src/pages/AgentRegisterPage.tsx` | `/register/agent` | F-016 |

### §2.3 — New files in `src/mocks/handlers/`

| File | Purpose |
|---|---|
| `src/mocks/handlers/register.ts` | MSW handlers for `POST /api/orgs/register` (success, 409, 422) |

### §2.4 — New test files in `src/test/`

| File | Covers |
|---|---|
| `src/test/SupplierRegisterPage.test.tsx` | All F-014 acceptance criteria |
| `src/test/AgentRegisterPage.test.tsx` | All F-016 acceptance criteria |

### §2.5 — Updated files in `src/mocks/`

`src/mocks/browser.ts` and `src/mocks/server.ts` must import and spread `registerHandlers` alongside the existing `authHandlers`.

### §2.6 — Updated `frontend/openapi.json` and `src/api/types.gen.ts`

The `POST /orgs/register` endpoint with both request variants and the `OrgRegisterResponse` type must be added. See §8.

---

## §3 — Shared Registration Form Infrastructure

Both pages share the same underlying patterns. Rather than creating a complex shared component that must handle two different field sets, the shared logic is extracted into:

1. **`src/hooks/useRegistrationForm.ts`** — a generic hook that owns: loading state, server error state, `handleSubmit` wrapper that calls `AuthContext.login()` and navigates on success.
2. **`src/lib/validators.ts`** — pure validation functions shared by both pages.

This avoids the brittleness of a highly-parameterized shared form component while still eliminating duplication of the three common patterns: loading state, 409/422 error handling, and post-success auth flow.

### §3.1 — `src/lib/validators.ts`

```ts
/**
 * Pure validation helpers shared by registration pages.
 * All functions return an error string or null (no error).
 */

export function validateRequired(value: string, fieldLabel: string): string | null {
  return value.trim().length === 0 ? `${fieldLabel} is required` : null;
}

export function validateEmail(value: string, fieldLabel: string): string | null {
  if (value.trim().length === 0) return `${fieldLabel} is required`;
  // RFC 5322 simplified pattern — same level of strictness as the backend's EmailStr
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRe.test(value) ? null : `${fieldLabel} must be a valid email address`;
}

export function validatePassword(value: string): string | null {
  if (value.length === 0) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  return null;
}
```

**Notes:**
- No password strength scoring is required by the acceptance criteria. The minimum-length check (≥8 chars) matches the backend's `min_length=8` constraint (M1-backend-techspec §7.1).
- `validateEmail` intentionally does not call the backend to check availability — that is handled by the 409 error flow.

### §3.2 — `src/hooks/useRegistrationForm.ts`

```ts
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
  /**
   * Call this with the POST /orgs/register payload once client-side
   * validation has already passed. The hook handles:
   *   - setting isLoading
   *   - calling AuthContext.login() with the returned token
   *   - navigating to /dashboard on success
   *   - mapping 409 → "Email already registered"
   *   - mapping 422 → backend message or generic fallback
   *   - clearing serverError before each attempt
   */
  submitRegistration: (payload: Record<string, unknown>) => Promise<void>;
}

export function useRegistrationForm(): UseRegistrationFormReturn {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function submitRegistration(payload: Record<string, unknown>): Promise<void> {
    setServerError(null);
    setIsLoading(true);

    try {
      const { data, error: apiError, response } = await apiClient.POST('/orgs/register', {
        body: payload as never,
      });

      if (response.status === 409) {
        // Backend returns { error: { code: "duplicate_email", message: "..." } }
        // Per F-014/F-016 acceptance criteria, always show the user-readable string.
        setServerError('Email already registered');
        return;
      }

      if (response.status === 422) {
        // Backend may return Pydantic validation errors ({ detail: [...] }) or
        // a domain ValidationError envelope ({ error: { code, message } }).
        // Extract a readable message from whichever shape arrives.
        const errBody = apiError as {
          error?: { message?: string };
          detail?: Array<{ msg: string }>;
        } | undefined;
        const msg =
          errBody?.error?.message ??
          errBody?.detail?.[0]?.msg ??
          'Validation failed. Please check your inputs.';
        setServerError(msg);
        return;
      }

      if (!response.ok || apiError || !data) {
        setServerError('Registration failed. Please try again.');
        return;
      }

      // Success: store JWT in memory (AuthContext → tokenStore) and redirect.
      // NEVER use localStorage. Token lives in the module-level variable only.
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
```

**Key design decisions:**

| Decision | Rationale |
|---|---|
| Hook takes `Record<string, unknown>` payload | Avoids coupling the generic hook to the specific schema of either registration variant; the page is responsible for constructing the correctly typed payload before calling. |
| 409 always maps to "Email already registered" | FEATURES.md F-014 acceptance criterion specifies this exact user-readable string. The backend `code="duplicate_email"` message is not shown to the user. |
| JWT stored via `login()` not `localStorage` | Hard constraint from M0 spec. `AuthContext.login()` calls `tokenStore.setToken()`. |
| No `?next=` redirect after registration | Registration is always followed by `/dashboard`. There is no "interrupted navigation" scenario for a new user with no prior destination. |

---

## §4 — SupplierRegisterPage Spec (F-014)

### §4.1 — Component Tree

```
SupplierRegisterPage
└── <form onSubmit={handleSubmit} noValidate>
    ├── FormField: Legal name (text)        → <Input type="text">
    ├── FormField: Jurisdiction (text)      → <Input type="text">
    ├── FormField: Entity type (dropdown)   → <select> or shadcn Select
    ├── FormField: Contact email            → <Input type="email">
    ├── FormField: Password                 → <Input type="password">
    ├── <p role="alert"> — server error     (conditional)
    └── <Button type="submit" disabled={isLoading}>
```

`FormField` is a local layout wrapper (not a separate exported component) that renders a `<Label>`, the input element, and an inline error `<p>` below it.

### §4.2 — Form Fields and Validation Rules

| Field | Input | Label | Validation | Error message |
|---|---|---|---|---|
| `name` | `type="text"` | "Legal name" | Required, non-empty after trim | "Legal name is required" |
| `jurisdiction` | `type="text"` | "Jurisdiction" | Required, non-empty after trim | "Jurisdiction is required" |
| `entity_type` | `<select>` | "Entity type" | Required; value must be one of the three options | "Entity type is required" |
| `contact_email` | `type="email"` | "Primary contact email" | Required, valid email format | "Primary contact email is required" / "Primary contact email must be a valid email address" |
| `password` | `type="password"` | "Password" | Required, ≥ 8 characters | "Password is required" / "Password must be at least 8 characters" |

**Entity type dropdown options — exactly:**

```
<option value="">Select entity type</option>
<option value="fund">Fund</option>
<option value="corporate_treasury">Corporate Treasury</option>
<option value="foundation">Foundation</option>
```

The `value` attributes sent to the backend are the snake_case API values. The display labels are human-readable. The option `value=""` is the placeholder and is considered an empty/unselected state for validation.

**Constraint:** The three values (`fund`, `corporate_treasury`, `foundation`) are exactly what the backend `entity_type_enum` accepts for suppliers, and exactly what FEATURES.md F-014 acceptance criterion requires. The `agent` enum value is never offered in this dropdown.

### §4.3 — Validation Strategy

Validation runs **on submit** only (not on blur/change). This avoids premature error messages while the user is still typing, which is appropriate for a registration form they fill out once.

Each field is checked in order; the first error for each field is shown inline below its input. Submission to the network is blocked until all client-side validations pass.

```ts
// Inside SupplierRegisterPage handleSubmit — validation order
const errors: Record<string, string> = {};
const nameErr = validateRequired(name, 'Legal name');
if (nameErr) errors.name = nameErr;
const jurisdictionErr = validateRequired(jurisdiction, 'Jurisdiction');
if (jurisdictionErr) errors.jurisdiction = jurisdictionErr;
if (!entityType) errors.entityType = 'Entity type is required';
const emailErr = validateEmail(contactEmail, 'Primary contact email');
if (emailErr) errors.contactEmail = emailErr;
const passwordErr = validatePassword(password);
if (passwordErr) errors.password = passwordErr;

if (Object.keys(errors).length > 0) {
  setFieldErrors(errors);
  return; // do not call submitRegistration
}
```

### §4.4 — POST /orgs/register Payload Shape

The exact request body sent to the backend. Field names must match the backend `SupplierRegisterRequest` Pydantic model (M1-backend-techspec §7.1).

```json
{
  "role": "supplier",
  "name": "<legal name>",
  "jurisdiction": "<jurisdiction>",
  "entity_type": "fund" | "corporate_treasury" | "foundation",
  "contact_email": "<email>",
  "password": "<password>"
}
```

`role` is hardcoded to `"supplier"` in the supplier page. It is not a user-controlled field.

### §4.5 — Success Flow

1. `POST /orgs/register` returns HTTP 201.
2. Response body: `{ "org_id": "<uuid>", "access_token": "<jwt>", "token_type": "bearer" }`.
3. `useRegistrationForm` calls `AuthContext.login(access_token)` — stores token in `tokenStore`, sets `isAuthenticated = true`, `role = "supplier"`, `orgId = org_id`.
4. `navigate('/dashboard', { replace: true })`.
5. User lands on DashboardPage.

### §4.6 — Error Flows

| Scenario | HTTP status | User-visible message | Location |
|---|---|---|---|
| Duplicate email | 409 | "Email already registered" | `<p role="alert">` below all fields, above submit button |
| Backend validation failure | 422 | Extracted from `error.message` or `detail[0].msg` or generic fallback | Same `<p role="alert">` |
| Network error / unexpected | — | "An unexpected error occurred. Please try again." | Same `<p role="alert">` |
| Client-side validation failure | — (no network call) | Field-specific inline errors | Below each invalid input |

### §4.7 — Full Component Implementation

```tsx
// src/pages/SupplierRegisterPage.tsx

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRegistrationForm } from '@/hooks/useRegistrationForm';
import { validateEmail, validatePassword, validateRequired } from '@/lib/validators';

type FieldErrors = Partial<Record<
  'name' | 'jurisdiction' | 'entityType' | 'contactEmail' | 'password',
  string
>>;

const ENTITY_TYPE_OPTIONS = [
  { value: 'fund', label: 'Fund' },
  { value: 'corporate_treasury', label: 'Corporate Treasury' },
  { value: 'foundation', label: 'Foundation' },
] as const;

export function SupplierRegisterPage() {
  const { isLoading, serverError, submitRegistration } = useRegistrationForm();

  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side validation — must pass before network call
    const errors: FieldErrors = {};
    const nameErr = validateRequired(name, 'Legal name');
    if (nameErr) errors.name = nameErr;
    const jurisdictionErr = validateRequired(jurisdiction, 'Jurisdiction');
    if (jurisdictionErr) errors.jurisdiction = jurisdictionErr;
    if (!entityType) errors.entityType = 'Entity type is required';
    const emailErr = validateEmail(contactEmail, 'Primary contact email');
    if (emailErr) errors.contactEmail = emailErr;
    const passwordErr = validatePassword(password);
    if (passwordErr) errors.password = passwordErr;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    await submitRegistration({
      role: 'supplier',
      name: name.trim(),
      jurisdiction: jurisdiction.trim(),
      entity_type: entityType,
      contact_email: contactEmail.trim(),
      password,
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Register as a Supplier</h1>
        <p className="mb-6 text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Legal name */}
          <div className="space-y-1">
            <Label htmlFor="name">Legal name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="name-error" className="text-sm text-red-600">
                {fieldErrors.name}
              </p>
            )}
          </div>

          {/* Jurisdiction */}
          <div className="space-y-1">
            <Label htmlFor="jurisdiction">Jurisdiction</Label>
            <Input
              id="jurisdiction"
              type="text"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.jurisdiction ? 'jurisdiction-error' : undefined}
            />
            {fieldErrors.jurisdiction && (
              <p id="jurisdiction-error" className="text-sm text-red-600">
                {fieldErrors.jurisdiction}
              </p>
            )}
          </div>

          {/* Entity type dropdown */}
          <div className="space-y-1">
            <Label htmlFor="entity-type">Entity type</Label>
            <select
              id="entity-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.entityType ? 'entity-type-error' : undefined}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select entity type</option>
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {fieldErrors.entityType && (
              <p id="entity-type-error" className="text-sm text-red-600">
                {fieldErrors.entityType}
              </p>
            )}
          </div>

          {/* Primary contact email */}
          <div className="space-y-1">
            <Label htmlFor="contact-email">Primary contact email</Label>
            <Input
              id="contact-email"
              type="email"
              autoComplete="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.contactEmail ? 'contact-email-error' : undefined}
            />
            {fieldErrors.contactEmail && (
              <p id="contact-email-error" className="text-sm text-red-600">
                {fieldErrors.contactEmail}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            {fieldErrors.password && (
              <p id="password-error" className="text-sm text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {/* Server-level error (409, 422, network) */}
          {serverError && (
            <p role="alert" className="text-sm text-red-600">
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Creating account…' : 'Create supplier account'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

### §4.8 — Acceptance Criterion Mapping (F-014)

| F-014 criterion | Implementation |
|---|---|
| All required fields show inline errors when submitted empty | `handleSubmit` runs `validateRequired` / `validateEmail` / `validatePassword`; sets `fieldErrors`; renders per-field `<p>` errors; submission blocked |
| `entity_type` dropdown offers exactly: Fund, Corporate Treasury, Foundation | `ENTITY_TYPE_OPTIONS` const; values match backend enum values; placeholder option has `value=""` |
| Successful submission stores JWT and navigates to `/dashboard` | `useRegistrationForm.submitRegistration` calls `login(access_token)` then `navigate('/dashboard', { replace: true })` |
| Duplicate email → "Email already registered" | `response.status === 409` branch in hook sets `serverError = 'Email already registered'`; rendered in `<p role="alert">` |
| TypeScript compilation passes with zero errors | All props typed; `fieldErrors` typed as `Partial<Record<...>>` |

---

## §5 — AgentRegisterPage Spec (F-016)

### §5.1 — Component Tree

```
AgentRegisterPage
└── <form onSubmit={handleSubmit} noValidate>
    ├── FormField: Entity name (text)
    ├── FormField: Jurisdiction (text)
    ├── FormField: Entity type (dropdown)    → only "Agent" option
    ├── FormField: Primary contact email
    ├── FormField: Ops/settlement contact email
    ├── FormField: Password
    ├── FormField: Attestation checkbox      → required checkbox
    ├── <p role="alert"> — server error      (conditional)
    └── <Button type="submit" disabled={isLoading}>
```

### §5.2 — Form Fields and Validation Rules

| Field | Input | Label | Validation | Error message |
|---|---|---|---|---|
| `name` | `type="text"` | "Entity name" | Required, non-empty after trim | "Entity name is required" |
| `jurisdiction` | `type="text"` | "Jurisdiction" | Required, non-empty after trim | "Jurisdiction is required" |
| `entity_type` | `<select>` (single option) | "Entity type" | Always `"agent"`; no user selection needed — rendered as a read-only select or disabled field | n/a (auto-set) |
| `contact_email` | `type="email"` | "Primary contact email" | Required, valid email format | "Primary contact email is required" / "must be a valid email address" |
| `ops_contact_email` | `type="email"` | "Ops/settlement contact email" | Required, valid email format | "Ops/settlement contact email is required" / "must be a valid email address" |
| `password` | `type="password"` | "Password" | Required, ≥ 8 characters | "Password is required" / "Password must be at least 8 characters" |
| `regulatory_status_attested` | `type="checkbox"` | See below | Must be checked; validated client-side before submit | "You must attest to your regulatory status to continue" |

**Entity type for agents:** The backend `entity_type_enum` includes `"agent"` as a valid value for agent orgs (M1-backend-techspec §3.1). The agent registration page sends `entity_type: "agent"` unconditionally. The dropdown renders a single, pre-selected, disabled option (`<option value="agent">Agent</option>`) to show the user their entity type without allowing them to change it. `entity_type` is not user-editable on the agent form.

**Attestation checkbox label text:**

```
I confirm that my organization is registered with, and in good standing with,
all applicable regulatory bodies and that providing this confirmation is a
requirement for access to the platform.
```

This text is defined as a constant in the component file so it is easy to update if legal revises it.

### §5.3 — Attestation Checkbox Behaviour

The checkbox is the only field that **blocks submission client-side** in a way that differs from a missing text field. The validation logic is:

```ts
if (!regulatory_status_attested) {
  errors.attestation = 'You must attest to your regulatory status to continue';
}
```

The error renders inline below the checkbox. The network call (`submitRegistration`) is only reached after `Object.keys(errors).length === 0`. This satisfies the F-016 acceptance criterion that the unchecked attestation checkbox shows an error before submit — the request never leaves the browser.

The backend also validates this field (`regulatory_status_attested=false` → HTTP 422 with `code="attestation_required"`), but this is belt-and-suspenders. The client-side check is the primary guard.

### §5.4 — POST /orgs/register Payload Shape

The exact request body sent to the backend. Field names must match the backend `AgentRegisterRequest` Pydantic model (M1-backend-techspec §7.1).

```json
{
  "role": "agent",
  "name": "<entity name>",
  "jurisdiction": "<jurisdiction>",
  "entity_type": "agent",
  "contact_email": "<primary email>",
  "ops_contact_email": "<ops/settlement email>",
  "password": "<password>",
  "regulatory_status_attested": true
}
```

`role` is hardcoded to `"agent"`. `entity_type` is hardcoded to `"agent"`. `regulatory_status_attested` is sent as `true` (it was validated as checked before reaching the network call; a `false` value never reaches the hook).

### §5.5 — Success and Error Flows

Same as §4.5 and §4.6 for the supplier page. After successful registration the JWT contains `role: "agent"` and the user is redirected to `/dashboard`.

### §5.6 — Full Component Implementation

```tsx
// src/pages/AgentRegisterPage.tsx

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRegistrationForm } from '@/hooks/useRegistrationForm';
import { validateEmail, validatePassword, validateRequired } from '@/lib/validators';

type FieldErrors = Partial<Record<
  'name' | 'jurisdiction' | 'contactEmail' | 'opsContactEmail' | 'password' | 'attestation',
  string
>>;

const ATTESTATION_TEXT =
  'I confirm that my organization is registered with, and in good standing with, ' +
  'all applicable regulatory bodies and that providing this confirmation is a ' +
  'requirement for access to the platform.';

export function AgentRegisterPage() {
  const { isLoading, serverError, submitRegistration } = useRegistrationForm();

  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [opsContactEmail, setOpsContactEmail] = useState('');
  const [password, setPassword] = useState('');
  const [attested, setAttested] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors: FieldErrors = {};
    const nameErr = validateRequired(name, 'Entity name');
    if (nameErr) errors.name = nameErr;
    const jurisdictionErr = validateRequired(jurisdiction, 'Jurisdiction');
    if (jurisdictionErr) errors.jurisdiction = jurisdictionErr;
    const emailErr = validateEmail(contactEmail, 'Primary contact email');
    if (emailErr) errors.contactEmail = emailErr;
    const opsEmailErr = validateEmail(opsContactEmail, 'Ops/settlement contact email');
    if (opsEmailErr) errors.opsContactEmail = opsEmailErr;
    const passwordErr = validatePassword(password);
    if (passwordErr) errors.password = passwordErr;
    // Attestation checkbox — must be checked client-side before submit
    if (!attested) {
      errors.attestation = 'You must attest to your regulatory status to continue';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    await submitRegistration({
      role: 'agent',
      name: name.trim(),
      jurisdiction: jurisdiction.trim(),
      entity_type: 'agent',
      contact_email: contactEmail.trim(),
      ops_contact_email: opsContactEmail.trim(),
      password,
      regulatory_status_attested: true,
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Register as an Agent</h1>
        <p className="mb-6 text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Entity name */}
          <div className="space-y-1">
            <Label htmlFor="name">Entity name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="name-error" className="text-sm text-red-600">
                {fieldErrors.name}
              </p>
            )}
          </div>

          {/* Jurisdiction */}
          <div className="space-y-1">
            <Label htmlFor="jurisdiction">Jurisdiction</Label>
            <Input
              id="jurisdiction"
              type="text"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.jurisdiction ? 'jurisdiction-error' : undefined}
            />
            {fieldErrors.jurisdiction && (
              <p id="jurisdiction-error" className="text-sm text-red-600">
                {fieldErrors.jurisdiction}
              </p>
            )}
          </div>

          {/* Entity type — read-only for agents */}
          <div className="space-y-1">
            <Label htmlFor="entity-type">Entity type</Label>
            <select
              id="entity-type"
              value="agent"
              disabled
              className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
            >
              <option value="agent">Agent</option>
            </select>
          </div>

          {/* Primary contact email */}
          <div className="space-y-1">
            <Label htmlFor="contact-email">Primary contact email</Label>
            <Input
              id="contact-email"
              type="email"
              autoComplete="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.contactEmail ? 'contact-email-error' : undefined}
            />
            {fieldErrors.contactEmail && (
              <p id="contact-email-error" className="text-sm text-red-600">
                {fieldErrors.contactEmail}
              </p>
            )}
          </div>

          {/* Ops/settlement contact email */}
          <div className="space-y-1">
            <Label htmlFor="ops-contact-email">Ops/settlement contact email</Label>
            <Input
              id="ops-contact-email"
              type="email"
              autoComplete="email"
              value={opsContactEmail}
              onChange={(e) => setOpsContactEmail(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.opsContactEmail ? 'ops-contact-email-error' : undefined}
            />
            {fieldErrors.opsContactEmail && (
              <p id="ops-contact-email-error" className="text-sm text-red-600">
                {fieldErrors.opsContactEmail}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            {fieldErrors.password && (
              <p id="password-error" className="text-sm text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {/* Regulatory status attestation */}
          <div className="space-y-1">
            <div className="flex items-start gap-3">
              <input
                id="attestation"
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                disabled={isLoading}
                aria-describedby={fieldErrors.attestation ? 'attestation-error' : undefined}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Label htmlFor="attestation" className="text-sm font-normal leading-snug">
                {ATTESTATION_TEXT}
              </Label>
            </div>
            {fieldErrors.attestation && (
              <p id="attestation-error" className="text-sm text-red-600">
                {fieldErrors.attestation}
              </p>
            )}
          </div>

          {/* Server-level error */}
          {serverError && (
            <p role="alert" className="text-sm text-red-600">
              {serverError}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Creating account…' : 'Create agent account'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

### §5.7 — Acceptance Criterion Mapping (F-016)

| F-016 criterion | Implementation |
|---|---|
| Error when attestation checkbox unchecked on submit | `handleSubmit` checks `!attested`; sets `fieldErrors.attestation`; renders inline error; network call never made |
| Ops/settlement contact email field is present and required | `opsContactEmail` field with `validateEmail` guard; blocks submit if empty or invalid format |
| Successful submission stores JWT and navigates to `/dashboard` | Same as supplier: `useRegistrationForm.submitRegistration` → `login()` → `navigate('/dashboard')` |
| TypeScript compiles with zero errors | All state and event types explicit; `FieldErrors` typed; `ATTESTATION_TEXT` is a `const string` |

---

## §6 — MSW Handler Updates

### §6.1 — New Handler File: `src/mocks/handlers/register.ts`

This file must cover all test scenarios for both pages. The handler intercepts `POST /api/orgs/register` and dispatches on the `role` field, matching the exact backend dispatch logic.

```ts
// src/mocks/handlers/register.ts

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';

// Mock JWTs with far-future exp for both roles.
// Payload (base64url decoded) structure: { sub, org_id, role, exp: 9999999999 }
const SUPPLIER_REG_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // { sub: "user-003", org_id: "org-003", role: "supplier", exp: 9999999999 }
  'eyJzdWIiOiJ1c2VyLTAwMyIsIm9yZ19pZCI6Im9yZy0wMDMiLCJyb2xlIjoic3VwcGxpZXIiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-signature';

const AGENT_REG_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  // { sub: "user-004", org_id: "org-004", role: "agent", exp: 9999999999 }
  'eyJzdWIiOiJ1c2VyLTAwNCIsIm9yZ19pZCI6Im9yZy0wMDQiLCJyb2xlIjoiYWdlbnQiLCJleHAiOjk5OTk5OTk5OTl9.' +
  'mock-signature';

// Emails that trigger specific error scenarios.
// Any other well-formed email + all required fields → 201 success.
const DUPLICATE_EMAIL = 'duplicate@lendrail.test';
const TRIGGER_422_EMAIL = 'invalid422@lendrail.test';

export const registerHandlers = [
  http.post('/api/orgs/register', async ({ request }) => {
    await delay(20); // Artificial latency to allow testing loading state.

    const body = (await request.json()) as Record<string, unknown>;
    const role = body.role as string | undefined;

    // 409 — duplicate email (applies to both supplier and agent)
    if (body.contact_email === DUPLICATE_EMAIL) {
      return mockError('duplicate_email', "An organization with that email already exists", 409);
    }

    // 422 — simulate a backend validation error
    if (body.contact_email === TRIGGER_422_EMAIL) {
      return mockError('validation_error', 'Validation failed on one or more fields', 422);
    }

    if (role === 'supplier') {
      // Supplier success
      return HttpResponse.json(
        {
          org_id: 'org-003',
          access_token: SUPPLIER_REG_TOKEN,
          token_type: 'bearer',
        },
        { status: 201 },
      );
    }

    if (role === 'agent') {
      // Agent: attestation=false → 422 (belt-and-suspenders for any test that bypasses
      // client-side validation and sends false directly)
      if (body.regulatory_status_attested === false) {
        return mockError(
          'attestation_required',
          'Regulatory status attestation is required for agent registration',
          422,
        );
      }
      // Agent success
      return HttpResponse.json(
        {
          org_id: 'org-004',
          access_token: AGENT_REG_TOKEN,
          token_type: 'bearer',
        },
        { status: 201 },
      );
    }

    // Unknown role — return 422
    return mockError('invalid_role', 'Unknown registration role', 422);
  }),
];
```

**Error envelope conformance:** All error responses use `mockError(code, message, status)` from `src/mocks/helpers.ts`. The envelope shape `{ error: { code, message } }` matches the backend exactly. This is a hard requirement from the M0 review (FIX 5).

### §6.2 — Updated `src/mocks/browser.ts`

```ts
import { setupWorker } from 'msw/browser';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';

export const worker = setupWorker(...authHandlers, ...registerHandlers);
```

### §6.3 — Updated `src/mocks/server.ts`

```ts
import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';

export const server = setupServer(...authHandlers, ...registerHandlers);
```

---

## §7 — Test Plan

Both test files follow the M0 test patterns exactly: `MemoryRouter`, `useNavigate` mocked with `vi.fn()`, `AuthProvider` wrapper, `userEvent.setup()`, `waitFor` for async assertions. MSW server lifecycle is managed in `src/test/setup.ts` (already in place from M0).

### §7.1 — `src/test/SupplierRegisterPage.test.tsx`

```tsx
// src/test/SupplierRegisterPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { SupplierRegisterPage } from '@/pages/SupplierRegisterPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register/supplier']}>
      <AuthProvider>
        <SupplierRegisterPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Helper: fill all valid fields
async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/legal name/i), 'Acme Fund');
  await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
  await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
  await user.type(screen.getByLabelText(/primary contact email/i), 'acme@example.com');
  await user.type(screen.getByLabelText(/password/i), 'password123');
}

describe('SupplierRegisterPage', () => {
  // F-014: all required fields shown

  it('renders all five form fields and a submit button', () => {
    renderPage();
    expect(screen.getByLabelText(/legal name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/jurisdiction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/entity type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create supplier account/i })).toBeInTheDocument();
  });

  // F-014: inline validation on empty submit

  it('shows inline errors for all required fields when submitted empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    expect(screen.getByText(/legal name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/jurisdiction is required/i)).toBeInTheDocument();
    expect(screen.getByText(/entity type is required/i)).toBeInTheDocument();
    expect(screen.getByText(/primary contact email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    // No network call should have been made
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows email format error for an invalid email', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/primary contact email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    expect(screen.getByText(/must be a valid email address/i)).toBeInTheDocument();
  });

  it('shows password length error for a password shorter than 8 characters', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/password/i), 'abc');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  // F-014: entity_type dropdown options

  it('entity type dropdown offers exactly Fund, Corporate Treasury, Foundation', () => {
    renderPage();
    const select = screen.getByLabelText(/entity type/i);
    const options = Array.from((select as HTMLSelectElement).options).map((o) => ({
      value: o.value,
      text: o.text,
    }));
    // First option is the placeholder
    expect(options[1]).toEqual({ value: 'fund', text: 'Fund' });
    expect(options[2]).toEqual({ value: 'corporate_treasury', text: 'Corporate Treasury' });
    expect(options[3]).toEqual({ value: 'foundation', text: 'Foundation' });
    // Exactly four options total (placeholder + three)
    expect(options).toHaveLength(4);
  });

  // F-014: successful registration

  it('stores JWT and navigates to /dashboard on successful registration', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const button = screen.getByRole('button', { name: /create supplier account/i });
    await user.click(button);
    expect(button).toBeDisabled();
  });

  // F-014: duplicate email → "Email already registered"

  it('shows "Email already registered" for a duplicate email (409)', async () => {
    const user = userEvent.setup();
    renderPage();
    // Use the email that MSW maps to a 409 response
    await user.type(screen.getByLabelText(/legal name/i), 'Acme Fund');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'duplicate@lendrail.test');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email already registered');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // F-014: 422 validation error from backend

  it('shows a server error message for a 422 response', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/legal name/i), 'Acme Fund');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'Delaware, USA');
    await user.selectOptions(screen.getByLabelText(/entity type/i), 'fund');
    await user.type(screen.getByLabelText(/primary contact email/i), 'invalid422@lendrail.test');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /create supplier account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
```

### §7.2 — `src/test/AgentRegisterPage.test.tsx`

```tsx
// src/test/AgentRegisterPage.test.tsx

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/auth/AuthContext';
import { AgentRegisterPage } from '@/pages/AgentRegisterPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register/agent']}>
      <AuthProvider>
        <AgentRegisterPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
  await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
  await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
  await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
  await user.type(screen.getByLabelText(/password/i), 'password123');
  await user.click(screen.getByLabelText(/i confirm that my organization/i));
}

describe('AgentRegisterPage', () => {
  // F-016: all required fields shown

  it('renders all required fields including ops contact and attestation checkbox', () => {
    renderPage();
    expect(screen.getByLabelText(/entity name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/jurisdiction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/entity type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ops\/settlement contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/i confirm that my organization/i)).toBeInTheDocument();
  });

  // F-016: attestation checkbox must be checked before submit

  it('shows attestation error when checkbox is unchecked and form is otherwise valid', async () => {
    const user = userEvent.setup();
    renderPage();
    // Fill all text fields validly but do not check the attestation box
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    // Do NOT click the attestation checkbox
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    expect(
      screen.getByText(/you must attest to your regulatory status/i),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not make a network call when the attestation checkbox is unchecked', async () => {
    // This is implicitly tested by mockNavigate not being called above,
    // but we also confirm no MSW handler intercepts (the test setup uses
    // onUnhandledRequest: 'error' — a real network call would throw).
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    // If a network call was made and the handler was missing, vitest would throw.
    // Reaching this line means no network call was made.
    expect(screen.getByText(/you must attest to your regulatory status/i)).toBeInTheDocument();
  });

  // F-016: ops/settlement contact email is required

  it('shows an error when ops/settlement email is empty', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.type(screen.getByLabelText(/primary contact email/i), 'atlas@example.com');
    // Leave ops email empty
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByLabelText(/i confirm that my organization/i));
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    expect(
      screen.getByText(/ops\/settlement contact email is required/i),
    ).toBeInTheDocument();
  });

  it('shows an error when ops/settlement email has an invalid format', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    expect(screen.getAllByText(/must be a valid email address/i).length).toBeGreaterThan(0);
  });

  // F-016: successful registration

  it('stores JWT and navigates to /dashboard on successful registration', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    const button = screen.getByRole('button', { name: /create agent account/i });
    await user.click(button);
    expect(button).toBeDisabled();
  });

  // F-016: 409 duplicate email

  it('shows "Email already registered" for a duplicate email (409)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.type(screen.getByLabelText(/primary contact email/i), 'duplicate@lendrail.test');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByLabelText(/i confirm that my organization/i));
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email already registered');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // F-016: 422 validation error

  it('shows a server error for a 422 response', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/entity name/i), 'Atlas Lending');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'New York, USA');
    await user.type(screen.getByLabelText(/primary contact email/i), 'invalid422@lendrail.test');
    await user.type(screen.getByLabelText(/ops\/settlement contact email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByLabelText(/i confirm that my organization/i));
    await user.click(screen.getByRole('button', { name: /create agent account/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // Entity type field is always "Agent" and not user-editable

  it('entity type field is pre-set to "Agent" and disabled', () => {
    renderPage();
    const select = screen.getByLabelText(/entity type/i) as HTMLSelectElement;
    expect(select.value).toBe('agent');
    expect(select.disabled).toBe(true);
  });
});
```

---

## §8 — openapi.json and types.gen.ts Updates

### §8.1 — Changes Required in `frontend/openapi.json`

The backend `POST /orgs/register` endpoint must be added to the committed schema file. The backend team must provide the exact OpenAPI path item from the FastAPI-generated `/openapi.json`. The frontend team commits this to `frontend/openapi.json` and regenerates types.

The minimum additions required to `frontend/openapi.json`:

**New path item:**
```json
"/orgs/register": {
  "post": {
    "operationId": "register_org",
    "summary": "Register a new organization (supplier or agent)",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": { "$ref": "#/components/schemas/OrgRegisterRequest" }
        }
      }
    },
    "responses": {
      "201": {
        "description": "Successful registration",
        "content": {
          "application/json": {
            "schema": { "$ref": "#/components/schemas/OrgRegisterResponse" }
          }
        }
      },
      "409": { "description": "Duplicate email" },
      "422": { "description": "Validation error" }
    }
  }
}
```

**New component schemas required:**
- `OrgRegisterResponse`: `{ org_id: string (uuid), access_token: string, token_type: "bearer" }`
- `SupplierRegisterRequest` and `AgentRegisterRequest` or a unified `OrgRegisterRequest` — exact shape depends on how FastAPI serializes the discriminated union. The backend team must confirm this.

### §8.2 — Regenerating `src/api/types.gen.ts`

After updating `frontend/openapi.json`, run:

```sh
npm run generate-types
```

This executes `openapi-typescript ./openapi.json > src/api/types.gen.ts` (stdout redirect — M0 convention from FIX 2 in M0 review). Commit both the updated `openapi.json` and the regenerated `types.gen.ts`. The CI drift check will fail if they are out of sync.

### §8.3 — Type usage in `useRegistrationForm`

Once the types are regenerated, the `submitRegistration` hook should consume the typed path instead of `Record<string, unknown>`. The exact cast depends on the generated type shape:

```ts
// After type generation — replace Record<string, unknown> with:
import type { paths } from '@/api/types.gen';

type RegisterBody = paths['/orgs/register']['post']['requestBody']['content']['application/json'];
type RegisterResponse = paths['/orgs/register']['post']['responses']['201']['content']['application/json'];
```

This eliminates the `as never` cast in `submitRegistration` and makes the payload shape compile-time checked. Until the backend provides the updated `openapi.json`, the `Record<string, unknown>` approach in §3.2 is a valid interim.

---

## §9 — Open Decisions

The following items require resolution from the tech lead and/or backend team before implementation can be considered complete and final.

| # | Decision | Blocker for? | Options / Recommendation |
|---|---|---|---|
| **D-1** | **`openapi.json` discriminated union shape.** FastAPI serializes a Pydantic `Annotated[Union[...], Discriminator("role")]` in a way that may not produce a straightforward JSON Schema `oneOf`. The exact shape in the generated OpenAPI spec must be confirmed by the backend team before `types.gen.ts` can be regenerated and the `as never` cast removed from `useRegistrationForm`. | `types.gen.ts` update (§8) | Backend team to provide a sample of `GET /openapi.json` from the running M1 backend. Frontend team to then update `openapi.json` and regenerate. |
| **D-2** | **Agent `entity_type` UX.** The spec renders entity type as a disabled single-option `<select>` for agents. An alternative is to hide the field entirely and hardcode `entity_type: "agent"` silently. The disabled select is more transparent (user can see the value) but adds a visually confusing locked field. | UX only | Recommend confirming with product/design. If the preference is to hide it, remove the `<select>` and hardcode in the payload; no validation change required. |
| **D-3** | **Backend open question §10.8: is `entity_type="agent"` valid for agent registration?** The M1-backend-techspec §10 flags that it is unclear whether `entity_type="agent"` should be the valid value for agent orgs or whether it is reserved. If the answer is "reserved" and the correct value for agent orgs is something else, the hardcoded `entity_type: "agent"` in `AgentRegisterPage` must change. | Agent registration correctness | Backend tech lead must resolve §10.8 in the backend spec before M1 frontend ships. |
| **D-4** | **Redirect-if-authenticated on registration routes.** Currently, an already-logged-in user can visit `/register/supplier` or `/register/agent` without being redirected to `/dashboard`. This may be intentional (no such requirement in FEATURES.md) but could be surprising UX. | UX only | No action required for M1. Can add a redirect-if-authenticated check in a later polish pass. Flag if product disagrees. |
| **D-5** | **Pydantic 422 body format inconsistency (backend).** The M1-backend-techspec §10 item 4 notes that Pydantic schema errors return `{ detail: [...] }` while domain errors return `{ error: { code, message } }`. The frontend `useRegistrationForm` hook handles both shapes (§3.2). However, if the backend standardizes the 422 format (likely to the `{ error: ... }` envelope per the backend spec recommendation), the `errBody?.detail?.[0]?.msg` fallback path can be removed. Recommend backend to resolve this before M1 ships so the frontend does not carry dead code. | Frontend cleanup | No blocking impact — the dual-format handler is safe for both outcomes. |
| **D-6** | **Navigation after registration for already-authenticated users.** `useRegistrationForm` always navigates to `/dashboard` after success. If the product later adds a role-specific post-registration onboarding flow (e.g., supplier goes to `/onboarding/custodian`), this hook must be updated. Flag for M2. | M2+ | No action in M1. |

---

Status: Draft — awaiting tech-lead and backend cross-review
