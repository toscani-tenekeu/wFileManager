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

          if (scope === "auth" && action === "me") return json({ user: userResponse(user), instance: instanceInfo() });
          if (scope === "auth" && action === "users") return json(listUsers(user));
          if (scope === "roles" && action === "permissions") return json(rolePermissions(user));
          if (scope === "roles" && action === "roles") return json(listRoles(user));
          if (scope === "account" && action === "profile") return json(profile(user));
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

          if (scope === "auth" && action === "setup") return json(setup(payload), 201);
          if (scope === "auth" && action === "login") {
            assertLoginAllowed(request, payload.login);
            try {
              const result = login(payload, request);
              recordLoginSuccess(request, payload.login);
              return json(result);
            } catch (error) {
              if (error instanceof SqliteAuthError && error.status === 401) recordLoginFailure(request, payload.login);
              throw error;
            }
          }

          const sessionToken = token(request);
          const user = sessionUser(sessionToken);

          if (scope === "auth" && action === "logout") return json(logout(sessionToken));
          if (scope === "auth" && action === "users") return json(createUser(user, payload), 201);
          if (scope === "roles" && action === "roles") return json(createRole(user, payload), 201);
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

          if (scope === "roles" && action === "roles") return json(updateRole(user, payload));
          if (scope === "account" && action === "profile") return json(updateProfile(user, payload));
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
