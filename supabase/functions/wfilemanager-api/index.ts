import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const STORAGE_FULL_MESSAGE =
  "Managed storage is full. Access is blocked. Contact support@kmerhosting.com to increase your Pro quota.";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const encoder = new TextEncoder();

type Authenticated = {
  session: Record<string, any>;
  user: Record<string, any>;
  instance: Record<string, any>;
  permissions: string[];
};
type AuthResult = Authenticated | { response: Response } | null;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
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
  return bytesToHex(new Uint8Array(bits));
}
function safeUser(user: Record<string, any>) {
  return {
    id: user.id,
    instanceId: user.instance_id,
    roleId: user.role_id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    timezone: user.timezone || "UTC",
    status: user.status,
    isAdmin: user.is_admin === true,
    mustChangePassword: user.must_change_password === true,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}
function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function isProStorageFull(instance: Record<string, any>) {
  if (instance.service_plan !== "pro") return false;
  const quota = asNumber(instance.storage_quota_bytes, 0);
  return quota > 0 && asNumber(instance.storage_used_bytes, 0) >= quota;
}
function storageBlockedResponse(instance: Record<string, any>) {
  return json(
    {
      error: STORAGE_FULL_MESSAGE,
      code: "pro_storage_full",
      storageUsedBytes: asNumber(instance.storage_used_bytes, 0),
      storageQuotaBytes: asNumber(instance.storage_quota_bytes, 0),
      supportEmail: "support@kmerhosting.com",
    },
    402,
  );
}
async function getInstance(instanceKey: string) {
  const { data, error } = await supabase
    .from("wfilemanager_instances")
    .select("*")
    .eq("instance_key", instanceKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function refreshStorageUsage(instance: Record<string, any>) {
  if (instance.service_plan !== "pro" || !instance.id) return instance;
  const { data, error } = await supabase.rpc("wfilemanager_refresh_storage_usage", {
    target_instance_id: instance.id,
  });
  return !error && typeof data === "number" ? { ...instance, storage_used_bytes: data } : instance;
}
async function touchInstance(instanceId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("wfilemanager_instances")
    .update({ last_seen_at: now, updated_at: now })
    .eq("id", instanceId)
    .eq("status", "active");
}
function cleanPermissions(value: unknown) {
  return Array.isArray(value)
    ? value.filter((permission): permission is string => typeof permission === "string")
    : [];
}

async function authenticate(request: Request, instanceKey: string): Promise<AuthResult> {
  const header = request.headers.get("authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token) return null;
  const { data: session, error: sessionError } = await supabase
    .from("wfilemanager_sessions")
    .select("*,wfilemanager_users(*)")
    .eq("token_hash", await sha256(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError || !session) return null;
  const user = session.wfilemanager_users as Record<string, any> | undefined;
  if (!user || user.status !== "active") return null;
  const rawInstance = await getInstance(instanceKey);
  if (!rawInstance || rawInstance.id !== session.instance_id || rawInstance.status !== "active")
    return null;
  const instance = await refreshStorageUsage(rawInstance);
  if (isProStorageFull(instance)) return { response: storageBlockedResponse(instance) };
  let permissions: string[] = [];
  if (user.is_admin === true) permissions = ["view_logs"];
  else if (user.role_id) {
    const { data: role } = await supabase
      .from("wfilemanager_roles")
      .select("permissions")
      .eq("id", user.role_id)
      .eq("instance_id", instance.id)
      .maybeSingle();
    permissions = cleanPermissions(role?.permissions);
  }
  const now = new Date().toISOString();
  await Promise.all([
    supabase.from("wfilemanager_sessions").update({ last_seen_at: now }).eq("id", session.id),
    touchInstance(String(instance.id)),
  ]);
  return { session, user, instance, permissions };
}

async function audit(params: {
  auth?: Authenticated;
  username?: string;
  action: string;
  target?: string;
  result?: string;
  metadata?: unknown;
  request: Request;
}) {
  await supabase.from("wfilemanager_audit_logs").insert({
    instance_id: params.auth?.instance.id ?? null,
    user_id: params.auth?.user.id ?? null,
    username: params.auth?.user.username ?? params.username ?? null,
    action: params.action,
    target: params.target ?? null,
    result: params.result ?? "success",
    metadata: params.metadata ?? {},
    ip_address: params.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: params.request.headers.get("user-agent") || null,
  });
}
function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "")
    .split(",")[0]
    .trim();
}
async function rateCheck(scope: string, identifier: string, request: Request) {
  const { data, error } = await supabase.rpc("wfilemanager_auth_rate_check", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: clientIp(request),
  });
  if (error) throw error;
  return data as { allowed?: boolean; retryAfterSeconds?: number };
}
async function rateRecord(
  scope: string,
  identifier: string,
  request: Request,
  success: boolean,
  limit = 8,
) {
  const { error } = await supabase.rpc("wfilemanager_auth_rate_record", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: clientIp(request),
    p_success: success,
    p_limit: limit,
    p_window_minutes: 15,
    p_block_minutes: 15,
  });
  if (error) console.warn("Rate-limit update failed", error.message);
}
function daysUntil(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}
async function proPlanDetails(instance: Record<string, any>) {
  if (instance.service_plan !== "pro") return null;
  const { data: token } = await supabase
    .from("wfilemanager_pro_activation_tokens")
    .select("order_reference,customer_email,claimed_at")
    .eq("claimed_by_instance_id", instance.id)
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const storageUsedBytes = asNumber(instance.storage_used_bytes, 0);
  const storageQuotaBytes = asNumber(instance.storage_quota_bytes, 104_857_600);
  const paidUntil = typeof instance.paid_until === "string" ? instance.paid_until : null;
  return {
    servicePlan: instance.service_plan || null,
    subscriptionStatus: instance.subscription_status || null,
    dataStatus: instance.data_status || null,
    paidUntil,
    nextPaymentAt: paidUntil,
    daysRemaining: daysUntil(paidUntil),
    storageUsedBytes,
    storageQuotaBytes,
    storagePercent:
      storageQuotaBytes > 0
        ? Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100))
        : 0,
    orderReference: token?.order_reference || null,
    customerEmail: token?.customer_email || null,
    activatedAt: instance.activated_at || null,
    pastDueAt: instance.past_due_at || null,
    suspendedAt: instance.suspended_at || null,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "status";
    const instanceKey =
      request.headers.get("x-wfilemanager-instance") || url.searchParams.get("instance") || "default";

    if (action === "status") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const instance = await getInstance(instanceKey);
      if (!instance) return json({ configured: false, instanceKey });
      const refreshed = await refreshStorageUsage(instance);
      const { count } = await supabase
        .from("wfilemanager_users")
        .select("id", { count: "exact", head: true })
        .eq("instance_id", refreshed.id)
        .eq("is_admin", true);
      return json({
        configured: (count || 0) > 0,
        status: refreshed.status,
        frozenAt: refreshed.frozen_at,
        deleteAfterAt: refreshed.delete_after_at,
        storageFull: isProStorageFull(refreshed),
        instance: {
          id: refreshed.id,
          name: refreshed.name,
          hostname: refreshed.hostname,
          status: refreshed.status,
        },
      });
    }

    if (["setup", "login", "users"].includes(action)) {
      return json({ error: `The legacy ${action} endpoint has been retired` }, 410);
    }

    const auth = await authenticate(request, instanceKey);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    if ("response" in auth) return auth.response;

    if (action === "verify-password") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const rate = await rateCheck("password_verify", String(auth.user.id), request);
      if (rate.allowed === false)
        return json(
          {
            error: "Too many password verification attempts. Try again later.",
            retryAfterSeconds: rate.retryAfterSeconds,
          },
          429,
        );
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const hash = await passwordHash(
        String(body.password || ""),
        String(auth.user.password_salt),
        Number(auth.user.password_iterations || 210000),
      );
      const valid = safeEqual(hash, String(auth.user.password_hash || ""));
      await rateRecord("password_verify", String(auth.user.id), request, valid);
      await audit({
        auth,
        action: "auth.password_verify",
        result: valid ? "success" : "failure",
        metadata: { purpose: "local_privilege_elevation" },
        request,
      });
      if (!valid) return json({ valid: false, error: "The password is incorrect" }, 401);
      return json({ valid: true });
    }

    if (action === "me") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      return json({
        user: safeUser(auth.user),
        instance: {
          id: auth.instance.id,
          name: auth.instance.name,
          hostname: auth.instance.hostname,
          status: auth.instance.status,
          servicePlan: auth.instance.service_plan || null,
          subscriptionStatus: auth.instance.subscription_status || null,
          dataStatus: auth.instance.data_status || null,
          paidUntil: auth.instance.paid_until || null,
          storageUsedBytes: asNumber(auth.instance.storage_used_bytes, 0),
          storageQuotaBytes: asNumber(auth.instance.storage_quota_bytes, 104_857_600),
          plan: await proPlanDetails(auth.instance),
        },
      });
    }

    if (action === "logout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      await supabase
        .from("wfilemanager_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", auth.session.id);
      await audit({ auth, action: "auth.logout", request });
      return json({ success: true });
    }

    if (action === "logs") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      if (auth.user.is_admin !== true && !auth.permissions.includes("view_logs"))
        return json({ error: "Forbidden" }, 403);
      const { data, error } = await supabase
        .from("wfilemanager_audit_logs")
        .select("*")
        .eq("instance_id", auth.instance.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return json({ logs: data || [] });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
