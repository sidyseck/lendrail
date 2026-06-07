// Minimal className combiner. Vendored to avoid pulling clsx/tailwind-merge
// as npm deps for the M0 scaffold.
export function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(' ');
}
