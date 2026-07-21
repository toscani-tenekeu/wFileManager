import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { wfilemanagerApi, type WFileManagerNotification } from "@/lib/wfilemanager-api";

type NotificationsContextValue = {
  notifications: WFileManagerNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string, read?: boolean) => Promise<void>;
  markAllRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<WFileManagerNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    setLoading(true);
    try {
      const result = await wfilemanagerApi.notifications();
      setNotifications(result.notifications);
    } catch {
      // Keep the last successfully loaded list when the notification service is temporarily unavailable.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    const focused = () => void refresh();
    window.addEventListener("wfilemanager:notifications-changed", changed);
    window.addEventListener("focus", focused);
    const timer = window.setInterval(changed, 60_000);
    return () => {
      window.removeEventListener("wfilemanager:notifications-changed", changed);
      window.removeEventListener("focus", focused);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const markRead = useCallback(async (id: string, read = true) => {
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: read ? new Date().toISOString() : null } : item));
    try {
      await wfilemanagerApi.markNotificationRead(id, read);
    } catch {
      await refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || now })));
    try {
      await wfilemanagerApi.markAllNotificationsRead();
    } catch {
      await refresh();
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
    try {
      await wfilemanagerApi.deleteNotification(id);
    } catch {
      await refresh();
    }
  }, [refresh]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    try {
      await wfilemanagerApi.clearNotifications();
    } catch {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo(() => ({
    notifications,
    unreadCount: notifications.filter((item) => !item.readAt).length,
    loading,
    refresh,
    markRead,
    markAllRead,
    remove,
    clearAll,
  }), [notifications, loading, refresh, markRead, markAllRead, remove, clearAll]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationProvider");
  return value;
}
