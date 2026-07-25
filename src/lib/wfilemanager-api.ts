const DATABASE_MODE =
  import.meta.env.VITE_WFILEMANAGER_DATABASE_MODE === "sqlite" ? "sqlite" : "supabase";

export type InstanceLifecycleStatus = "active" | "frozen" | "disabled";

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
  allowedPaths?: string[];
}

export interface ProPlanDetails {
  servicePlan: string | null;
  subscriptionStatus: string | null;
  dataStatus: string | null;
  paidUntil: string | null;
  nextPaymentAt: string | null;
  daysRemaining: number | null;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  storagePercent: number;
  orderReference: string | null;
  customerEmail: string | null;
  activatedAt: string | null;
  pastDueAt: string | null;
  suspendedAt: string | null;
}

export interface WFileManagerInstance {
  id: string;
  name: string;
  hostname?: string;
  databaseMode?: string;
  status?: InstanceLifecycleStatus;
  servicePlan?: string | null;
  subscriptionStatus?: string | null;
  dataStatus?: string | null;
  paidUntil?: string | null;
  storageUsedBytes?: number;
  storageQuotaBytes?: number;
  plan?: ProPlanDetails | null;
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

export interface AuditLog {
  id: string;
  username: string | null;
  action: string;
  target: string | null;
  result: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SetupPayload {
  instanceName?: string;
  hostname?: string;
  baseUrl?: string;
  displayName: string;
  username: string;
  email?: string;
  password: string;
  activationToken?: string;
}

export interface InstanceStatusResponse {
  configured: boolean;
  instanceKey?: string;
  status?: InstanceLifecycleStatus;
  frozenAt?: string | null;
  deleteAfterAt?: string | null;
  instance?: WFileManagerInstance;
}

type GatewayScope =
  | "auth"
  | "login"
  | "setup"
  | "roles"
  | "account"
  | "users"
  | "presence"
  | "notifications";

function gatewayUrl(scope: GatewayScope, action: string) {
  const query = new URLSearchParams({ scope, action });
  return `/api/gateway?${query}`;
}

async function perform<T>(scope: GatewayScope, action: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(gatewayUrl(scope, action), {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`) as Error & {
      status?: number;
      retryAfterSeconds?: number;
    };
    error.status = response.status;
    if (Number.isFinite(payload.retryAfterSeconds))
      error.retryAfterSeconds = Number(payload.retryAfterSeconds);
    throw error;
  }
  return payload as T;
}

function signalNotificationsChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("wfilemanager:notifications-changed"));
}

export const wfilemanagerApi = {
  databaseMode: DATABASE_MODE,
  getToken: () => null,
  setToken: (_value: string) => undefined,
  clearToken: () => undefined,
  status: () => perform<InstanceStatusResponse>("auth", "status"),
  setup: (data: SetupPayload) =>
    perform<{ success: true; user: AuthUser }>("setup", "setup", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  login: (login: string, password: string, remember: boolean) =>
    perform<{ expiresAt: string; user: AuthUser }>("login", "login", {
      method: "POST",
      body: JSON.stringify({ login, password, remember }),
    }),
  me: () => perform<{ user: AuthUser; instance: WFileManagerInstance }>("auth", "me"),
  logout: () => perform<{ success: true }>("auth", "logout", { method: "POST", body: "{}" }),
  users: () => perform<{ users: AuthUser[] }>("users", "users"),
  createUser: (data: {
    displayName: string;
    username: string;
    email?: string;
    password: string;
    roleId?: string;
    status?: string;
    mustChangePassword?: boolean;
    allowedPaths?: string[];
  }) =>
    perform<{ user: AuthUser }>("users", "users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUser: (
    id: string,
    data: {
      displayName?: string;
      email?: string | null;
      password?: string;
      roleId?: string | null;
      status?: "active" | "disabled" | "invited";
      mustChangePassword?: boolean;
      allowedPaths?: string[];
    },
  ) =>
    perform<{ user: AuthUser }>("users", "users", {
      method: "PATCH",
      body: JSON.stringify({ id, ...data }),
    }),
  deleteUser: (id: string) =>
    perform<{ success: true; deleted: { id: string; username: string; displayName: string } }>(
      "users",
      "users",
      { method: "DELETE", body: JSON.stringify({ id }) },
    ),
  accountProfile: () => perform<{ user: AuthUser }>("account", "profile"),
  updateAccountProfile: (data: { displayName: string; email?: string | null; timezone: string }) =>
    perform<{ user: AuthUser }>("account", "profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    perform<{ success: true }>("account", "password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  accountSessions: () => perform<{ sessions: WFileManagerSession[] }>("account", "sessions"),
  revokeSession: (id: string) =>
    perform<{ success: true; currentRevoked: boolean }>("account", "sessions", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    }),
  revokeAllSessions: () =>
    perform<{ success: true; currentRevoked: true }>("account", "sessions", {
      method: "DELETE",
      body: JSON.stringify({ all: true }),
    }),
  rolePermissions: () =>
    perform<{
      roleId: string | null;
      roleName: string | null;
      permissions: string[];
      pathRules?: Array<{
        id?: string;
        path: string;
        accessMode: "allow" | "deny";
        recursive: boolean;
        source?: "user" | "role";
      }>;
    }>("roles", "permissions"),
  roles: () => perform<{ roles: WFileManagerRole[] }>("roles", "roles"),
  createRole: (data: { name: string; description?: string; permissions: string[] }) =>
    perform<{ role: WFileManagerRole }>("roles", "roles", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRole: (data: { id: string; name?: string; description?: string; permissions?: string[] }) =>
    perform<{ role: WFileManagerRole }>("roles", "roles", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteRole: (id: string) =>
    perform<{ success: true }>("roles", "roles", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    }),
  auditLogs: () => perform<{ logs: AuditLog[] }>("auth", "logs"),
  onlineUsers: () => perform<{ onlineUsers: number; generatedAt?: string }>("presence", "presence"),
  notifications: () =>
    perform<{ notifications: WFileManagerNotification[] }>("notifications", "notifications"),
  createNotification: async (data: {
    title: string;
    message?: string;
    tone?: WFileManagerNotification["tone"];
    link?: string;
    source?: string;
  }) => {
    const result = await perform<{ notification: WFileManagerNotification }>(
      "notifications",
      "notifications",
      { method: "POST", body: JSON.stringify(data) },
    );
    signalNotificationsChanged();
    return result;
  },
  markNotificationRead: async (id: string, read = true) => {
    const result = await perform<{ success: true }>("notifications", "notifications", {
      method: "PATCH",
      body: JSON.stringify({ id, read }),
    });
    signalNotificationsChanged();
    return result;
  },
  markAllNotificationsRead: async () => {
    const result = await perform<{ success: true }>("notifications", "notifications", {
      method: "PATCH",
      body: JSON.stringify({ markAll: true }),
    });
    signalNotificationsChanged();
    return result;
  },
  deleteNotification: async (id: string) => {
    const result = await perform<{ success: true }>("notifications", "notifications", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    signalNotificationsChanged();
    return result;
  },
  clearNotifications: async () => {
    const result = await perform<{ success: true }>("notifications", "notifications", {
      method: "DELETE",
      body: JSON.stringify({ all: true }),
    });
    signalNotificationsChanged();
    return result;
  },
};
