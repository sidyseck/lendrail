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
  if (value.length < 12) return 'Password must be at least 12 characters';
  return null;
}

export function validateMatchingEmails(
  value: string,
  other: string,
  fieldLabel: string,
): string | null {
  if (value === other) return `${fieldLabel} must differ from the primary contact email`;
  return null;
}
