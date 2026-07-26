import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { SqliteAuthError, listUsers, passwordPolicyError } from "@/lib/server/sqlite-store";
import { normalizeAllowedPaths, pathRulesForUser } from "@/lib/server/sqlite-path-policy";

type Actor = Parameters<typeof listUsers>[0];
const DB_PATH = process.env.WFILEMANAGER_SQLITE_PATH || "/var/lib/wfilemanager/wfilemanager.db";
let database: DatabaseSync | null = null;

function db() {
  if (!database) {
    database = new DatabaseSync(DB_PATH);
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }
  return database;
}
function clean(value: unknown) {
  return String(value ?? "").trim();
}
function roleName(roleId: string | null) {
  if (!roleId) return null;
  const row = db().prepare("SELECT name FROM wfm_roles WHERE id = ?").get(roleId) as
    | { name?: string }
    | undefined;
  return row?.name || null;
}
function publicUser(row: Record<string, unknown>) {
  const isAdmin = Boolean(row.is_admin);
  return {
    id: String(row.id),
    instanceId: process.env.WFILEMANAGER_INSTANCE_KEY || "wfm-local",
    roleId: row.role_id ? String(row.role_id) : null,
    username: String(row.username),
    email: row.email ? String(row.email) : null,
    displayName: String(row.display_name),
    timezone: String(row.timezone || "UTC"),
    status: String(row.status),
    isAdmin,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    createdAt: String(row.created_at),
    roleName: isAdmin ? "Administrator" : roleName(row.role_id ? String(row.role_id) : null),
    allowedPaths: pathRulesForUser(
      String(row.id),
      row.role_id ? String(row.role_id) : null,
      isAdmin,
    )
      .filter((rule) => rule.accessMode === "allow" && rule.source === "user")
      .map((rule) => rule.path),
  };
}
function assertRole(roleId: string | null) {
  if (!roleId) return;
  const row = db().prepare("SELECT name FROM wfm_roles WHERE id = ?").get(roleId) as
    | { name?: string }
    | undefined;
  if (!row) throw new SqliteAuthError(400, "The selected role does not exist.");
  if (String(row.name).toLowerCase() === "administrator")
    throw new SqliteAuthError(400, "The Administrator role cannot be assigned to another account.");
}
function passwordCredential(password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new SqliteAuthError(400, policyError);
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex") };
}
function replaceRules(connection: DatabaseSync, userId: string, pathsInput: unknown) {
  const paths = normalizeAllowedPaths(pathsInput);
  connection.prepare("DELETE FROM wfm_path_rules WHERE user_id = ?").run(userId);
  const insert = connection.prepare(
    "INSERT INTO wfm_path_rules(id,user_id,path,access_mode,recursive,created_at) VALUES(?, ?, ?, 'allow', 1, ?)",
  );
  const createdAt = new Date().toISOString();
  for (const allowedPath of paths) insert.run(randomUUID(), userId, allowedPath, createdAt);
  return paths;
}

export function createSqliteUserWithPaths(
  actor: Actor,
  create: (actor: Actor, data: Record<string, unknown>) => { user: { id: string } },
  payload: Record<string, unknown>,
) {
  const roleId = clean(payload.roleId) || null;
  assertRole(roleId);
  const result = create(actor, { ...payload, roleId });
  const connection = db();
  try {
    replaceRules(connection, result.user.id, payload.allowedPaths);
  } catch (error) {
    connection.prepare("DELETE FROM wfm_users WHERE id = ?").run(result.user.id);
    throw error;
  }
  const row = connection.prepare("SELECT * FROM wfm_users WHERE id = ?").get(result.user.id) as Record<
    string,
    unknown
  >;
  return { user: publicUser(row) };
}

export function updateSqliteUser(actor: Actor, payload: Record<string, unknown>) {
  listUsers(actor);
  const id = clean(payload.id);
  if (!id) throw new SqliteAuthError(400, "User id is required.");
  if (id === String(actor.id))
    throw new SqliteAuthError(400, "Use Account settings to edit your own account.");
  const current = db().prepare("SELECT * FROM wfm_users WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!current) throw new SqliteAuthError(404, "User was not found.");
  if (current.is_admin)
    throw new SqliteAuthError(409, "The installation administrator cannot be modified.");

  const updates: string[] = [];
  const values: SQLInputValue[] = [];
  if (payload.displayName !== undefined) {
    const displayName = clean(payload.displayName);
    if (displayName.length < 2 || displayName.length > 120)
      throw new SqliteAuthError(400, "Display name must contain 2 to 120 characters.");
    updates.push("display_name = ?");
    values.push(displayName);
  }
  if (payload.email !== undefined) {
    const email = clean(payload.email) || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new SqliteAuthError(400, "Email address is invalid.");
    updates.push("email = ?");
    values.push(email);
  }
  if (payload.roleId !== undefined) {
    const roleId = clean(payload.roleId) || null;
    assertRole(roleId);
    updates.push("role_id = ?");
    values.push(roleId);
  }
  if (payload.status !== undefined) {
    const status = clean(payload.status);
    if (!["active", "disabled", "invited"].includes(status))
      throw new SqliteAuthError(400, "Invalid account status.");
    updates.push("status = ?");
    values.push(status);
  }
  if (payload.mustChangePassword !== undefined) {
    updates.push("must_change_password = ?");
    values.push(payload.mustChangePassword === true ? 1 : 0);
  }
  let passwordChanged = false;
  if (typeof payload.password === "string" && payload.password) {
    const credential = passwordCredential(payload.password);
    updates.push("password_hash = ?", "password_salt = ?", "must_change_password = ?");
    values.push(
      credential.hash,
      credential.salt,
      payload.mustChangePassword === false ? 0 : 1,
    );
    passwordChanged = true;
  }
  updates.push("updated_at = ?");
  values.push(new Date().toISOString(), id);

  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    connection.prepare(`UPDATE wfm_users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    if (payload.allowedPaths !== undefined) replaceRules(connection, id, payload.allowedPaths);
    const resulting = connection.prepare("SELECT * FROM wfm_users WHERE id = ?").get(id) as Record<
      string,
      unknown
    >;
    if (passwordChanged || resulting.status === "disabled")
      connection.prepare("DELETE FROM wfm_sessions WHERE user_id = ?").run(id);
    connection.exec("COMMIT");
    return { user: publicUser(resulting) };
  } catch (error) {
    connection.exec("ROLLBACK");
    if (error instanceof Error && error.message.includes("UNIQUE"))
      throw new SqliteAuthError(409, "Email already exists.");
    throw error;
  }
}
