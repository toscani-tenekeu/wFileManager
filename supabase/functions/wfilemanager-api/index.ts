import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
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

type AuthResult =
  | {
      session: Record<string, unknown>;
      user: Record<string, unknown>;
      instance: Record<string, unknown>;
    }
  | { response: Response }
  | null;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
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

async function getInstance(instanceKey: string) {
  const { data, error } = await supabase
    .from("wfilemanager_instances")
    .select("*")
    .eq("instance_key", instanceKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function touchInstance(instanceId: string) {
  const now = new Date().toISOString();
  await supabase
    .from("wfilemanager_instances")
    .update({
      last_seen_at: now,
      updated_at: now,
    })
    .eq("id", instanceId)
    .eq("status", "active");
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isProStorageFull(instance: Record<string, unknown>) {
  if (instance.service_plan !== "pro") return false;
  const quota = asNumber(instance.storage_quota_bytes, 0);
  const used = asNumber(instance.storage_used_bytes, 0);
  return quota > 0 && used >= quota;
}

function storageBlockedResponse(instance: Record<string, unknown>) {
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

async function refreshStorageUsage(instance: Record<string, unknown>) {
  if (instance.service_plan !== "pro" || !instance.id) return instance;
  const { data, error } = await supabase.rpc("wfilemanager_refresh_storage_usage", {
    target_instance_id: instance.id,
  });
  if (!error && typeof data === "number") {
    return { ...instance, storage_used_bytes: data };
  }
  return instance;
}

async function authenticate(request: Request, instanceKey: string): Promise<AuthResult> {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await supabase
    .from("wfilemanager_sessions")
    .select("*, wfilemanager_users(*)")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  const user = data.wfilemanager_users;
  if (!user || user.status !== "active") return null;
  const rawInstance = await getInstance(instanceKey);
  if (!rawInstance || rawInstance.id !== data.instance_id || rawInstance.status !== "active")
    return null;
  const instance = await refreshStorageUsage(rawInstance);
  if (isProStorageFull(instance)) return { response: storageBlockedResponse(instance) };
  const now = new Date().toISOString();
  await Promise.all([
    supabase.from("wfilemanager_sessions").update({ last_seen_at: now }).eq("id", data.id),
    touchInstance(String(instance.id)),
  ]);
  return { session: data, user, instance };
}

async function audit(params: {
  instanceId?: string;
  userId?: string;
  username?: string;
  action: string;
  target?: string;
  result?: string;
  metadata?: unknown;
  request: Request;
}) {
  await supabase.from("wfilemanager_audit_logs").insert({
    instance_id: params.instanceId ?? null,
    user_id: params.userId ?? null,
    username: params.username ?? null,
    action: params.action,
    target: params.target ?? null,
    result: params.result ?? "success",
    metadata: params.metadata ?? {},
    ip_address: params.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: params.request.headers.get("user-agent") || null,
  });
}

function daysUntil(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

async function proPlanDetails(instance: Record<string, unknown>) {
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
  const storagePercent =
    storageQuotaBytes > 0
      ? Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100))
      : 0;
  const paidUntil = typeof instance.paid_until === "string" ? instance.paid_until : null;

  return {
    servicePlan: typeof instance.service_plan === "string" ? instance.service_plan : null,
    subscriptionStatus:
      typeof instance.subscription_status === "string" ? instance.subscription_status : null,
    dataStatus: typeof instance.data_status === "string" ? instance.data_status : null,
    paidUntil,
    nextPaymentAt: paidUntil,
    daysRemaining: daysUntil(paidUntil),
    storageUsedBytes,
    storageQuotaBytes,
    storagePercent,
    orderReference: token?.order_reference || null,
    customerEmail: token?.customer_email || null,
    activatedAt: typeof instance.activated_at === "string" ? instance.activated_at : null,
    pastDueAt: typeof instance.past_due_at === "string" ? instance.past_due_at : null,
    suspendedAt: typeof instance.suspended_at === "string" ? instance.suspended_at : null,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "status";
    const instanceKey =
      request.headers.get("x-wfilemanager-instance") ||
      url.searchParams.get("instance") ||
      "default";
    const body =
      request.method === "GET"
        ? {}
        : ((await request.json().catch(() => ({}))) as Record<string, unknown>);

    if (action === "status") {
      const instance = await getInstance(instanceKey);
      if (!instance) return json({ configured: false, instanceKey });
      const refreshedInstance = await refreshStorageUsage(instance);
      const { count } = await supabase
        .from("wfilemanager_users")
        .select("id", { count: "exact", head: true })
        .eq("instance_id", refreshedInstance.id)
        .eq("is_admin", true);
      return json({
        configured: (count || 0) > 0,
        status: refreshedInstance.status,
        frozenAt: refreshedInstance.frozen_at,
        deleteAfterAt: refreshedInstance.delete_after_at,
        storageFull: isProStorageFull(refreshedInstance),
        instance: {
          id: refreshedInstance.id,
          name: refreshedInstance.name,
          hostname: refreshedInstance.hostname,
          status: refreshedInstance.status,
        },
      });
    }

    if (action === "setup") {
      return json({ error: "Use the dedicated setup endpoint" }, 410);
    }

    if (action === "login") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const rawInstance = await getInstance(instanceKey);
      if (!rawInstance) return json({ error: "Instance is not configured" }, 404);
      if (rawInstance.status === "frozen") {
        return json(
          {
            error:
              "This installation is frozen after 30 days without a valid server heartbeat. Recover it with the saved Recovery Kit.",
            status: "frozen",
            deleteAfterAt: rawInstance.delete_after_at,
          },
          423,
        );
      }
      if (rawInstance.status !== "active")
        return json({ error: "This installation is disabled" }, 403);
      const instance = await refreshStorageUsage(rawInstance);
      if (isProStorageFull(instance)) return storageBlockedResponse(instance);

      const login = String(body.login || body.username || "")
        .trim()
        .toLowerCase();
      const { data: user } = await supabase
        .from("wfilemanager_users")
        .select("*")
        .eq("instance_id", instance.id)
        .or(`username.eq.${login},email.eq.${login}`)
        .maybeSingle();
      if (!user || user.status !== "active") {
        await audit({
          instanceId: String(instance.id),
          username: login,
          action: "auth.login",
          result: "failure",
          metadata: { reason: "invalid_credentials" },
          request,
        });
        return json({ error: "Invalid username or password" }, 401);
      }

      const hash = await passwordHash(
        String(body.password || ""),
        user.password_salt,
        user.password_iterations || 210000,
      );
      if (hash !== user.password_hash) {
        await audit({
          instanceId: String(instance.id),
          userId: user.id,
          username: user.username,
          action: "auth.login",
          result: "failure",
          metadata: { reason: "invalid_credentials" },
          request,
        });
        return json({ error: "Invalid username or password" }, 401);
      }

      const rawToken = randomHex(32);
      const tokenHash = await sha256(rawToken);
      const expires = new Date(Date.now() + (body.remember ? 30 * 24 : 12) * 60 * 60 * 1000);
      const sessionResult = await supabase
        .from("wfilemanager_sessions")
        .insert({
          instance_id: instance.id,
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expires.toISOString(),
          user_agent: request.headers.get("user-agent"),
          ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        })
        .select("id, expires_at")
        .single();
      if (sessionResult.error) throw sessionResult.error;

      const now = new Date().toISOString();
      await Promise.all([
        supabase.from("wfilemanager_users").update({ last_login_at: now }).eq("id", user.id),
        touchInstance(String(instance.id)),
      ]);
      await audit({
        instanceId: String(instance.id),
        userId: user.id,
        username: user.username,
        action: "auth.login",
        request,
      });
      return json({
        token: rawToken,
        expiresAt: sessionResult.data.expires_at,
        user: safeUser(user),
      });
    }

    const auth = await authenticate(request, instanceKey);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    if ("response" in auth) return auth.response;

    if (action === "verify-password") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const password = String(body.password || "");
      const hash = await passwordHash(
        password,
        String(auth.user.password_salt),
        Number(auth.user.password_iterations || 210000),
      );
      const valid = hash === auth.user.password_hash;
      await audit({
        instanceId: String(auth.instance.id),
        userId: String(auth.user.id),
        username: String(auth.user.username),
        action: "auth.password_verify",
        result: valid ? "success" : "failure",
        metadata: { purpose: "local_privilege_elevation" },
        request,
      });
      if (!valid) return json({ valid: false, error: "The password is incorrect" }, 401);
      return json({ valid: true });
    }

    if (action === "me") {
      const plan = await proPlanDetails(auth.instance);
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
          plan,
        },
      });
    }

    if (action === "logout") {
      const header = request.headers.get("Authorization") || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (token) {
        await supabase
          .from("wfilemanager_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("token_hash", await sha256(token));
      }
      await audit({
        instanceId: String(auth.instance.id),
        userId: String(auth.user.id),
        username: String(auth.user.username),
        action: "auth.logout",
        request,
      });
      return json({ success: true });
    }

    if (action === "users") {
      if (!auth.user.is_admin) return json({ error: "Forbidden" }, 403);
      if (request.method === "GET") {
        const { data, error } = await supabase
          .from("wfilemanager_users")
          .select(
            "id,instance_id,role_id,username,email,display_name,status,is_admin,must_change_password,last_login_at,created_at",
          )
          .eq("instance_id", auth.instance.id)
          .order("created_at");
        if (error) throw error;
        return json({ users: (data || []).map(safeUser) });
      }
      if (request.method === "POST") {
        const username = String(body.username || "")
          .trim()
          .toLowerCase();
        const password = String(body.password || "");
        if (username.length < 3 || password.length < 8)
          return json({ error: "Invalid username or password length" }, 400);
        const salt = randomHex(16);
        const userResult = await supabase
          .from("wfilemanager_users")
          .insert({
            instance_id: auth.instance.id,
            role_id: body.roleId || null,
            username,
            email: body.email ? String(body.email).trim().toLowerCase() : null,
            display_name: String(body.displayName || username),
            password_hash: await passwordHash(password, salt),
            password_salt: salt,
            status: body.status || "active",
            is_admin: false,
            must_change_password: Boolean(body.mustChangePassword),
          })
          .select()
          .single();
        if (userResult.error) throw userResult.error;
        await audit({
          instanceId: String(auth.instance.id),
          userId: String(auth.user.id),
          username: String(auth.user.username),
          action: "user.create",
          target: username,
          request,
        });
        return json({ user: safeUser(userResult.data) }, 201);
      }
    }

    if (action === "logs") {
      if (!auth.user.is_admin) return json({ error: "Forbidden" }, 403);
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
