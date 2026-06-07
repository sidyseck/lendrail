import { setupWorker } from 'msw/browser';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';

export const worker = setupWorker(...authHandlers, ...registerHandlers);
