import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { healthSummary } from "@/lib/server/health-runtime";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const result = await healthSummary(url.searchParams.get("scope"));
        return Response.json(result, {
          status: result.ok ? 200 : 503,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
