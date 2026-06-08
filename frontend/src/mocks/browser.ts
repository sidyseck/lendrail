import { setupWorker } from 'msw/browser';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';

export const worker = setupWorker(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
);
