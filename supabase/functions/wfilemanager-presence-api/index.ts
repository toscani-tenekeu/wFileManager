import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "presence";
    if (action !== "presence") return json({ error: "Not found" }, 404);

    const instanceKey = req.headers.get("x-wfilemanager-instance") || url.searchParams.get("instance") || "default";
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return json({ error: "Unauthorized" }, 401);

    const { data: instance, error: instanceError } = await supabase
      .from("wfilemanager_instances")
      .select("id")
      .eq("instance_key", instanceKey)
      .maybeSingle();
    if (instanceError) throw instanceError;
    if (!instance) return json({ error: "Instance not found" }, 404);

    const now = new Date();
    const tokenHash = await sha256(token);
    const { data: currentSession, error: sessionError } = await supabase
      .from("wfilemanager_sessions")
      .select("id,user_id")
      .eq("instance_id", instance.id)
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!currentSession) return json({ error: "Unauthorized" }, 401);

    await supabase
      .from("wfilemanager_sessions")
      .update({ last_seen_at: now.toISOString() })
      .eq("id", currentSession.id);

    const onlineWindowSeconds = 120;
    const activeSince = new Date(now.getTime() - onlineWindowSeconds * 1000).toISOString();
    const { data: sessions, error: activeError } = await supabase
      .from("wfilemanager_sessions")
      .select("user_id,wfilemanager_users!inner(status)")
      .eq("instance_id", instance.id)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      .gte("last_seen_at", activeSince)
      .eq("wfilemanager_users.status", "active");
    if (activeError) throw activeError;

    const onlineUsers = new Set((sessions || []).map((session: any) => session.user_id)).size;
    return json({ onlineUsers, onlineWindowSeconds, checkedAt: now.toISOString() });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
