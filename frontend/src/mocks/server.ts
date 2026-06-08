import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';

export const server = setupServer(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
);
