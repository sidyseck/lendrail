// src/pages/AgentRegisterPage.tsx

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRegistrationForm } from '@/hooks/useRegistrationForm';
import { validateEmail, validatePassword, validateRequired } from '@/lib/validators';

type FieldErrors = Partial<Record<
  'name' | 'jurisdiction' | 'entityType' | 'contactEmail' | 'opsContactEmail' | 'password' | 'attestation',
  string
>>;

const ENTITY_TYPE_OPTIONS = [
  { value: 'fund', label: 'Fund' },
  { value: 'corporate_treasury', label: 'Corporate Treasury' },
  { value: 'foundation', label: 'Foundation' },
] as const;

const ATTESTATION_TEXT =
  'I confirm that my organization is registered with, and in good standing with, ' +
  'all applicable regulatory bodies and that providing this confirmation is a ' +
  'requirement for access to the platform.';

export function AgentRegisterPage() {
  const { isLoading, serverError, submitRegistration } = useRegistrationForm();

  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [entityType, setEntityType] = useState('');
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
    if (!entityType) errors.entityType = 'Entity type is required';
    const emailErr = validateEmail(contactEmail, 'Primary contact email');
    if (emailErr) errors.contactEmail = emailErr;
    const opsEmailErr = validateEmail(opsContactEmail, 'Ops/settlement contact email');
    if (opsEmailErr) errors.opsContactEmail = opsEmailErr;
    const passwordErr = validatePassword(password);
    if (passwordErr) errors.password = passwordErr;
    if (!attested) {
      errors.attestation = 'You must attest to your regulatory status to continue';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    await submitRegistration('/orgs/register/agent', {
      name: name.trim(),
      jurisdiction: jurisdiction.trim(),
      entity_type: entityType,
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

        <p className="mt-4 text-center text-sm text-gray-500">
          Want to register as a supplier?{' '}
          <Link to="/register/supplier" className="text-blue-600 hover:underline">
            Register as Supplier
          </Link>
        </p>
      </div>
    </div>
  );
}
