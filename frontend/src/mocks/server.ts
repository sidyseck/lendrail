import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';
import { agreementsHandlers } from './handlers/agreements';
import { custodiansHandlers } from './handlers/custodians';
import { notificationsHandlers } from './handlers/notifications';
import { borrowerHandlers } from './handlers/borrowers';
import { loanHandlers } from './handlers/loans';

export const server = setupServer(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
  ...agreementsHandlers,
  ...custodiansHandlers,
  ...notificationsHandlers,
  ...borrowerHandlers,
  ...loanHandlers,
);
