import type { AuthUser, SetupPayload } from "./wfilemanager-api";

const PROJECT_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://igihzeyfgwhnuiflamvn.supabase.co";
const DATABASE_MODE =
  import.meta.env.VITE_WFILEMANAGER_DATABASE_MODE === "sqlite" ? "sqlite" : "supabase";
const SETUP_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-setup-api`;
const INSTANCE_KEY = import.meta.env.VITE_WFILEMANAGER_INSTANCE_KEY || "kmerhosting-main";
const ROOT_RESET_TOKEN_HASH = import.meta.env.VITE_WFILEMANAGER_ROOT_RESET_TOKEN_HASH || "";
const INSTANCE_SECRET_HASH = import.meta.env.VITE_WFILEMANAGER_INSTANCE_SECRET_HASH || "";

export async function setupWFileManager(data: SetupPayload) {
  const url = DATABASE_MODE === "sqlite"
    ? "/api/sqlite?scope=auth&action=setup"
    : SETUP_API_URL;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
    },
    body: JSON.stringify({
      ...data,
      ...(DATABASE_MODE === "supabase"
        ? {
            rootResetTokenHash: ROOT_RESET_TOKEN_HASH,
            instanceSecretHash: INSTANCE_SECRET_HASH,
            hostname: typeof window !== "undefined" ? window.location.hostname : undefined,
            baseUrl: typeof window !== "undefined" ? window.location.origin : undefined,
          }
        : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Setup failed (${response.status})`);
  return payload as { success: true; user: AuthUser };
}
