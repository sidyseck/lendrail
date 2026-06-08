import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from '../mocks/server';

// jsdom does not implement EventSource. Stub it so hooks that use usePriceStream
// can mount without crashing. Tests that care about price values should mock
// the usePriceStream hook directly.
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = MockEventSource.CONNECTING;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn(() => true);
  constructor(_url: string) {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).EventSource = MockEventSource;

// Start MSW server before all tests.
// onUnhandledRequest: 'error' — any unhandled request causes an immediate test failure.
// This keeps handler coverage honest and prevents silent network calls from slipping through.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());
