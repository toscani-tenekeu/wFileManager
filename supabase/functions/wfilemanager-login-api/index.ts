import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function passwordHash(password: string, saltHex: string, iterations = 210000) {
  const pairs = saltHex.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid password salt");
  const salt = new Uint8Array(pairs.map((value) => Number.parseInt(value, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}
function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "")
    .split(",")[0]
    .trim();
}
function safeUser(user: Record<string, unknown>) {
  return {
    id: user.id,
    instanceId: user.instance_id,
    roleId: user.role_id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    isAdmin: user.is_admin,
    mustChangePassword: user.must_change_password,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}
async function rateCheck(identifier: string, ipAddress: string) {
  const { data, error } = await db.rpc("wfilemanager_auth_rate_check", {
    p_scope: "application_login",
    p_identifier_hash: await sha256(identifier),
    p_ip_address: ipAddress,
  });
  if (error) throw error;
  return data as { allowed?: boolean; retryAfterSeconds?: number };
}
async function rateRecord(identifier: string, ipAddress: string, success: boolean) {
  const { error } = await db.rpc("wfilemanager_auth_rate_record", {
    p_scope: "application_login",
    p_identifier_hash: await sha256(identifier),
    p_ip_address: ipAddress,
    p_success: success,
    p_limit: 5,
    p_window_minutes: 15,
    p_block_minutes: 15,
  });
  if (error) console.warn("Rate-limit update failed", error.message);
}
async function audit(
  request: Request,
  params: {
    instanceId?: string | null;
    userId?: string | null;
    username: string;
    result: "success" | "failure";
    reason?: string;
  },
) {
  await db.from("wfilemanager_audit_logs").insert({
    instance_id: params.instanceId || null,
    user_id: params.userId || null,
    username: params.username,
    action: "auth.login",
    result: params.result,
    metadata: params.reason
      ? { reason: params.reason, rate_limited_endpoint: true }
      : { rate_limited_endpoint: true },
    ip_address: clientIp(request) || null,
    user_agent: request.headers.get("user-agent") || null,
  });
}
function storageFull(instance: Record<string, unknown>) {
  if (instance.service_plan !== "pro") return false;
  const quota = Number(instance.storage_quota_bytes || 0);
  const used = Number(instance.storage_used_bytes || 0);
  return quota > 0 && used >= quota;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const instanceKey = String(request.headers.get("x-wfilemanager-instance") || "").trim();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const login = String(body.login || body.username || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const ipAddress = clientIp(request);
    if (!instanceKey || !login || !password)
      return json({ error: "Login and password are required" }, 400);

    const identifier = `${instanceKey}:${login}`;
    const rate = await rateCheck(identifier, ipAddress);
    if (rate.allowed === false) {
      return json(
        {
          error: "Too many sign-in attempts. Try again later.",
          retryAfterSeconds: rate.retryAfterSeconds,
        },
        429,
      );
    }

    const { data: instance, error: instanceError } = await db
      .from("wfilemanager_instances")
      .select("*")
      .eq("instance_key", instanceKey)
      .maybeSingle();
    if (instanceError) throw instanceError;
    if (!instance) return json({ error: "Instance is not configured" }, 404);
    if (instance.status === "frozen")
      return json(
        {
          error:
            "This installation is frozen after 30 days without a valid server heartbeat. Recover it with the saved Recovery Kit.",
          status: "frozen",
          deleteAfterAt: instance.delete_after_at,
        },
        423,
      );
    if (
      instance.subscription_status === "suspended" ||
      instance.subscription_status === "expired" ||
      instance.data_status === "suspended" ||
      instance.data_status === "pending_delete"
    ) {
      return json(
        {
          error: "This Pro subscription requires payment before sign-in.",
          paymentRequired: true,
          deleteAfterAt: instance.delete_after_at,
        },
        402,
      );
    }
    if (instance.status !== "active") return json({ error: "This installation is disabled" }, 403);

    if (instance.service_plan === "pro") {
      const { data: used } = await db.rpc("wfilemanager_refresh_storage_usage", {
        target_instance_id: instance.id,
      });
      if (typeof used === "number") instance.storage_used_bytes = used;
      if (storageFull(instance))
        return json(
          {
            error: "Managed storage is full. Increase the Pro quota before signing in.",
            code: "pro_storage_full",
            storageUsedBytes: instance.storage_used_bytes,
            storageQuotaBytes: instance.storage_quota_bytes,
          },
          402,
        );
    }

    const { data: user, error: userError } = await db
      .from("wfilemanager_users")
      .select("*")
      .eq("instance_id", instance.id)
      .or(`username.eq.${login},email.eq.${login}`)
      .maybeSingle();
    if (userError) throw userError;
    if (!user || user.status !== "active") {
      await rateRecord(identifier, ipAddress, false);
      await audit(request, {
        instanceId: instance.id,
        username: login,
        result: "failure",
        reason: "invalid_credentials",
      });
      return json({ error: "Invalid username or password" }, 401);
    }

    const hash = await passwordHash(
      password,
      user.password_salt,
      Number(user.password_iterations || 210000),
    );
    if (hash !== user.password_hash) {
      await rateRecord(identifier, ipAddress, false);
      await audit(request, {
        instanceId: instance.id,
        userId: user.id,
        username: user.username,
        result: "failure",
        reason: "invalid_credentials",
      });
      return json({ error: "Invalid username or password" }, 401);
    }

    await rateRecord(identifier, ipAddress, true);
    const rawToken = randomHex(32);
    const expiresAt = new Date(
      Date.now() + (body.remember ? 30 * 24 : 12) * 60 * 60 * 1000,
    ).toISOString();
    const { error: sessionError } = await db.from("wfilemanager_sessions").insert({
      instance_id: instance.id,
      user_id: user.id,
      token_hash: await sha256(rawToken),
      expires_at: expiresAt,
      user_agent: request.headers.get("user-agent") || null,
      ip_address: ipAddress || null,
    });
    if (sessionError) throw sessionError;
    const now = new Date().toISOString();
    await Promise.all([
      db.from("wfilemanager_users").update({ last_login_at: now }).eq("id", user.id),
      db
        .from("wfilemanager_instances")
        .update({ last_seen_at: now, updated_at: now })
        .eq("id", instance.id),
    ]);
    await audit(request, {
      instanceId: instance.id,
      userId: user.id,
      username: user.username,
      result: "success",
    });
    return json({ token: rawToken, expiresAt, user: safeUser(user) });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Sign-in failed" }, 500);
  }
});
