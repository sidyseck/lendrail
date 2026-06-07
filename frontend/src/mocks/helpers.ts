import { HttpResponse } from 'msw';

/**
 * Creates an MSW error response matching the backend error envelope exactly:
 *   { "error": { "code": string, "message": string } }
 *
 * Use this for ALL error responses in MSW handlers.
 * NEVER return { message: string } or any other shape — it does not match the backend.
 */
export function mockError(
  code: string,
  message: string,
  status: number,
): Response {
  return HttpResponse.json({ error: { code, message } }, { status });
}
