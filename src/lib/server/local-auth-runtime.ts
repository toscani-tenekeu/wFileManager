import {
  sessionUser as sqliteSessionUser,
  userResponse as sqliteUserResponse,
  verifyPassword as sqliteVerifyPassword,
} from "@/lib/server/sqlite-store";
import * as remoteRuntime from "@/lib/server/local-runtime";

const DATABASE_MODE = process.env.WFILEMANAGER_DATABASE_MODE === "sqlite" ? "sqlite" : "supabase";

export type LocalUser = remoteRuntime.LocalUser;
export const LocalApiError = remoteRuntime.LocalApiError;

function tokenFromRequest(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function assignablePermissions(permissions: unknown) {
  return Array.isArray(permissions)
    ? permissions.filter((permission): permission is string => typeof permission === "string" && permission !== "use_terminal")
    : [];
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
    };
  } catch (error) {
    const value = error as { status?: number; message?: string };
    throw new LocalApiError(value.status || 401, value.message || "Your wFileManager session is invalid or expired");
  }
}

export async function requireUser(request: Request): Promise<LocalUser> {
  const user = DATABASE_MODE === "sqlite" ? sqliteUser(request) : await remoteRuntime.requireUser(request);
  return { ...user, permissions: assignablePermissions(user.permissions) };
}

export function assertAdmin(user: LocalUser) {
  if (!user.isAdmin) throw new LocalApiError(403, "Administrator access is required for this operation");
}

export function assertPermission(user: LocalUser, permission: string) {
  if (user.isAdmin) return;
  if (permission === "use_terminal") throw new LocalApiError(403, "Terminal access is reserved for administrators");
  if (!Array.isArray(user.permissions) || !user.permissions.includes(permission)) {
    throw new LocalApiError(403, `Your role does not include the ${permission.replace(/_/g, " ")} permission`);
  }
}

export function assertAnyPermission(user: LocalUser, permissions: string[]) {
  if (user.isAdmin) return;
  const assignable = permissions.filter((permission) => permission !== "use_terminal");
  if (!Array.isArray(user.permissions) || !assignable.some((permission) => user.permissions?.includes(permission))) {
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
  if (DATABASE_MODE !== "sqlite") return remoteRuntime.verifyCurrentPassword(request, passwordInput);
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
