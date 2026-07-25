import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { LocalPathRule } from "@/lib/server/path-policy-runtime";

const DB_PATH = process.env.WFILEMANAGER_SQLITE_PATH || "/var/lib/wfilemanager/wfilemanager.db";
let database: DatabaseSync | null = null;

function db() {
  if (database) return database;
  database = new DatabaseSync(DB_PATH);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS wfm_path_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES wfm_users(id) ON DELETE CASCADE,
      role_id TEXT REFERENCES wfm_roles(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      access_mode TEXT NOT NULL CHECK (access_mode IN ('allow', 'deny')),
      recursive INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      CHECK (user_id IS NOT NULL OR role_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS wfm_path_rules_user_idx ON wfm_path_rules(user_id);
    CREATE INDEX IF NOT EXISTS wfm_path_rules_role_idx ON wfm_path_rules(role_id);
  `);
  return database;
}

function normalizedPath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || !path.isAbsolute(raw) || raw.includes("\0")) return null;
  return path.resolve(raw);
}

export function normalizeAllowedPaths(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizedPath).filter((item): item is string => Boolean(item)))].slice(
    0,
    32,
  );
}

export function pathRulesForUser(
  userId: string,
  roleId: string | null | undefined,
  isAdmin: boolean,
): LocalPathRule[] {
  if (isAdmin)
    return [{ path: "/", accessMode: "allow", recursive: true, source: "user" }];
  const connection = db();
  const userRules = connection
    .prepare(
      "SELECT id,path,access_mode,recursive FROM wfm_path_rules WHERE user_id = ? ORDER BY length(path) DESC",
    )
    .all(userId) as Array<Record<string, unknown>>;
  const roleRules = roleId
    ? (connection
        .prepare(
          "SELECT id,path,access_mode,recursive FROM wfm_path_rules WHERE role_id = ? ORDER BY length(path) DESC",
        )
        .all(roleId) as Array<Record<string, unknown>>)
    : [];
  return [
    ...userRules.map(
      (rule) =>
        ({
          id: String(rule.id),
          path: String(rule.path),
          accessMode: rule.access_mode === "deny" ? "deny" : "allow",
          recursive: Boolean(rule.recursive),
          source: "user",
        }) satisfies LocalPathRule,
    ),
    ...roleRules.map(
      (rule) =>
        ({
          id: String(rule.id),
          path: String(rule.path),
          accessMode: rule.access_mode === "deny" ? "deny" : "allow",
          recursive: Boolean(rule.recursive),
          source: "role",
        }) satisfies LocalPathRule,
    ),
  ];
}

export function replaceUserPathRules(userId: string, allowedPathsInput: unknown) {
  const allowedPaths = normalizeAllowedPaths(allowedPathsInput);
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    connection.prepare("DELETE FROM wfm_path_rules WHERE user_id = ?").run(userId);
    const insert = connection.prepare(
      "INSERT INTO wfm_path_rules(id,user_id,path,access_mode,recursive,created_at) VALUES(?, ?, ?, 'allow', 1, ?)",
    );
    const createdAt = new Date().toISOString();
    for (const allowedPath of allowedPaths)
      insert.run(randomUUID(), userId, allowedPath, createdAt);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
  return allowedPaths;
}
