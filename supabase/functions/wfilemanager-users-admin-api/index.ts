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
const MAX_PATH_RULES = 32;

type Row = Record<string, any>;
type Authenticated = { session: Row; actor: Row; instance: Row; permissions: string[] };

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
  const pairs = value.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid password salt");
  return new Uint8Array(pairs.map((item) => Number.parseInt(item, 16)));
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
  if (/[\u0000-\u001f\u007f]/.test(password))
    return "Password contains unsupported control characters";
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
function normalizePath(value: unknown) {
  const raw = clean(value);
  if (!raw.startsWith("/") || raw.includes("\0") || raw.length > 4096) return null;
  const parts: string[] = [];
  for (const part of raw.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return `/${parts.join("/")}` || "/";
}
function allowedPaths(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const normalized = normalizePath(item);
    if (normalized && !result.includes(normalized)) result.push(normalized);
    if (result.length >= MAX_PATH_RULES) break;
  }
  return result;
}
function safeUser(user: Row, roleName?: string | null, paths: string[] = []) {
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
    roleName: roleName || null,
    allowedPaths: user.is_admin === true ? ["/"] : paths,
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
      ? role.permissions.filter((permission): permission is string => typeof permission === "string")
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
  metadata: Record<string, unknown> = {},
) {
  await db.from("wfilemanager_audit_logs").insert({
    instance_id: auth.instance.id,
    user_id: auth.actor.id,
    username: auth.actor.username,
    action,
    target: target || null,
    result,
    metadata: { endpoint: "users-admin", ...metadata },
    ip_address: clientIp(request) || null,
    user_agent: request.headers.get("user-agent") || null,
  });
}

