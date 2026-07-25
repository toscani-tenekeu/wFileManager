import {
  sessionUser as sqliteSessionUser,
  userResponse as sqliteUserResponse,
  verifyPassword as sqliteVerifyPassword,
} from "@/lib/server/sqlite-store";
import * as remoteRuntime from "@/lib/server/local-runtime";
import type { LocalPathRule } from "@/lib/server/path-policy-runtime";
import { pathRulesForUser } from "@/lib/server/sqlite-path-policy";

const DATABASE_MODE = process.env.WFILEMANAGER_DATABASE_MODE === "sqlite" ? "sqlite" : "supabase";
const COOKIE_NAME = "wfm_session";
const SUPABASE_URL = (
  process.env.WFILEMANAGER_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co"
).replace(/\/$/, "");
const INSTANCE_KEY =
  process.env.WFILEMANAGER_INSTANCE_KEY ||
  process.env.VITE_WFILEMANAGER_INSTANCE_KEY ||
  "wfilemanager-kmerhosting-com";
const ROLE_ACCESS_URL = `${SUPABASE_URL}/functions/v1/wfilemanager-roles-api/permissions`;

export type LocalUser = remoteRuntime.LocalUser & { pathRules?: LocalPathRule[] };
export const LocalApiError = remoteRuntime.LocalApiError;

const policyCache = new Map<
  string,
  { expiresAt: number; permissions: string[]; pathRules: LocalPathRule[] }
>();

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

function tokenFromRequest(request: Request) {
  const value = request.headers.get("authorization") || "";
  if (value.startsWith("Bearer ")) return value.slice(7).trim();
  return cookieValue(request, COOKIE_NAME);
}

function authorizationRequest(request: Request) {
  const token = tokenFromRequest(request);
  const headers = new Headers(request.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request(request.url, { method: request.method, headers });
}

function assignablePermissions(permissions: unknown) {
  return Array.isArray(permissions)
    ? permissions.filter(
        (permission): permission is string =>
          typeof permission === "string" && permission !== "use_terminal",
      )
    : [];
}

function normalizedPathRules(value: unknown): LocalPathRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const rule = entry as Record<string, unknown>;
    const accessMode =
      rule.accessMode === "deny" ? "deny" : rule.accessMode === "allow" ? "allow" : null;
    if (typeof rule.path !== "string" || !rule.path.startsWith("/") || !accessMode) return [];
    return [
      {
        id: typeof rule.id === "string" ? rule.id : undefined,
        path: rule.path,
        accessMode,
        recursive: rule.recursive !== false,
        source: rule.source === "user" ? "user" : "role",
      } satisfies LocalPathRule,
    ];
  });
}

function sqliteUser(request: Request): LocalUser {
  const token = tokenFromRequest(request);
  if (!token) throw new LocalApiError(401, "Missing session token");
  try {
    const user = sqliteUserResponse(sqliteSessionUser(token));
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      status: user.status,
      roleId: user.roleId,
      roleName: user.roleName,
      permissions: assignablePermissions(user.permissions),
      pathRules: pathRulesForUser(user.id, user.roleId, user.isAdmin),
    };
  } catch (error) {
    const value = error as { status?: number; message?: string };
    throw new LocalApiError(
      value.status || 401,
      value.message || "Your wFileManager session is invalid or expired",
    );
  }
}

async function remotePolicy(request: Request, user: remoteRuntime.LocalUser) {
  const token = tokenFromRequest(request);
  if (!token) throw new LocalApiError(401, "Missing session token");
  if (user.isAdmin) {
    return {
      permissions: assignablePermissions(user.permissions),
      pathRules: [
        { path: "/", accessMode: "allow", recursive: true, source: "user" },
      ] as LocalPathRule[],
    };
  }
  const cached = policyCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(ROLE_ACCESS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-wfilemanager-instance": INSTANCE_KEY,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new LocalApiError(403, "Unable to load the account access policy");
    const payload = (await response.json()) as { permissions?: unknown; pathRules?: unknown };
    const result = {
      expiresAt: Date.now() + 15_000,
      permissions: assignablePermissions(payload.permissions),
      pathRules: normalizedPathRules(payload.pathRules),
    };
    policyCache.set(token, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function requireUser(request: Request): Promise<LocalUser> {
  if (DATABASE_MODE === "sqlite") return sqliteUser(request);
  const user = await remoteRuntime.requireUser(authorizationRequest(request));
  const access = await remotePolicy(request, user);
  return { ...user, permissions: access.permissions, pathRules: access.pathRules };
}

export function assertAdmin(user: LocalUser) {
  if (!user.isAdmin)
    throw new LocalApiError(403, "Administrator access is required for this operation");
}

export function assertPermission(user: LocalUser, permission: string) {
  if (user.isAdmin) return;
  if (permission === "use_terminal")
    throw new LocalApiError(403, "Terminal access is reserved for administrators");
  if (!Array.isArray(user.permissions) || !user.permissions.includes(permission)) {
    throw new LocalApiError(
      403,
      `Your role does not include the ${permission.replace(/_/g, " ")} permission`,
    );
  }
}

export function assertAnyPermission(user: LocalUser, permissions: string[]) {
  if (user.isAdmin) return;
  const assignable = permissions.filter((permission) => permission !== "use_terminal");
  if (
    !Array.isArray(user.permissions) ||
    !assignable.some((permission) => user.permissions?.includes(permission))
  ) {
    throw new LocalApiError(403, "Your role does not allow this operation");
  }
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  assertAdmin(user);
  return user;
}

export async function requirePermission(request: Request, permission: string) {
  const user = await requireUser(request);
  assertPermission(user, permission);
  return user;
}

export async function requireAnyPermission(request: Request, permissions: string[]) {
  const user = await requireUser(request);
  assertAnyPermission(user, permissions);
  return user;
}

export async function verifyCurrentPassword(request: Request, passwordInput: unknown) {
  if (DATABASE_MODE !== "sqlite")
    return remoteRuntime.verifyCurrentPassword(authorizationRequest(request), passwordInput);
  const token = tokenFromRequest(request);
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (!token || !password) throw new LocalApiError(400, "Your current password is required");
  try {
    sqliteVerifyPassword(sqliteSessionUser(token), password);
    return true;
  } catch (error) {
    const value = error as { status?: number; message?: string };
    throw new LocalApiError(value.status || 401, value.message || "The password is incorrect");
  }
}
