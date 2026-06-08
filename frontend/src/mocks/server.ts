import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';
import { agreementsHandlers } from './handlers/agreements';
import { custodiansHandlers } from './handlers/custodians';

export const server = setupServer(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
  ...agreementsHandlers,
  ...custodiansHandlers,
);
