import type { AuthUser, SetupPayload } from "./wfilemanager-api";

const PROJECT_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://igihzeyfgwhnuiflamvn.supabase.co";
const SETUP_API_URL = `${PROJECT_URL}/functions/v1/wfilemanager-setup-api`;
const INSTANCE_KEY = import.meta.env.VITE_WFILEMANAGER_INSTANCE_KEY || "kmerhosting-main";
const ROOT_RESET_TOKEN_HASH =
  import.meta.env.VITE_WFILEMANAGER_ROOT_RESET_TOKEN_HASH || "";

export async function setupWFileManager(data: SetupPayload) {
  const response = await fetch(SETUP_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
    },
    body: JSON.stringify({
      ...data,
      rootResetTokenHash: ROOT_RESET_TOKEN_HASH || undefined,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Setup failed (${response.status})`);
  return payload as { success: true; user: AuthUser };
}
