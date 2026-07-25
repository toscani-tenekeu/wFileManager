import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "GET,PATCH,POST,DELETE,OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const randomHex = (length: number) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
};
const sha256 = async (value: string) =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function hexBytes(value: string) {
  const pairs = value.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid password salt");
  return new Uint8Array(pairs.map((item) => Number.parseInt(item, 16)));
}
async function passwordHash(password: string, saltHex: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexBytes(saltHex), iterations },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}
function passwordPolicy(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters";
  if (password.length > 256) return "Password is too long";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  if (/[\u0000-\u001f\u007f]/.test(password))
    return "Password contains unsupported control characters";
  return "";
}
function safeUser(user: any) {
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
function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "")
    .split(",")[0]
    .trim();
}
async function rateCheck(scope: string, identifier: string, request: Request) {
  const { data, error } = await db.rpc("wfilemanager_auth_rate_check", {
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
) {
  const { error } = await db.rpc("wfilemanager_auth_rate_record", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: clientIp(request),
    p_success: success,
    p_limit: 8,
    p_window_minutes: 15,
    p_block_minutes: 15,
  });
  if (error) console.warn("Rate-limit update failed", error.message);
}
async function authenticate(req: Request, instanceKey: string) {
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token) return null;
  const { data: instance } = await db
    .from("wfilemanager_instances")
    .select("*")
    .eq("instance_key", instanceKey)
    .eq("status", "active")
    .maybeSingle();
  if (!instance) return null;
  const { data: session } = await db
    .from("wfilemanager_sessions")
    .select("*")
    .eq("token_hash", await sha256(token))
    .eq("instance_id", instance.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!session) return null;
  const { data: user } = await db
    .from("wfilemanager_users")
    .select("*")
    .eq("id", session.user_id)
    .eq("instance_id", instance.id)
    .maybeSingle();
  if (!user || user.status !== "active") return null;
  await db
    .from("wfilemanager_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", session.id);
  return { token, session, user, instance };
}
async function audit(req: Request, auth: any, action: string, target?: string, result = "success") {
  await db.from("wfilemanager_audit_logs").insert({
    instance_id: auth.instance.id,
    user_id: auth.user.id,
    username: auth.user.username,
    action,
    target: target || null,
    result,
    metadata: {},
    ip_address: clientIp(req) || null,
    user_agent: req.headers.get("user-agent") || null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "profile";
    const instanceKey = req.headers.get("x-wfilemanager-instance") || "default";
    const auth = await authenticate(req, instanceKey);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));

    if (action === "profile") {
      if (req.method === "GET") return json({ user: safeUser(auth.user) });
      if (req.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
      const displayName = String(body.displayName || "").trim();
      const email = body.email ? String(body.email).trim().toLowerCase() : null;
      const timezone = String(body.timezone || "UTC").trim() || "UTC";
      if (displayName.length < 2 || displayName.length > 120)
        return json({ error: "Display name must contain 2 to 120 characters" }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return json({ error: "Email address is invalid" }, 400);
      const { data, error } = await db
        .from("wfilemanager_users")
        .update({ display_name: displayName, email, timezone, updated_at: new Date().toISOString() })
        .eq("id", auth.user.id)
        .eq("instance_id", auth.instance.id)
        .select()
        .single();
      if (error) throw error;
      await audit(req, auth, "account.profile.update", auth.user.username);
      return json({ user: safeUser(data) });
    }

    if (action === "password") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      const policyError = passwordPolicy(newPassword);
      if (policyError) return json({ error: policyError }, 400);
      const rate = await rateCheck("account_password_change", String(auth.user.id), req);
      if (rate.allowed === false)
        return json(
          {
            error: "Too many password attempts. Try again later.",
            retryAfterSeconds: rate.retryAfterSeconds,
          },
          429,
        );
      const currentHash = await passwordHash(
        currentPassword,
        String(auth.user.password_salt),
        Number(auth.user.password_iterations || PASSWORD_ITERATIONS),
      );
      const valid = safeEqual(currentHash, String(auth.user.password_hash || ""));
      await rateRecord("account_password_change", String(auth.user.id), req, valid);
      if (!valid) {
        await audit(req, auth, "account.password.change", auth.user.username, "failure");
        return json({ error: "Current password is incorrect" }, 401);
      }
      const salt = randomHex(16);
      const hash = await passwordHash(newPassword, salt, PASSWORD_ITERATIONS);
      const { error } = await db
        .from("wfilemanager_users")
        .update({
          password_hash: hash,
          password_salt: salt,
          password_iterations: PASSWORD_ITERATIONS,
          must_change_password: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", auth.user.id)
        .eq("instance_id", auth.instance.id);
      if (error) throw error;
      await db
        .from("wfilemanager_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", auth.user.id)
        .eq("instance_id", auth.instance.id)
        .neq("id", auth.session.id)
        .is("revoked_at", null);
      await audit(req, auth, "account.password.change", auth.user.username);
      return json({ success: true });
    }

    if (action === "sessions") {
      if (req.method === "GET") {
        const { data, error } = await db
          .from("wfilemanager_sessions")
          .select("id,expires_at,last_seen_at,ip_address,user_agent,created_at")
          .eq("user_id", auth.user.id)
          .eq("instance_id", auth.instance.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("last_seen_at", { ascending: false });
        if (error) throw error;
        return json({
          sessions: (data || []).map((session: any) => ({
            id: session.id,
            expiresAt: session.expires_at,
            lastSeenAt: session.last_seen_at,
            ipAddress: session.ip_address,
            userAgent: session.user_agent,
            createdAt: session.created_at,
            current: session.id === auth.session.id,
          })),
        });
      }
      if (req.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
      if (body.all === true) {
        await db
          .from("wfilemanager_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("user_id", auth.user.id)
          .eq("instance_id", auth.instance.id)
          .is("revoked_at", null);
        await audit(req, auth, "account.sessions.revoke_all", auth.user.username);
        return json({ success: true, currentRevoked: true });
      }
      const id = String(body.id || "");
      if (!id) return json({ error: "Session id is required" }, 400);
      const { data: target } = await db
        .from("wfilemanager_sessions")
        .select("id")
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .eq("instance_id", auth.instance.id)
        .maybeSingle();
      if (!target) return json({ error: "Session not found" }, 404);
      await db
        .from("wfilemanager_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      await audit(req, auth, "account.session.revoke", id);
      return json({ success: true, currentRevoked: id === auth.session.id });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
