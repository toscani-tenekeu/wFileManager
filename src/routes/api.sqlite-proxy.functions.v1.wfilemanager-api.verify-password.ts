import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { SqliteAuthError, sessionUser, verifyPassword } from "@/lib/server/sqlite-store";

function token(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export const Route = createFileRoute("/api/sqlite-proxy/functions/v1/wfilemanager-api/verify-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = await request.json().catch(() => ({})) as { password?: unknown };
          const user = sessionUser(token(request));
          return Response.json(verifyPassword(user, payload.password), { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          const status = error instanceof SqliteAuthError ? error.status : 500;
          return Response.json({ error: error instanceof Error ? error.message : "Password verification failed." }, { status });
        }
      },
    },
  },
});
