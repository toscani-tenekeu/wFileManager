import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import {
  SqliteAuthError,
  changePassword,
  createNotification,
  createRole,
  createUser,
  deleteNotifications,
  deleteRole,
  deleteUser,
  instanceInfo,
  isConfigured,
  listRoles,
  listSessions,
  listUsers,
  login,
  logout,
  notifications,
  presence,
  profile,
  revokeSessions,
  rolePermissions,
  sessionUser,
  setup,
  updateNotifications,
  updateProfile,
  updateRole,
  userResponse,
} from "@/lib/server/sqlite-store";
import { assertLoginAllowed, recordLoginFailure, recordLoginSuccess } from "@/lib/server/login-rate-limit";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function token(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function body(request: Request) {
  return await request.json().catch(() => ({})) as Record<string, unknown>;
}

function withoutTerminalPermission(payload: Record<string, unknown>) {
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((permission): permission is string => typeof permission === "string" && permission !== "use_terminal")
    : payload.permissions;
  return { ...payload, permissions };
}

function sanitizeUser<T extends { permissions?: unknown }>(user: T) {
  return {
    ...user,
    permissions: Array.isArray(user.permissions)
      ? user.permissions.filter((permission): permission is string => typeof permission === "string" && permission !== "use_terminal")
      : [],
  };
}

function sanitizeRole<T extends { permissions?: unknown }>(role: T) {
  return {
    ...role,
    permissions: Array.isArray(role.permissions)
      ? role.permissions.filter((permission): permission is string => typeof permission === "string" && permission !== "use_terminal")
      : [],
  };
}

function sanitizeResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const result = value as Record<string, unknown>;
  if (Array.isArray(result.roles)) return { ...result, roles: result.roles.map((role) => sanitizeRole(role as { permissions?: unknown })) };
  if (result.role && typeof result.role === "object") return { ...result, role: sanitizeRole(result.role as { permissions?: unknown }) };
  if (Array.isArray(result.users)) return { ...result, users: result.users.map((user) => sanitizeUser(user as { permissions?: unknown })) };
  if (result.user && typeof result.user === "object") return { ...result, user: sanitizeUser(result.user as { permissions?: unknown }) };
  if ("permissions" in result) return { ...result, permissions: sanitizeRole(result).permissions };
  return result;
}

function errorResponse(error: unknown) {
  if (error instanceof SqliteAuthError) return json({ error: error.message }, error.status);
  if (error instanceof Error && "status" in error && Number.isInteger((error as { status?: number }).status)) {
    return json({ error: error.message }, Number((error as { status: number }).status));
  }
  console.error(error);
  return json({ error: error instanceof Error ? error.message : "SQLite backend request failed." }, 500);
}

export const Route = createFileRoute("/api/sqlite")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const scope = url.searchParams.get("scope") || "auth";
          const action = url.searchParams.get("action") || "status";

          if (scope === "auth" && action === "status") {
            return json({ configured: isConfigured(), instance: isConfigured() ? instanceInfo() : undefined });
          }

          const sessionToken = token(request);
          const user = sessionUser(sessionToken);

          if (scope === "auth" && action === "me") return json(sanitizeResult({ user: userResponse(user), instance: instanceInfo() }));
          if (scope === "auth" && action === "users") return json(sanitizeResult(listUsers(user)));
          if (scope === "roles" && action === "permissions") return json(sanitizeResult(rolePermissions(user)));
          if (scope === "roles" && action === "roles") return json(sanitizeResult(listRoles(user)));
          if (scope === "account" && action === "profile") return json(sanitizeResult(profile(user)));
          if (scope === "account" && action === "sessions") return json(listSessions(user, sessionToken));
          if (scope === "notifications" && action === "notifications") return json(notifications(user));
          if (scope === "presence" && action === "presence") return json(presence());

          return json({ error: "Unknown SQLite API action." }, 404);
        } catch (error) {
          return errorResponse(error);
        }
      },

      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const scope = url.searchParams.get("scope") || "auth";
          const action = url.searchParams.get("action") || "";
          const payload = await body(request);

          if (scope === "auth" && action === "setup") return json(sanitizeResult(setup(payload)), 201);
          if (scope === "auth" && action === "login") {
            assertLoginAllowed(request, payload.login);
            try {
              const result = login(payload, request);
              recordLoginSuccess(request, payload.login);
              return json(sanitizeResult(result));
            } catch (error) {
              if (error instanceof SqliteAuthError && error.status === 401) recordLoginFailure(request, payload.login);
              throw error;
            }
          }

          const sessionToken = token(request);
          const user = sessionUser(sessionToken);

          if (scope === "auth" && action === "logout") return json(logout(sessionToken));
          if (scope === "auth" && action === "users") return json(sanitizeResult(createUser(user, payload)), 201);
          if (scope === "roles" && action === "roles") return json(sanitizeResult(createRole(user, withoutTerminalPermission(payload))), 201);
          if (scope === "account" && action === "password") return json(changePassword(user, payload, sessionToken));
          if (scope === "notifications" && action === "notifications") return json(createNotification(user, payload), 201);

          return json({ error: "Unknown SQLite API action." }, 404);
        } catch (error) {
          return errorResponse(error);
        }
      },

      PATCH: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const scope = url.searchParams.get("scope") || "auth";
          const action = url.searchParams.get("action") || "";
          const payload = await body(request);
          const sessionToken = token(request);
          const user = sessionUser(sessionToken);

          if (scope === "roles" && action === "roles") return json(sanitizeResult(updateRole(user, withoutTerminalPermission(payload))));
          if (scope === "account" && action === "profile") return json(sanitizeResult(updateProfile(user, payload)));
          if (scope === "notifications" && action === "notifications") return json(updateNotifications(user, payload));

          return json({ error: "Unknown SQLite API action." }, 404);
        } catch (error) {
          return errorResponse(error);
        }
      },

      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const scope = url.searchParams.get("scope") || "auth";
          const action = url.searchParams.get("action") || "";
          const payload = await body(request);
          const sessionToken = token(request);
          const user = sessionUser(sessionToken);

          if (scope === "auth" && action === "users") return json(deleteUser(user, payload.id));
          if (scope === "roles" && action === "roles") return json(deleteRole(user, payload.id));
          if (scope === "account" && action === "sessions") return json(revokeSessions(user, payload, sessionToken));
          if (scope === "notifications" && action === "notifications") return json(deleteNotifications(user, payload));

          return json({ error: "Unknown SQLite API action." }, 404);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
