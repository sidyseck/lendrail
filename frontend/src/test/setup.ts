import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/server';

// Start MSW server before all tests.
// onUnhandledRequest: 'error' — any unhandled request causes an immediate test failure.
// This keeps handler coverage honest and prevents silent network calls from slipping through.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
