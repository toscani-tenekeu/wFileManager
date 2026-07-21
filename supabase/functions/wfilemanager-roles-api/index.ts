import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const PERMISSIONS = [
  "browse", "view", "preview", "read", "create_files", "create_directories", "edit", "rename",
  "copy", "move", "upload", "download", "compress", "extract", "delete", "restore",
  "permanently_delete", "change_permissions", "change_owner", "change_group", "create_symlinks",
  "calculate_checksums", "use_terminal", "view_logs", "manage_users", "manage_roles", "change_settings",
] as const;

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
const cleanPermissions = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && (PERMISSIONS as readonly string[]).includes(item)))]
  : [];
const roleJson = (role: any, members = 0) => ({
  id: role.id,
  instanceId: role.instance_id,
  name: role.name,
  description: role.description || "",
  permissions: cleanPermissions(role.permissions),
  isSystem: Boolean(role.is_system),
  members,
  createdAt: role.created_at,
  updatedAt: role.updated_at,
});

async function authenticate(req: Request, instanceKey: string) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const { data: instance } = await db.from("wfilemanager_instances").select("*").eq("instance_key", instanceKey).maybeSingle();
  if (!instance) return null;
  const { data: session } = await db.from("wfilemanager_sessions").select("*")
    .eq("token_hash", await hash(token)).eq("instance_id", instance.id).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data: user } = await db.from("wfilemanager_users").select("*").eq("id", session.user_id).eq("instance_id", instance.id).maybeSingle();
  if (!user || user.status !== "active") return null;
  const { data: role } = user.role_id
    ? await db.from("wfilemanager_roles").select("*").eq("id", user.role_id).eq("instance_id", instance.id).maybeSingle()
    : { data: null };
  return { instance, session, user, role };
}

async function audit(auth: any, req: Request, action: string, target?: string) {
  await db.from("wfilemanager_audit_logs").insert({
    instance_id: auth.instance.id,
    user_id: auth.user.id,
    username: auth.user.username,
    action,
    target: target || null,
    result: "success",
    metadata: {},
    ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: req.headers.get("user-agent") || null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "roles";
    const instanceKey = req.headers.get("x-wfilemanager-instance") || "default";
    const auth = await authenticate(req, instanceKey);
    if (!auth) return respond({ error: "Unauthorized" }, 401);
    const ownPermissions = auth.user.is_admin ? [...PERMISSIONS] : cleanPermissions(auth.role?.permissions);

    if (action === "permissions") {
      return respond({
        roleId: auth.user.role_id,
        roleName: auth.role?.name || (auth.user.is_admin ? "Administrator" : null),
        permissions: ownPermissions,
      });
    }

    if (action !== "roles") return respond({ error: "Not found" }, 404);
    if (req.method === "GET") {
      if (!auth.user.is_admin && !ownPermissions.includes("manage_roles") && !ownPermissions.includes("manage_users")) return respond({ error: "Forbidden" }, 403);
      const [{ data: roles, error: rolesError }, { data: users, error: usersError }] = await Promise.all([
        db.from("wfilemanager_roles").select("*").eq("instance_id", auth.instance.id).order("is_system", { ascending: false }).order("name"),
        db.from("wfilemanager_users").select("role_id").eq("instance_id", auth.instance.id),
      ]);
      if (rolesError) throw rolesError;
      if (usersError) throw usersError;
      const counts = new Map<string, number>();
      for (const user of users || []) if (user.role_id) counts.set(user.role_id, (counts.get(user.role_id) || 0) + 1);
      return respond({ roles: (roles || []).map((role) => roleJson(role, counts.get(role.id) || 0)) });
    }

    if (!auth.user.is_admin && !ownPermissions.includes("manage_roles")) return respond({ error: "Forbidden" }, 403);
    const body: any = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      const name = String(body.name || "").trim();
      if (name.length < 2) return respond({ error: "Role name must contain at least 2 characters" }, 400);
      const { data, error } = await db.from("wfilemanager_roles").insert({
        instance_id: auth.instance.id,
        name,
        description: String(body.description || "").trim(),
        permissions: cleanPermissions(body.permissions),
        is_system: false,
      }).select().single();
      if (error) throw error;
      await audit(auth, req, "role.create", name);
      return respond({ role: roleJson(data) }, 201);
    }

    const id = String(body.id || "");
    const { data: current, error: currentError } = await db.from("wfilemanager_roles").select("*")
      .eq("id", id).eq("instance_id", auth.instance.id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return respond({ error: "Role not found" }, 404);

    if (req.method === "PATCH") {
      if (current.is_system && current.name === "Administrator") return respond({ error: "The Administrator role cannot be modified" }, 403);
      const updates: Record<string, unknown> = {};
      if (typeof body.name === "string") {
        const name = body.name.trim();
        if (name.length < 2) return respond({ error: "Role name must contain at least 2 characters" }, 400);
        updates.name = name;
      }
      if (typeof body.description === "string") updates.description = body.description.trim();
      if (Array.isArray(body.permissions)) updates.permissions = cleanPermissions(body.permissions);
      const { data, error } = await db.from("wfilemanager_roles").update(updates).eq("id", id).select().single();
      if (error) throw error;
      const { count } = await db.from("wfilemanager_users").select("id", { count: "exact", head: true }).eq("role_id", id);
      await audit(auth, req, "role.update", data.name);
      return respond({ role: roleJson(data, count || 0) });
    }

    if (req.method === "DELETE") {
      if (current.is_system) return respond({ error: "System roles cannot be deleted" }, 403);
      const { count } = await db.from("wfilemanager_users").select("id", { count: "exact", head: true }).eq("role_id", id);
      if ((count || 0) > 0) return respond({ error: "This role is still assigned to users" }, 409);
      const { error } = await db.from("wfilemanager_roles").delete().eq("id", id);
      if (error) throw error;
      await audit(auth, req, "role.delete", current.name);
      return respond({ success: true });
    }

    return respond({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return respond({ error: message.includes("duplicate key") ? "A role with this name already exists" : message }, 500);
  }
});
