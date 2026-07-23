import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wfilemanager-instance, x-wfilemanager-recovery-key, x-wfilemanager-root-token",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Cache-Control": "no-store",
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

function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function instanceKeyFrom(request: Request, body: Record<string, unknown>) {
  return String(
    request.headers.get("x-wfilemanager-instance")
      || body.instanceKey
      || "",
  ).trim();
}

function recoveryKeyFrom(request: Request, body: Record<string, unknown>) {
  return String(
    request.headers.get("x-wfilemanager-recovery-key")
      || request.headers.get("x-wfilemanager-root-token")
      || body.recoveryKey
      || "",
  ).trim();
}

async function authorize(instanceKey: string, recoveryKey: string) {
  if (!instanceKey || !recoveryKey) return null;

  const { data: instance, error: instanceError } = await supabase
    .from("wfilemanager_instances")
    .select("id,instance_key,name,hostname,base_url,status,last_seen_at,frozen_at,delete_after_at,recovered_at")
    .eq("instance_key", instanceKey)
    .maybeSingle();
  if (instanceError || !instance) return null;

  const { data: recovery, error: recoveryError } = await supabase
    .from("wfilemanager_root_reset_tokens")
    .select("token_hash")
    .eq("instance_id", instance.id)
    .maybeSingle();
  if (recoveryError || !recovery?.token_hash) return null;

  const suppliedHash = await sha256(recoveryKey);
  if (!safeEqual(suppliedHash, recovery.token_hash)) return null;

  return { instance, recovery };
}

async function revokeSessions(instanceId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("wfilemanager_sessions")
    .update({ revoked_at: now })
    .eq("instance_id", instanceId)
    .is("revoked_at", null);
  if (error) throw error;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "status";
    const body = request.method === "GET"
      ? {}
      : await request.json().catch(() => ({})) as Record<string, unknown>;
    const instanceKey = instanceKeyFrom(request, body);
    const recoveryKey = recoveryKeyFrom(request, body);
    const authorized = await authorize(instanceKey, recoveryKey);

    if (!authorized) return json({ error: "Invalid instance key or recovery key" }, 401);

    const now = new Date().toISOString();
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : null;
    const hostname = typeof body.hostname === "string" ? body.hostname.trim() : null;

    if (action === "status") {
      return json({
        instanceKey: authorized.instance.instance_key,
        status: authorized.instance.status,
        lastSeenAt: authorized.instance.last_seen_at,
        frozenAt: authorized.instance.frozen_at,
        deleteAfterAt: authorized.instance.delete_after_at,
      });
    }

    if (action === "heartbeat") {
      const wasFrozen = authorized.instance.status === "frozen";
      const update: Record<string, unknown> = {
        status: "active",
        last_seen_at: now,
        frozen_at: null,
        delete_after_at: null,
        updated_at: now,
        ...(wasFrozen ? { recovered_at: now } : {}),
      };
      if (baseUrl) update.base_url = baseUrl;
      if (hostname) update.hostname = hostname;

      const { error } = await supabase
        .from("wfilemanager_instances")
        .update(update)
        .eq("id", authorized.instance.id);
      if (error) throw error;

      if (wasFrozen) await revokeSessions(authorized.instance.id);

      return json({
        success: true,
        status: "active",
        reactivated: wasFrozen,
        lastSeenAt: now,
      });
    }

    if (action === "recover") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const newRecoveryTokenHash = String(body.newRecoveryTokenHash || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(newRecoveryTokenHash)) {
        return json({ error: "A valid replacement recovery-token hash is required" }, 400);
      }

      const { error: tokenError } = await supabase
        .from("wfilemanager_root_reset_tokens")
        .update({ token_hash: newRecoveryTokenHash, updated_at: now })
        .eq("instance_id", authorized.instance.id);
      if (tokenError) throw tokenError;

      const update: Record<string, unknown> = {
        status: "active",
        last_seen_at: now,
        frozen_at: null,
        delete_after_at: null,
        recovered_at: now,
        updated_at: now,
      };
      if (baseUrl) update.base_url = baseUrl;
      if (hostname) update.hostname = hostname;

      const { error: instanceError } = await supabase
        .from("wfilemanager_instances")
        .update(update)
        .eq("id", authorized.instance.id);
      if (instanceError) throw instanceError;

      await revokeSessions(authorized.instance.id);

      await supabase.from("wfilemanager_audit_logs").insert({
        instance_id: authorized.instance.id,
        action: "instance.recover",
        target: authorized.instance.instance_key,
        result: "success",
        metadata: { sessions_revoked: true, recovery_key_rotated: true },
        ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        user_agent: request.headers.get("user-agent") || null,
      });

      return json({
        success: true,
        instanceKey: authorized.instance.instance_key,
        status: "active",
        sessionsRevoked: true,
        recoveryKeyRotated: true,
      });
    }

    if (action === "delete") {
      if (request.method !== "POST" && request.method !== "DELETE") {
        return json({ error: "Method not allowed" }, 405);
      }
      const { data, error } = await supabase.rpc("wfilemanager_delete_instance", {
        p_instance_id: authorized.instance.id,
      });
      if (error) throw error;
      return json({ success: true, deleted: Boolean(data) });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
