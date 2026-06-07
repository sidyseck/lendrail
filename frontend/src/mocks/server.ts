import { setupServer } from 'msw/node';
import { authHandlers } from './handlers/auth';
import { registerHandlers } from './handlers/register';

export const server = setupServer(...authHandlers, ...registerHandlers);
