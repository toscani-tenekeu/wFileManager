import type { AuthUser, SetupPayload } from "./wfilemanager-api";

export async function setupWFileManager(data: SetupPayload) {
  const response = await fetch("/api/gateway?scope=setup&action=setup", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Setup failed (${response.status})`);
  return payload as { success: true; user: AuthUser };
}
