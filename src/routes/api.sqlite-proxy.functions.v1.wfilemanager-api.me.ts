import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SqliteAuthError, sessionUser, userResponse } from "@/lib/server/sqlite-store";

function token(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/sqlite-proxy/functions/v1/wfilemanager-api/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json({ user: userResponse(sessionUser(token(request))) }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          const status = error instanceof SqliteAuthError ? error.status : 500;
          return Response.json({ error: error instanceof Error ? error.message : "Authorization failed." }, { status });
        }
      },
    },
  },
});
