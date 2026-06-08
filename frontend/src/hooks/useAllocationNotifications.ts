// src/hooks/useAllocationNotifications.ts — F-063
//
// Manages supplier_allocation_changed notifications.
//
// isScreenVisible=false (user is elsewhere): polls every 30s, keeps badge count.
// isScreenVisible=true (user is on inventory page): fetches once, auto-marks unread as
// read and sets row highlights. No poll interval while on-screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAllocationNotifications, markNotificationRead } from '@/api/inventoryApi';

const POLL_INTERVAL_MS = 30_000;
const HIGHLIGHT_CLEAR_DELAY_MS = 3_000;
const LAST_VISIT_KEY = 'lendrail_agent_inventory_last_visit';

export interface UseAllocationNotificationsReturn {
  badgeCount: number;
  // Map of connection_id → created_at ISO string of the most recent unread notification.
  highlightedConnections: Record<string, string>;
  // Kept for API compatibility. The hook auto-processes on mount when isScreenVisible=true.
  onScreenVisit: () => Promise<void>;
}

export function useAllocationNotifications(
  isScreenVisible: boolean,
): UseAllocationNotificationsReturn {
  const [badgeCount, setBadgeCount] = useState(0);
  const [highlightedConnections, setHighlightedConnections] = useState<Record<string, string>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function getLastVisit(): string | undefined {
    try {
      return localStorage.getItem(LAST_VISIT_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }

  function setLastVisit(iso: string) {
    try {
      localStorage.setItem(LAST_VISIT_KEY, iso);
    } catch {
      // Storage unavailable — degrade gracefully.
    }
  }

  const processNotifications = useCallback(async () => {
    const since = getLastVisit();
    const notifications = await getAllocationNotifications(since);
    const unreadItems = notifications.filter((n) => !n.read);

    if (isScreenVisible) {
      if (unreadItems.length === 0) return;

      // Build highlight map: connection_id → most recent notification's created_at
      const highlights: Record<string, string> = {};
      for (const notif of unreadItems) {
        const existing = highlights[notif.connection_id];
        if (!existing || new Date(notif.created_at) > new Date(existing)) {
          highlights[notif.connection_id] = notif.created_at;
        }
      }
      setHighlightedConnections(highlights);
      setLastVisit(new Date().toISOString());

      await Promise.allSettled(unreadItems.map((n) => markNotificationRead(n.notification_id)));

      setBadgeCount(0);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(
        () => setHighlightedConnections({}),
        HIGHLIGHT_CLEAR_DELAY_MS,
      );
    } else {
      setBadgeCount(unreadItems.length);
    }
  }, [isScreenVisible]);

  // Always fetch once on mount / when visibility changes
  useEffect(() => {
    void processNotifications();
  }, [processNotifications]);

  // Poll while off-screen
  useEffect(() => {
    if (isScreenVisible) return;
    const interval = setInterval(() => void processNotifications(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isScreenVisible, processNotifications]);

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  // Manual trigger kept for API compatibility; usually a no-op since the hook auto-processes.
  const onScreenVisit = useCallback(async () => {
    await processNotifications();
  }, [processNotifications]);

  return { badgeCount, highlightedConnections, onScreenVisit };
}
