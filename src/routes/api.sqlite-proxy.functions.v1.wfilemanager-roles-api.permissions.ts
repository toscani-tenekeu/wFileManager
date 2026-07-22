import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SqliteAuthError, rolePermissions, sessionUser } from "@/lib/server/sqlite-store";

function token(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/sqlite-proxy/functions/v1/wfilemanager-roles-api/permissions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json(rolePermissions(sessionUser(token(request))), { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          const status = error instanceof SqliteAuthError ? error.status : 500;
          return Response.json({ error: error instanceof Error ? error.message : "Permission lookup failed." }, { status });
        }
      },
    },
  },
});
