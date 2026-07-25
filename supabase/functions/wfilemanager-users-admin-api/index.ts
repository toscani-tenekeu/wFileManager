import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Cache-Control": "no-store",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;

type Row = Record<string, unknown>;

type Authenticated = {
  session: Row;
  actor: Row;
  instance: Row;
  permissions: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function clean(value: unknown) {
  return String(value ?? "").trim();
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function passwordHash(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexBytes(salt), iterations, hash: "SHA-256" },
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
  for (const character of password) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return "Password contains unsupported control characters";
  }
  return "";
}
function bearer(request: Request) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "")
    .split(",")[0]
    .trim();
}
function safeUser(user: Row, roleName?: string | null) {
  return {
    id: user.id,
    instanceId: user.instance_id,
    roleId: user.role_id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    timezone: user.timezone || "UTC",
    status: user.status,
    isAdmin: user.is_admin,
    mustChangePassword: user.must_change_password,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    roleName: roleName || null,
  };
}

async function authenticate(request: Request): Promise<Authenticated | null> {
  const instanceKey = clean(request.headers.get("x-wfilemanager-instance"));
  const token = bearer(request);
  if (!instanceKey || !token) return null;
  const { data: session, error: sessionError } = await db
    .from("wfilemanager_sessions")
    .select("*,wfilemanager_users(*)")
    .eq("token_hash", await sha256(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError || !session) return null;
  const actor = session.wfilemanager_users as Row | undefined;
  if (!actor || actor.status !== "active") return null;
  const { data: instance, error: instanceError } = await db
    .from("wfilemanager_instances")
    .select("*")
    .eq("instance_key", instanceKey)
    .eq("id", session.instance_id)
    .eq("status", "active")
    .maybeSingle();
  if (instanceError || !instance) return null;

  let permissions: string[] = [];
  if (actor.is_admin === true) permissions = ["manage_users"];
  else if (actor.role_id) {
    const { data: role } = await db
      .from("wfilemanager_roles")
      .select("permissions")
      .eq("id", actor.role_id)
      .eq("instance_id", instance.id)
      .maybeSingle();
    permissions = Array.isArray(role?.permissions)
      ? role.permissions.filter(
          (permission): permission is string => typeof permission === "string",
        )
      : [];
  }
  if (!permissions.includes("manage_users")) return null;
  return { session, actor, instance, permissions };
}

async function audit(
  request: Request,
  auth: Authenticated,
  action: string,
  target?: string,
  result = "success",
) {
  await db.from("wfilemanager_audit_logs").insert({
    instance_id: auth.instance.id,
    user_id: auth.actor.id,
    username: auth.actor.username,
    action,
    target: target || null,
    result,
    metadata: { endpoint: "users-admin" },
    ip_address: clientIp(request) || null,
    user_agent: request.headers.get("user-agent") || null,
  });
}

async function listUsers(auth: Authenticated) {
  const { data, error } = await db
    .from("wfilemanager_users")
    .select(
      "id,instance_id,role_id,username,email,display_name,timezone,status,is_admin,must_change_password,last_login_at,created_at,wfilemanager_roles(name)",
    )
    .eq("instance_id", auth.instance.id)
    .order("is_admin", { ascending: false })
    .order("username", { ascending: true });
  if (error) throw error;
  return json({
    users: (data || []).map((user) =>
      safeUser(user, (user.wfilemanager_roles as { name?: string } | null)?.name || null),
    ),
  });
}

async function createUser(request: Request, auth: Authenticated, body: Row) {
  const username = clean(body.username).toLowerCase();
  const email = clean(body.email).toLowerCase() || null;
  const displayName = clean(body.displayName || body.display_name);
  const password = String(body.password || "");
  const roleId = clean(body.roleId || body.role_id) || null;
  const status = ["active", "disabled", "invited"].includes(clean(body.status))
    ? clean(body.status)
    : "active";
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return json(
      {
        error:
          "Username must contain 3 to 64 lowercase letters, numbers, dots, underscores or hyphens",
      },
      400,
    );
  }
  if (displayName.length < 2 || displayName.length > 120) {
    return json({ error: "Display name must contain 2 to 120 characters" }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Email address is invalid" }, 400);
  }
  const policyError = passwordPolicy(password);
  if (policyError) return json({ error: policyError }, 400);
  if (roleId) {
    const { data: role, error: roleError } = await db
      .from("wfilemanager_roles")
      .select("id")
      .eq("id", roleId)
      .eq("instance_id", auth.instance.id)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role)
      return json({ error: "The selected role does not belong to this installation" }, 400);
  }
  const salt = randomHex(16);
  const { data, error } = await db
    .from("wfilemanager_users")
    .insert({
      instance_id: auth.instance.id,
      role_id: roleId,
      username,
      email,
      display_name: displayName,
      password_hash: await passwordHash(password, salt),
      password_salt: salt,
      password_iterations: PASSWORD_ITERATIONS,
      status,
      is_admin: false,
      must_change_password: body.mustChangePassword !== false,
      timezone: "UTC",
    })
    .select("*")
    .single();
  if (error) {
    await audit(request, auth, "user.create", username, "failure");
    if (String(error.code) === "23505")
      return json({ error: "Username or email already exists" }, 409);
    throw error;
  }
  await audit(request, auth, "user.create", username);
  return json({ user: safeUser(data) }, 201);
}

async function deleteUser(request: Request, auth: Authenticated, body: Row) {
  const id = clean(body.id);
  if (!id) return json({ error: "User id is required" }, 400);
  if (id === auth.actor.id) return json({ error: "You cannot delete your own account" }, 400);
  const { data: target, error: targetError } = await db
    .from("wfilemanager_users")
    .select("id,username,display_name,is_admin")
    .eq("id", id)
    .eq("instance_id", auth.instance.id)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return json({ error: "User was not found" }, 404);
  if (target.is_admin === true)
    return json({ error: "The installation administrator cannot be deleted" }, 409);
  const { error } = await db
    .from("wfilemanager_users")
    .delete()
    .eq("id", id)
    .eq("instance_id", auth.instance.id)
    .eq("is_admin", false);
  if (error) throw error;
  await audit(request, auth, "user.delete", target.username);
  return json({
    success: true,
    deleted: {
      id: target.id,
      username: target.username,
      displayName: target.display_name,
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "users";
    if (action === "status") return json({ ok: true, strongPasswords: true, auditLogs: true });
    if (action !== "users") return json({ error: "Not found" }, 404);
    const auth = await authenticate(request);
    if (!auth) return json({ error: "Administrator or manage users permission required" }, 403);
    if (request.method === "GET") return listUsers(auth);
    const body = (await request.json().catch(() => ({}))) as Row;
    if (request.method === "POST") return createUser(request, auth, body);
    if (request.method === "DELETE") return deleteUser(request, auth, body);
    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "User administration failed" },
      500,
    );
  }
});
