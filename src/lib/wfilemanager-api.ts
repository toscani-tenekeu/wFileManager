const PROJECT_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://igihzeyfgwhnuiflamvn.supabase.co";
const API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-api`;
const ROLES_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-roles-api`;
const NOTIFICATIONS_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-notifications-api`;
const ACCOUNT_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-account-api`;
const USERS_ADMIN_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-users-admin-api`;
const PRESENCE_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-presence-api`;
const INSTANCE_KEY = import.meta.env.VITE_WFILEMANAGER_INSTANCE_KEY || "kmerhosting-main";
const TOKEN_KEY = "wfilemanager_session_token";

export interface AuthUser {
  id: string;
  instanceId: string;
  roleId: string | null;
  username: string;
  email: string | null;
  displayName: string;
  timezone?: string;
  status: "active" | "disabled" | "invited";
  isAdmin: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  roleName?: string | null;
  permissions?: string[];
}

export interface WFileManagerRole {
  id: string;
  instanceId: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  members: number;
  createdAt: string;
  updatedAt: string;
}


export interface WFileManagerNotification {
  id: string;
  title: string;
  message: string;
  tone: "info" | "success" | "warning" | "error";
  link: string | null;
  source: string;
  readAt: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface WFileManagerSession {
  id: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}

export interface SetupPayload {
  instanceName?: string;
  hostname?: string;
  baseUrl?: string;
  displayName: string;
  username: string;
  email?: string;
  password: string;
}

async function request<T>(action: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  const response = await fetch(`${API_URL}/${action}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

async function rolesRequest<T>(action: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  const response = await fetch(`${ROLES_API_URL}/${action}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}


async function externalRequest<T>(baseUrl: string, action: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  const response = await fetch(`${baseUrl}/${action}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

async function notificationsRequest<T>(init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  const response = await fetch(`${NOTIFICATIONS_API_URL}/notifications`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

function signalNotificationsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("wfilemanager:notifications-changed"));
  }
}

export const wfilemanagerApi = {
  getToken: () => (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
  status: () => request<{ configured: boolean; instance?: { id: string; name: string; hostname?: string } }>("status"),
  setup: (data: SetupPayload) => request<{ success: true; user: AuthUser }>("setup", { method: "POST", body: JSON.stringify(data) }),
  login: (login: string, password: string, remember: boolean) => request<{ token: string; expiresAt: string; user: AuthUser }>("login", { method: "POST", body: JSON.stringify({ login, password, remember }) }),
  me: () => request<{ user: AuthUser; instance: { id: string; name: string; hostname?: string } }>("me"),
  logout: () => request<{ success: true }>("logout", { method: "POST" }),
  users: () => request<{ users: AuthUser[] }>("users"),
  createUser: (data: { displayName: string; username: string; email?: string; password: string; roleId?: string; status?: string; mustChangePassword?: boolean }) =>
    request<{ user: AuthUser }>("users", { method: "POST", body: JSON.stringify(data) }),
  deleteUser: (id: string) => externalRequest<{ success: true; deleted: { id: string; username: string; displayName: string } }>(USERS_ADMIN_API_URL, "users", { method: "DELETE", body: JSON.stringify({ id }) }),
  accountProfile: () => externalRequest<{ user: AuthUser }>(ACCOUNT_API_URL, "profile"),
  updateAccountProfile: (data: { displayName: string; email?: string | null; timezone: string }) => externalRequest<{ user: AuthUser }>(ACCOUNT_API_URL, "profile", { method: "PATCH", body: JSON.stringify(data) }),
  changePassword: (currentPassword: string, newPassword: string) => externalRequest<{ success: true }>(ACCOUNT_API_URL, "password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  accountSessions: () => externalRequest<{ sessions: WFileManagerSession[] }>(ACCOUNT_API_URL, "sessions"),
  revokeSession: (id: string) => externalRequest<{ success: true; currentRevoked: boolean }>(ACCOUNT_API_URL, "sessions", { method: "DELETE", body: JSON.stringify({ id }) }),
  revokeAllSessions: () => externalRequest<{ success: true; currentRevoked: true }>(ACCOUNT_API_URL, "sessions", { method: "DELETE", body: JSON.stringify({ all: true }) }),
  rolePermissions: () => rolesRequest<{ roleId: string | null; roleName: string | null; permissions: string[] }>("permissions"),
  roles: () => rolesRequest<{ roles: WFileManagerRole[] }>("roles"),
  createRole: (data: { name: string; description?: string; permissions: string[] }) =>
    rolesRequest<{ role: WFileManagerRole }>("roles", { method: "POST", body: JSON.stringify(data) }),
  updateRole: (data: { id: string; name?: string; description?: string; permissions?: string[] }) =>
    rolesRequest<{ role: WFileManagerRole }>("roles", { method: "PATCH", body: JSON.stringify(data) }),
  deleteRole: (id: string) => rolesRequest<{ success: true }>("roles", { method: "DELETE", body: JSON.stringify({ id }) }),
  notifications: () => notificationsRequest<{ notifications: WFileManagerNotification[] }>(),
  createNotification: async (data: { title: string; message?: string; tone?: WFileManagerNotification["tone"]; link?: string; source?: string }) => {
    const result = await notificationsRequest<{ notification: WFileManagerNotification }>({ method: "POST", body: JSON.stringify(data) });
    signalNotificationsChanged();
    return result;
  },
  markNotificationRead: async (id: string, read = true) => {
    const result = await notificationsRequest<{ success: true }>({ method: "PATCH", body: JSON.stringify({ id, read }) });
    signalNotificationsChanged();
    return result;
  },
  markAllNotificationsRead: async () => {
    const result = await notificationsRequest<{ success: true }>({ method: "PATCH", body: JSON.stringify({ markAll: true }) });
    signalNotificationsChanged();
    return result;
  },
  deleteNotification: async (id: string) => {
    const result = await notificationsRequest<{ success: true }>({ method: "DELETE", body: JSON.stringify({ id }) });
    signalNotificationsChanged();
    return result;
  },
  clearNotifications: async () => {
    const result = await notificationsRequest<{ success: true }>({ method: "DELETE", body: JSON.stringify({ all: true }) });
    signalNotificationsChanged();
    return result;
  },
  onlineUsers: () => externalRequest<{ onlineUsers: number; onlineWindowSeconds: number; checkedAt: string }>(PRESENCE_API_URL, "presence"),
};