async function roleFor(auth: Authenticated, roleId: string | null) {
  if (!roleId) return null;
  const { data, error } = await db
    .from("wfilemanager_roles")
    .select("id,name,is_system")
    .eq("id", roleId)
    .eq("instance_id", auth.instance.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The selected role does not belong to this installation");
  if (String(data.name).toLowerCase() === "administrator")
    throw new Error("The Administrator role cannot be assigned to another account");
  return data;
}

async function replacePaths(auth: Authenticated, userId: string, paths: string[]) {
  const { error: deleteError } = await db
    .from("wfilemanager_path_rules")
    .delete()
    .eq("instance_id", auth.instance.id)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;
  if (!paths.length) return;
  const { error } = await db.from("wfilemanager_path_rules").insert(
    paths.map((path) => ({
      instance_id: auth.instance.id,
      user_id: userId,
      role_id: null,
      path,
      access_mode: "allow",
      recursive: true,
    })),
  );
  if (error) throw error;
}

async function listUsers(auth: Authenticated) {
  const [{ data: users, error }, { data: rules, error: rulesError }] = await Promise.all([
    db
      .from("wfilemanager_users")
      .select(
        "id,instance_id,role_id,username,email,display_name,timezone,status,is_admin,must_change_password,last_login_at,created_at,wfilemanager_roles(name)",
      )
      .eq("instance_id", auth.instance.id)
      .order("is_admin", { ascending: false })
      .order("username", { ascending: true }),
    db
      .from("wfilemanager_path_rules")
      .select("user_id,path,access_mode,recursive")
      .eq("instance_id", auth.instance.id)
      .not("user_id", "is", null),
  ]);
  if (error) throw error;
  if (rulesError) throw rulesError;
  const paths = new Map<string, string[]>();
  for (const rule of rules || []) {
    if (!rule.user_id || rule.access_mode !== "allow" || rule.recursive !== true) continue;
    const values = paths.get(rule.user_id) || [];
    values.push(String(rule.path));
    paths.set(rule.user_id, values);
  }
  return json({
    users: (users || []).map((user) =>
      safeUser(
        user,
        (user.wfilemanager_roles as { name?: string } | null)?.name || null,
        paths.get(user.id) || [],
      ),
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
  const paths = allowedPaths(body.allowedPaths);
  if (!/^[a-z0-9._-]{3,64}$/.test(username))
    return json(
      {
        error:
          "Username must contain 3 to 64 lowercase letters, numbers, dots, underscores or hyphens",
      },
      400,
    );
  if (displayName.length < 2 || displayName.length > 120)
    return json({ error: "Display name must contain 2 to 120 characters" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: "Email address is invalid" }, 400);
  const policyError = passwordPolicy(password);
  if (policyError) return json({ error: policyError }, 400);
  try {
    await roleFor(auth, roleId);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid role" }, 400);
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
  try {
    await replacePaths(auth, data.id, paths);
  } catch (error) {
    await db.from("wfilemanager_users").delete().eq("id", data.id).eq("instance_id", auth.instance.id);
    throw error;
  }
  await audit(request, auth, "user.create", username, "success", { allowedPaths: paths });
  return json({ user: safeUser(data, null, paths) }, 201);
}

async function updateUser(request: Request, auth: Authenticated, body: Row) {
  const id = clean(body.id);
  if (!id) return json({ error: "User id is required" }, 400);
  if (id === auth.actor.id) return json({ error: "Use Account settings to edit your own account" }, 400);
  const { data: target, error: targetError } = await db
    .from("wfilemanager_users")
    .select("*")
    .eq("id", id)
    .eq("instance_id", auth.instance.id)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return json({ error: "User was not found" }, 404);
  if (target.is_admin === true) return json({ error: "The installation administrator cannot be modified" }, 409);

  const updates: Row = { updated_at: new Date().toISOString() };
  if (body.displayName !== undefined) {
    const displayName = clean(body.displayName);
    if (displayName.length < 2 || displayName.length > 120)
      return json({ error: "Display name must contain 2 to 120 characters" }, 400);
    updates.display_name = displayName;
  }
  if (body.email !== undefined) {
    const email = clean(body.email).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ error: "Email address is invalid" }, 400);
    updates.email = email;
  }
  if (body.status !== undefined) {
    const status = clean(body.status);
    if (!["active", "disabled", "invited"].includes(status))
      return json({ error: "Invalid account status" }, 400);
    updates.status = status;
  }
  if (body.mustChangePassword !== undefined)
    updates.must_change_password = body.mustChangePassword === true;
  if (body.roleId !== undefined) {
    const roleId = clean(body.roleId) || null;
    try {
      await roleFor(auth, roleId);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid role" }, 400);
    }
    updates.role_id = roleId;
  }
  let passwordChanged = false;
  if (typeof body.password === "string" && body.password) {
    const policyError = passwordPolicy(body.password);
    if (policyError) return json({ error: policyError }, 400);
    const salt = randomHex(16);
    updates.password_hash = await passwordHash(body.password, salt);
    updates.password_salt = salt;
    updates.password_iterations = PASSWORD_ITERATIONS;
    updates.must_change_password = body.mustChangePassword !== false;
    passwordChanged = true;
  }

  const { data, error } = await db
    .from("wfilemanager_users")
    .update(updates)
    .eq("id", id)
    .eq("instance_id", auth.instance.id)
    .eq("is_admin", false)
    .select("*")
    .single();
  if (error) {
    if (String(error.code) === "23505") return json({ error: "Email already exists" }, 409);
    throw error;
  }
  let paths: string[] = [];
  if (body.allowedPaths !== undefined) {
    paths = allowedPaths(body.allowedPaths);
    await replacePaths(auth, id, paths);
  } else {
    const { data: existing, error: pathError } = await db
      .from("wfilemanager_path_rules")
      .select("path")
      .eq("instance_id", auth.instance.id)
      .eq("user_id", id)
      .eq("access_mode", "allow")
      .eq("recursive", true);
    if (pathError) throw pathError;
    paths = (existing || []).map((rule) => String(rule.path));
  }
  if (passwordChanged || updates.status === "disabled") {
    await db
      .from("wfilemanager_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("instance_id", auth.instance.id)
      .eq("user_id", id)
      .is("revoked_at", null);
  }
  const role = data.role_id ? await roleFor(auth, String(data.role_id)) : null;
  await audit(request, auth, "user.update", String(data.username), "success", {
    passwordChanged,
    status: data.status,
    allowedPaths: paths,
  });
  return json({ user: safeUser(data, role?.name || null, paths) });
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
  await Promise.all([
    db
      .from("wfilemanager_sessions")
      .delete()
      .eq("instance_id", auth.instance.id)
      .eq("user_id", id),
    db
      .from("wfilemanager_path_rules")
      .delete()
      .eq("instance_id", auth.instance.id)
      .eq("user_id", id),
  ]);
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
    deleted: { id: target.id, username: target.username, displayName: target.display_name },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "users";
    if (action === "status")
      return json({ ok: true, strongPasswords: true, auditLogs: true, pathScopes: true });
    if (action !== "users") return json({ error: "Not found" }, 404);
    const auth = await authenticate(request);
    if (!auth) return json({ error: "Administrator or manage users permission required" }, 403);
    if (request.method === "GET") return listUsers(auth);
    const body = (await request.json().catch(() => ({}))) as Row;
    if (request.method === "POST") return createUser(request, auth, body);
    if (request.method === "PATCH") return updateUser(request, auth, body);
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
