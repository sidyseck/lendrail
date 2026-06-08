// src/mocks/handlers/notifications.ts — F-063

import { delay, http, HttpResponse } from 'msw';
import { mockError } from '../helpers';
import type { AllocationNotification } from '@/types/inventory';

const INITIAL_NOTIFICATIONS: AllocationNotification[] = [
  {
    notification_id: 'notif-001',
    event: 'supplier_allocation_changed',
    connection_id: 'conn-002',
    read: false,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
    payload: {},
  },
];

let mockNotifications: AllocationNotification[] = INITIAL_NOTIFICATIONS.map((n) => ({ ...n }));

export function resetMockNotifications(overrides?: AllocationNotification[]): void {
  mockNotifications = (overrides ?? INITIAL_NOTIFICATIONS).map((n) => ({ ...n }));
}

export const notificationsHandlers = [
  // ── GET /api/notifications ─────────────────────────────────────────────────
  http.get('/api/notifications', async ({ request }) => {
    await delay(20);
    const url = new URL(request.url);
    const eventFilter = url.searchParams.get('event');
    const sinceParam = url.searchParams.get('since');

    let result = [...mockNotifications];
    if (eventFilter) {
      result = result.filter((n) => n.event === eventFilter);
    }
    if (sinceParam) {
      const sinceDate = new Date(sinceParam);
      result = result.filter((n) => new Date(n.created_at) > sinceDate);
    }
    return HttpResponse.json({ notifications: result }, { status: 200 });
  }),

  // ── POST /api/notifications/:notification_id/read ─────────────────────────
  http.post('/api/notifications/:notification_id/read', async ({ params }) => {
    await delay(10);
    const id = params.notification_id as string;
    const notif = mockNotifications.find((n) => n.notification_id === id);
    if (!notif) return mockError('not_found', 'Notification not found', 404);
    mockNotifications = mockNotifications.map((n) =>
      n.notification_id === id ? { ...n, read: true } : n,
    );
    return HttpResponse.json({ notification_id: id, read: true }, { status: 200 });
  }),
];
