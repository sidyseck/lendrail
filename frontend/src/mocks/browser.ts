import { setupWorker } from 'msw/browser';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';
import { connectionsHandlers } from './handlers/connections';
import { agreementsHandlers } from './handlers/agreements';
import { custodiansHandlers } from './handlers/custodians';
import { notificationsHandlers } from './handlers/notifications';

export const worker = setupWorker(
  ...authHandlers,
  ...registerHandlers,
  ...connectionsHandlers,
  ...agreementsHandlers,
  ...custodiansHandlers,
  ...notificationsHandlers,
);
