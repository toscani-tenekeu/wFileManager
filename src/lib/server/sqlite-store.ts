import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.WFILEMANAGER_SQLITE_PATH || "/var/lib/wfilemanager/wfilemanager.db";
const INSTANCE_KEY = process.env.WFILEMANAGER_INSTANCE_KEY || "wfm-local";
const SESSION_SHORT_MS = 12 * 60 * 60 * 1000;
const SESSION_LONG_MS = 30 * 24 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export const PERMISSIONS = [
  "browse", "view", "preview", "read", "create_files", "create_directories", "edit", "rename",
  "copy", "move", "upload", "download", "compress", "extract", "delete", "restore",
  "permanently_delete", "change_permissions", "change_owner", "change_group", "create_symlinks",
  "calculate_checksums", "use_terminal", "manage_users", "manage_roles",
] as const;

type Row = Record<string, unknown>;

type UserRow = Row & {
  id: string;
  role_id: string | null;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  password_salt: string;
  status: string;
  is_admin: number;
  must_change_password: number;
  timezone: string;
  last_login_at: string | null;
  created_at: string;
};

export class SqliteAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let database: DatabaseSync | null = null;

function now() {
  return new Date().toISOString();
}

function db() {
  if (database) return database;
  mkdirSync(path.dirname(DB_PATH), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(DB_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS wfm_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wfm_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '[]',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wfm_users (
      id TEXT PRIMARY KEY,
      role_id TEXT REFERENCES wfm_roles(id) ON DELETE SET NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'invited')),
      is_admin INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wfm_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES wfm_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wfm_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES wfm_users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning', 'error')),
      link TEXT,
      source TEXT NOT NULL DEFAULT 'app',
      read_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wfm_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES wfm_users(id) ON DELETE SET NULL,
      username TEXT,
      action TEXT NOT NULL,
      target TEXT,
      result TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS wfm_sessions_user_id_idx ON wfm_sessions(user_id);
    CREATE INDEX IF NOT EXISTS wfm_sessions_expires_at_idx ON wfm_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS wfm_notifications_user_id_idx ON wfm_notifications(user_id);
  `);
  return database;
}

function meta(key: string) {
  const row = db().prepare("SELECT value FROM wfm_meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value || null;
}

function setMeta(key: string, value: string) {
  db().prepare("INSERT INTO wfm_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function passwordHash(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
}

function newPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: passwordHash(password, salt) };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordPolicyError(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters.";
  if (!/^[A-Za-z0-9]+$/.test(password)) return "Password may contain only uppercase letters, lowercase letters and numbers.";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must contain a number.";
  if (/(.)\1/.test(password)) return "Password must not contain identical consecutive characters.";
  return null;
}

function normalizeUsername(value: unknown) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new SqliteAuthError(400, "Username must contain 3 to 64 letters, numbers, dots, underscores or hyphens.");
  }
  return username;
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SqliteAuthError(400, "Email address is invalid.");
  return email;
}

function audit(user: UserRow | null, action: string, target?: string, result = "success") {
  db().prepare("INSERT INTO wfm_audit_logs(user_id, username, action, target, result, created_at) VALUES(?, ?, ?, ?, ?, ?)")
    .run(user?.id || null, user?.username || null, action, target || null, result, now());
}

function roleById(id: string | null) {
  if (!id) return null;
  return db().prepare("SELECT * FROM wfm_roles WHERE id = ?").get(id) as Row | undefined || null;
}

function permissionsFor(user: UserRow) {
  if (Boolean(user.is_admin)) return [...PERMISSIONS];
  const role = roleById(user.role_id);
  if (!role) return [];
  try {
    const value = JSON.parse(String(role.permissions || "[]"));
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function publicUser(user: UserRow) {
  const role = roleById(user.role_id);
  return {
    id: user.id,
    instanceId: INSTANCE_KEY,
    roleId: user.role_id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    timezone: user.timezone,
    status: user.status as "active" | "disabled" | "invited",
    isAdmin: Boolean(user.is_admin),
    mustChangePassword: Boolean(user.must_change_password),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    roleName: role ? String(role.name) : null,
    permissions: permissionsFor(user),
  };
}

function getUserById(id: string) {
  return db().prepare("SELECT * FROM wfm_users WHERE id = ?").get(id) as UserRow | undefined;
}

function assertAdmin(user: UserRow) {
  if (!user.is_admin) throw new SqliteAuthError(403, "Administrator access is required.");
}

function assertPermission(user: UserRow, permission: string) {
  if (user.is_admin) return;
  if (!permissionsFor(user).includes(permission)) throw new SqliteAuthError(403, `Missing ${permission.replace(/_/g, " ")} permission.`);
}

function cleanExpiredSessions() {
  db().prepare("DELETE FROM wfm_sessions WHERE expires_at <= ?").run(now());
}

export function isConfigured() {
  return meta("configured") === "true";
}

export function instanceInfo() {
  return {
    id: INSTANCE_KEY,
    name: meta("instance_name") || "wFileManager",
    hostname: meta("hostname") || undefined,
    baseUrl: meta("base_url") || undefined,
    databaseMode: "sqlite",
  };
}

function ensureSystemRoles() {
  const timestamp = now();
  const roles = [
    ["role-administrator", "Administrator", "Full access to the server.", PERMISSIONS, 1],
    ["role-file-manager", "File Manager", "Manage files without user and role administration.", PERMISSIONS.filter((p) => !["manage_users", "manage_roles"].includes(p)), 1],
    ["role-read-only", "Read Only", "Browse, preview and download files.", ["browse", "view", "preview", "read", "download"], 1],
  ] as const;
  const statement = db().prepare("INSERT OR IGNORE INTO wfm_roles(id, name, description, permissions, is_system, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)");
  for (const role of roles) statement.run(role[0], role[1], role[2], JSON.stringify(role[3]), role[4], timestamp, timestamp);
}

export function setup(data: Record<string, unknown>) {
  if (isConfigured()) throw new SqliteAuthError(409, "wFileManager is already configured.");
  const username = normalizeUsername(data.username);
  const email = normalizeEmail(data.email);
  const displayName = String(data.displayName || "").trim();
  const password = String(data.password || "");
  if (displayName.length < 2) throw new SqliteAuthError(400, "Display name must contain at least 2 characters.");
  const policyError = passwordPolicyError(password);
  if (policyError) throw new SqliteAuthError(400, policyError);

  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    ensureSystemRoles();
    const createdAt = now();
    const credential = newPassword(password);
    const id = randomUUID();
    connection.prepare(`
      INSERT INTO wfm_users(id, role_id, username, email, display_name, password_hash, password_salt, status, is_admin, must_change_password, timezone, created_at, updated_at)
      VALUES(?, 'role-administrator', ?, ?, ?, ?, ?, 'active', 1, 0, 'UTC', ?, ?)
    `).run(id, username, email, displayName, credential.hash, credential.salt, createdAt, createdAt);
    setMeta("configured", "true");
    setMeta("instance_name", String(data.instanceName || "wFileManager").trim() || "wFileManager");
    if (data.hostname) setMeta("hostname", String(data.hostname));
    if (data.baseUrl) setMeta("base_url", String(data.baseUrl));
    connection.exec("COMMIT");
    const user = getUserById(id)!;
    audit(user, "setup", username);
    return { success: true as const, user: publicUser(user) };
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function login(data: Record<string, unknown>, request?: Request) {
  if (!isConfigured()) throw new SqliteAuthError(409, "wFileManager setup is not complete.");
  const loginValue = String(data.login || "").trim();
  const password = String(data.password || "");
  const user = db().prepare("SELECT * FROM wfm_users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1")
    .get(loginValue, loginValue) as UserRow | undefined;
  if (!user || !safeEqual(passwordHash(password, user.password_salt), user.password_hash)) {
    audit(user || null, "login", loginValue, "failure");
    throw new SqliteAuthError(401, "Invalid username, email or password.");
  }
  if (user.status !== "active") throw new SqliteAuthError(403, "This account is not active.");

  cleanExpiredSessions();
  const token = randomBytes(48).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + (data.remember ? SESSION_LONG_MS : SESSION_SHORT_MS)).toISOString();
  const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = request?.headers.get("user-agent") || null;
  db().prepare("INSERT INTO wfm_sessions(id, user_id, token_hash, expires_at, last_seen_at, ip_address, user_agent, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), user.id, tokenHash(token), expiresAt, createdAt, ip, userAgent, createdAt);
  db().prepare("UPDATE wfm_users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(createdAt, createdAt, user.id);
  const current = getUserById(user.id)!;
  audit(current, "login", current.username);
  return { token, expiresAt, user: publicUser(current) };
}

export function sessionUser(token: string, touch = true) {
  if (!token) throw new SqliteAuthError(401, "Missing session token.");
  cleanExpiredSessions();
  const row = db().prepare(`
    SELECT u.* FROM wfm_sessions s
    JOIN wfm_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1
  `).get(tokenHash(token), now()) as UserRow | undefined;
  if (!row) throw new SqliteAuthError(401, "Session is invalid or expired.");
  if (row.status !== "active") throw new SqliteAuthError(403, "This account is not active.");
  if (touch) db().prepare("UPDATE wfm_sessions SET last_seen_at = ? WHERE token_hash = ?").run(now(), tokenHash(token));
  return row;
}

export function logout(token: string) {
  const user = sessionUser(token, false);
  db().prepare("DELETE FROM wfm_sessions WHERE token_hash = ?").run(tokenHash(token));
  audit(user, "logout", user.username);
  return { success: true as const };
}

export function verifyPassword(user: UserRow, password: unknown) {
  const value = String(password || "");
  if (!safeEqual(passwordHash(value, user.password_salt), user.password_hash)) throw new SqliteAuthError(401, "The password is incorrect.");
  return { valid: true as const };
}

export function userResponse(user: UserRow) {
  return publicUser(user);
}

export function listUsers(actor: UserRow) {
  assertPermission(actor, "manage_users");
  const rows = db().prepare("SELECT * FROM wfm_users ORDER BY is_admin DESC, username COLLATE NOCASE").all() as UserRow[];
  return { users: rows.map(publicUser) };
}

export function createUser(actor: UserRow, data: Record<string, unknown>) {
  assertPermission(actor, "manage_users");
  const username = normalizeUsername(data.username);
  const email = normalizeEmail(data.email);
  const displayName = String(data.displayName || "").trim();
  const password = String(data.password || "");
  if (displayName.length < 2) throw new SqliteAuthError(400, "Display name must contain at least 2 characters.");
  const policyError = passwordPolicyError(password);
  if (policyError) throw new SqliteAuthError(400, policyError);
  const credential = newPassword(password);
  const id = randomUUID();
  const timestamp = now();
  const status = ["active", "disabled", "invited"].includes(String(data.status)) ? String(data.status) : "active";
  const roleId = data.roleId ? String(data.roleId) : "role-file-manager";
  try {
    db().prepare(`
      INSERT INTO wfm_users(id, role_id, username, email, display_name, password_hash, password_salt, status, is_admin, must_change_password, timezone, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'UTC', ?, ?)
    `).run(id, roleId, username, email, displayName, credential.hash, credential.salt, status, data.mustChangePassword ? 1 : 0, timestamp, timestamp);
  } catch (error) {
    throw new SqliteAuthError(409, error instanceof Error ? error.message : "Username or email already exists.");
  }
  const user = getUserById(id)!;
  audit(actor, "create_user", username);
  return { user: publicUser(user) };
}

export function deleteUser(actor: UserRow, id: unknown) {
  assertPermission(actor, "manage_users");
  const target = getUserById(String(id || ""));
  if (!target) throw new SqliteAuthError(404, "User was not found.");
  if (target.id === actor.id) throw new SqliteAuthError(400, "You cannot delete your own account.");
  db().prepare("DELETE FROM wfm_users WHERE id = ?").run(target.id);
  audit(actor, "delete_user", target.username);
  return { success: true as const, deleted: { id: target.id, username: target.username, displayName: target.display_name } };
}

function publicRole(row: Row) {
  const members = db().prepare("SELECT COUNT(*) AS count FROM wfm_users WHERE role_id = ?").get(String(row.id)) as { count: number };
  let permissions: string[] = [];
  try { permissions = JSON.parse(String(row.permissions || "[]")); } catch { permissions = []; }
  return {
    id: String(row.id), instanceId: INSTANCE_KEY, name: String(row.name), description: String(row.description || ""),
    permissions, isSystem: Boolean(row.is_system), members: Number(members.count || 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function rolePermissions(user: UserRow) {
  const role = roleById(user.role_id);
  return { roleId: user.role_id, roleName: user.is_admin ? "Administrator" : role ? String(role.name) : null, permissions: permissionsFor(user) };
}

export function listRoles(user: UserRow) {
  assertPermission(user, "manage_roles");
  const rows = db().prepare("SELECT * FROM wfm_roles ORDER BY is_system DESC, name COLLATE NOCASE").all() as Row[];
  return { roles: rows.map(publicRole) };
}

function normalizedPermissions(input: unknown) {
  if (!Array.isArray(input)) throw new SqliteAuthError(400, "Permissions must be an array.");
  return [...new Set(input.map(String).filter((item) => (PERMISSIONS as readonly string[]).includes(item)))];
}

export function createRole(user: UserRow, data: Record<string, unknown>) {
  assertPermission(user, "manage_roles");
  const name = String(data.name || "").trim();
  if (name.length < 2) throw new SqliteAuthError(400, "Role name must contain at least 2 characters.");
  const id = randomUUID();
  const timestamp = now();
  db().prepare("INSERT INTO wfm_roles(id, name, description, permissions, is_system, created_at, updated_at) VALUES(?, ?, ?, ?, 0, ?, ?)")
    .run(id, name, String(data.description || ""), JSON.stringify(normalizedPermissions(data.permissions)), timestamp, timestamp);
  audit(user, "create_role", name);
  return { role: publicRole(db().prepare("SELECT * FROM wfm_roles WHERE id = ?").get(id) as Row) };
}

export function updateRole(user: UserRow, data: Record<string, unknown>) {
  assertPermission(user, "manage_roles");
  const id = String(data.id || "");
  const current = db().prepare("SELECT * FROM wfm_roles WHERE id = ?").get(id) as Row | undefined;
  if (!current) throw new SqliteAuthError(404, "Role was not found.");
  if (current.is_system) throw new SqliteAuthError(400, "System roles cannot be modified.");
  const name = data.name === undefined ? String(current.name) : String(data.name).trim();
  const description = data.description === undefined ? String(current.description || "") : String(data.description || "");
  const permissions = data.permissions === undefined ? String(current.permissions || "[]") : JSON.stringify(normalizedPermissions(data.permissions));
  db().prepare("UPDATE wfm_roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?")
    .run(name, description, permissions, now(), id);
  audit(user, "update_role", name);
  return { role: publicRole(db().prepare("SELECT * FROM wfm_roles WHERE id = ?").get(id) as Row) };
}

export function deleteRole(user: UserRow, idInput: unknown) {
  assertPermission(user, "manage_roles");
  const id = String(idInput || "");
  const current = db().prepare("SELECT * FROM wfm_roles WHERE id = ?").get(id) as Row | undefined;
  if (!current) throw new SqliteAuthError(404, "Role was not found.");
  if (current.is_system) throw new SqliteAuthError(400, "System roles cannot be deleted.");
  const members = db().prepare("SELECT COUNT(*) AS count FROM wfm_users WHERE role_id = ?").get(id) as { count: number };
  if (members.count > 0) throw new SqliteAuthError(409, "Move users to another role before deleting this role.");
  db().prepare("DELETE FROM wfm_roles WHERE id = ?").run(id);
  audit(user, "delete_role", String(current.name));
  return { success: true as const };
}

export function profile(user: UserRow) {
  return { user: publicUser(user) };
}

export function updateProfile(user: UserRow, data: Record<string, unknown>) {
  const displayName = String(data.displayName || "").trim();
  if (displayName.length < 2) throw new SqliteAuthError(400, "Display name must contain at least 2 characters.");
  const email = normalizeEmail(data.email);
  const timezone = String(data.timezone || "UTC").trim() || "UTC";
  db().prepare("UPDATE wfm_users SET display_name = ?, email = ?, timezone = ?, updated_at = ? WHERE id = ?")
    .run(displayName, email, timezone, now(), user.id);
  return { user: publicUser(getUserById(user.id)!) };
}

export function changePassword(user: UserRow, data: Record<string, unknown>, currentToken: string) {
  verifyPassword(user, data.currentPassword);
  const password = String(data.newPassword || "");
  const policyError = passwordPolicyError(password);
  if (policyError) throw new SqliteAuthError(400, policyError);
  const credential = newPassword(password);
  db().prepare("UPDATE wfm_users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .run(credential.hash, credential.salt, now(), user.id);
  db().prepare("DELETE FROM wfm_sessions WHERE user_id = ? AND token_hash <> ?").run(user.id, tokenHash(currentToken));
  audit(user, "change_password", user.username);
  return { success: true as const };
}

export function listSessions(user: UserRow, currentToken: string) {
  cleanExpiredSessions();
  const rows = db().prepare("SELECT * FROM wfm_sessions WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as Row[];
  const currentHash = tokenHash(currentToken);
  return { sessions: rows.map((row) => ({
    id: String(row.id), expiresAt: String(row.expires_at), lastSeenAt: String(row.last_seen_at),
    ipAddress: row.ip_address ? String(row.ip_address) : null, userAgent: row.user_agent ? String(row.user_agent) : null,
    createdAt: String(row.created_at), current: String(row.token_hash) === currentHash,
  })) };
}

export function revokeSessions(user: UserRow, data: Record<string, unknown>, currentToken: string) {
  if (data.all) {
    db().prepare("DELETE FROM wfm_sessions WHERE user_id = ?").run(user.id);
    return { success: true as const, currentRevoked: true as const };
  }
  const id = String(data.id || "");
  const row = db().prepare("SELECT token_hash FROM wfm_sessions WHERE id = ? AND user_id = ?").get(id, user.id) as { token_hash?: string } | undefined;
  if (!row) throw new SqliteAuthError(404, "Session was not found.");
  db().prepare("DELETE FROM wfm_sessions WHERE id = ? AND user_id = ?").run(id, user.id);
  return { success: true as const, currentRevoked: row.token_hash === tokenHash(currentToken) };
}

function publicNotification(row: Row) {
  return {
    id: String(row.id), title: String(row.title), message: String(row.message || ""), tone: String(row.tone),
    link: row.link ? String(row.link) : null, source: String(row.source), readAt: row.read_at ? String(row.read_at) : null,
    createdAt: String(row.created_at), expiresAt: String(row.expires_at),
  };
}

export function notifications(user: UserRow) {
  db().prepare("DELETE FROM wfm_notifications WHERE expires_at <= ?").run(now());
  const rows = db().prepare("SELECT * FROM wfm_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(user.id) as Row[];
  return { notifications: rows.map(publicNotification) };
}

export function createNotification(user: UserRow, data: Record<string, unknown>) {
  const title = String(data.title || "").trim();
  if (!title) throw new SqliteAuthError(400, "Notification title is required.");
  const id = randomUUID();
  const createdAt = now();
  const tone = ["info", "success", "warning", "error"].includes(String(data.tone)) ? String(data.tone) : "info";
  db().prepare("INSERT INTO wfm_notifications(id, user_id, title, message, tone, link, source, read_at, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
    .run(id, user.id, title, String(data.message || ""), tone, data.link ? String(data.link) : null, String(data.source || "app"), createdAt, new Date(Date.now() + 7 * 86400_000).toISOString());
  return { notification: publicNotification(db().prepare("SELECT * FROM wfm_notifications WHERE id = ?").get(id) as Row) };
}

export function updateNotifications(user: UserRow, data: Record<string, unknown>) {
  const readAt = data.read === false ? null : now();
  if (data.markAll) db().prepare("UPDATE wfm_notifications SET read_at = ? WHERE user_id = ?").run(readAt, user.id);
  else db().prepare("UPDATE wfm_notifications SET read_at = ? WHERE id = ? AND user_id = ?").run(readAt, String(data.id || ""), user.id);
  return { success: true as const };
}

export function deleteNotifications(user: UserRow, data: Record<string, unknown>) {
  if (data.all) db().prepare("DELETE FROM wfm_notifications WHERE user_id = ?").run(user.id);
  else db().prepare("DELETE FROM wfm_notifications WHERE id = ? AND user_id = ?").run(String(data.id || ""), user.id);
  return { success: true as const };
}

export function presence() {
  cleanExpiredSessions();
  const threshold = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const row = db().prepare("SELECT COUNT(DISTINCT user_id) AS count FROM wfm_sessions WHERE last_seen_at >= ? AND expires_at > ?").get(threshold, now()) as { count: number };
  return { onlineUsers: Number(row.count || 0), onlineWindowSeconds: ONLINE_WINDOW_MS / 1000, checkedAt: now() };
}

export function rootReset(usernameInput: string | undefined, password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new SqliteAuthError(400, policyError);
  const admins = db().prepare("SELECT * FROM wfm_users WHERE is_admin = 1 ORDER BY username COLLATE NOCASE").all() as UserRow[];
  const target = usernameInput ? admins.find((user) => user.username.toLowerCase() === usernameInput.toLowerCase()) : admins.length === 1 ? admins[0] : null;
  if (!target) {
    const names = admins.map((user) => user.username).join(", ");
    throw new SqliteAuthError(409, names ? `Specify an administrator username: ${names}` : "No administrator account exists.");
  }
  const credential = newPassword(password);
  db().prepare("UPDATE wfm_users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .run(credential.hash, credential.salt, now(), target.id);
  db().prepare("DELETE FROM wfm_sessions WHERE user_id = ?").run(target.id);
  audit(target, "root_password_reset", target.username);
  return { success: true as const, username: target.username };
}

export function requireAdmin(user: UserRow) {
  assertAdmin(user);
  return user;
}

export function requirePermission(user: UserRow, permission: string) {
  assertPermission(user, permission);
  return user;
}
