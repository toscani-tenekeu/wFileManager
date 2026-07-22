import os from "node:os";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileAsync = promisify(execFile);

const SUPABASE_URL =
  process.env.WFILEMANAGER_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co";
const INSTANCE_KEY =
  process.env.WFILEMANAGER_INSTANCE_KEY ||
  process.env.VITE_WFILEMANAGER_INSTANCE_KEY ||
  "wfilemanager-kmerhosting-com";
const AUTH_URL = `${SUPABASE_URL}/functions/v1/wfilemanager-api/me`;
const VERIFY_PASSWORD_URL = `${SUPABASE_URL}/functions/v1/wfilemanager-api/verify-password`;
const ROLE_ACCESS_URL = `${SUPABASE_URL}/functions/v1/wfilemanager-roles-api/permissions`;
const MAX_TEXT_BYTES = Number(process.env.WFILEMANAGER_MAX_TEXT_BYTES || 5 * 1024 * 1024);
const MAX_COMMAND_OUTPUT = Number(process.env.WFILEMANAGER_MAX_COMMAND_OUTPUT || 4 * 1024 * 1024);
const COMMAND_TIMEOUT_MS = Number(process.env.WFILEMANAGER_COMMAND_TIMEOUT_MS || 60_000);
const TRASH_ROOT = process.env.WFILEMANAGER_TRASH_DIR || "/var/lib/wfilemanager/trash";
const UPDATE_MANIFEST_URL = process.env.WFILEMANAGER_UPDATE_MANIFEST_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/stable.json";
const UPDATE_STATE_FILE = process.env.WFILEMANAGER_UPDATE_STATE_FILE || "/var/lib/wfilemanager/update/state.json";
const UPDATE_SCRIPT = process.env.WFILEMANAGER_UPDATE_SCRIPT || "/usr/local/lib/wfilemanager/update.sh";

const authCache = new Map<string, { expiresAt: number; user: LocalUser }>();

export class LocalApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface LocalUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  status: string;
  roleId?: string | null;
  roleName?: string | null;
  permissions?: string[];
}

export interface LocalFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: string;
  uid: number;
  gid: number;
  modifiedAt: string;
  createdAt: string;
  accessedAt: string;
  hidden: boolean;
  linkTarget?: string;
  mime: string;
  readable: boolean;
  writable: boolean;
}

export interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  deletedAt: string;
  deletedBy: string;
  size: number;
  kind: LocalFileEntry["kind"];
}

function tokenFromRequest(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export async function requireUser(request: Request): Promise<LocalUser> {
  const token = tokenFromRequest(request);
  if (!token) throw new LocalApiError(401, "Missing session token");

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const response = await fetch(AUTH_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-wfilemanager-instance": INSTANCE_KEY,
    },
  });

  if (!response.ok) {
    authCache.delete(token);
    throw new LocalApiError(401, "Your wFileManager session is invalid or expired");
  }

  const payload = (await response.json()) as { user?: LocalUser };
  if (!payload.user || payload.user.status !== "active") {
    throw new LocalApiError(403, "This account is not active");
  }

  let user = payload.user;
  try {
    const roleResponse = await fetch(ROLE_ACCESS_URL, {
      headers: { Authorization: `Bearer ${token}`, "x-wfilemanager-instance": INSTANCE_KEY },
    });
    if (roleResponse.ok) {
      const access = await roleResponse.json() as { roleId?: string | null; roleName?: string | null; permissions?: string[] };
      user = { ...user, roleId: access.roleId ?? user.roleId, roleName: access.roleName, permissions: Array.isArray(access.permissions) ? access.permissions : [] };
    }
  } catch {
    if (!user.isAdmin) user = { ...user, permissions: [] };
  }

  authCache.set(token, { user, expiresAt: Date.now() + 30_000 });
  return user;
}

export function assertAdmin(user: LocalUser) {
  if (!user.isAdmin) {
    throw new LocalApiError(403, "Administrator access is required for this operation");
  }
}

export function assertPermission(user: LocalUser, permission: string) {
  if (user.isAdmin) return;
  if (!Array.isArray(user.permissions) || !user.permissions.includes(permission)) {
    throw new LocalApiError(403, `Your role does not include the ${permission.replace(/_/g, " ")} permission`);
  }
}

export function assertAnyPermission(user: LocalUser, permissions: string[]) {
  if (user.isAdmin) return;
  if (!Array.isArray(user.permissions) || !permissions.some((permission) => user.permissions?.includes(permission))) {
    throw new LocalApiError(403, "Your role does not allow this operation");
  }
}

export async function requireAdmin(request: Request): Promise<LocalUser> {
  const user = await requireUser(request);
  assertAdmin(user);
  return user;
}

export async function requirePermission(request: Request, permission: string): Promise<LocalUser> {
  const user = await requireUser(request);
  assertPermission(user, permission);
  return user;
}

export async function requireAnyPermission(request: Request, permissions: string[]): Promise<LocalUser> {
  const user = await requireUser(request);
  assertAnyPermission(user, permissions);
  return user;
}

export async function verifyCurrentPassword(request: Request, passwordInput: unknown) {
  const token = tokenFromRequest(request);
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (!token || !password) throw new LocalApiError(400, "Your current password is required");
  const response = await fetch(VERIFY_PASSWORD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
    },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({})) as { valid?: boolean; error?: string };
  if (!response.ok || !payload.valid) {
    throw new LocalApiError(response.status === 429 ? 429 : 401, payload.error || "The password is incorrect");
  }
  return true;
}

function linuxUsernameFor(user: Pick<LocalUser, "id" | "username">) {
  const base = user.username.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[-_]+|[-_]+$/g, "") || "user";
  const suffix = user.id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase() || "local";
  return `wfm_${base.slice(0, 18)}_${suffix}`.slice(0, 31);
}

async function writeProcess(command: string, args: string[], input: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with ${code}`)));
    child.stdin.end(input);
  });
}

async function ensureLinuxAccount(user: Pick<LocalUser, "id" | "username" | "displayName">, password?: string) {
  const username = linuxUsernameFor(user);
  let exists = true;
  try { await execFileAsync("id", ["-u", username], { timeout: 5000 }); } catch { exists = false; }
  if (!exists) {
    await execFileAsync("useradd", [
      "--create-home",
      "--shell", "/bin/bash",
      "--groups", "sudo",
      "--comment", `wFileManager user ${user.id}`,
      username,
    ], { timeout: 15000 });
  } else {
    await execFileAsync("usermod", ["-aG", "sudo", username], { timeout: 10000 });
  }
  const home = `/home/${username}`;
  await mkdir(home, { recursive: true, mode: 0o750 });
  await execFileAsync("chown", [`${username}:${username}`, home], { timeout: 5000 }).catch(() => undefined);
  if (password) {
    if (password.includes("\n") || password.includes("\r")) throw new LocalApiError(400, "The password cannot contain a line break");
    await writeProcess("chpasswd", [], `${username}:${password}\n`);
  }
  const [{ stdout: uidText }, { stdout: gidText }] = await Promise.all([
    execFileAsync("id", ["-u", username], { timeout: 5000 }),
    execFileAsync("id", ["-g", username], { timeout: 5000 }),
  ]);
  return { linuxUsername: username, home, uid: Number(uidText.trim()), gid: Number(gidText.trim()), sudo: true };
}

export async function terminalIdentity(user: LocalUser) {
  return ensureLinuxAccount(user);
}

export async function provisionCurrentLinuxUser(request: Request, user: LocalUser, passwordInput: unknown) {
  const password = typeof passwordInput === "string" ? passwordInput : "";
  await verifyCurrentPassword(request, password);
  return ensureLinuxAccount(user, password);
}

export async function provisionManagedLinuxUser(targetInput: unknown, passwordInput: unknown) {
  const target = targetInput as Partial<LocalUser> | null;
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (!target?.id || !target.username) throw new LocalApiError(400, "Target user information is incomplete");
  if (password.length < 8) throw new LocalApiError(400, "The Linux account password must contain at least 8 characters");
  return ensureLinuxAccount({ id: target.id, username: target.username, displayName: target.displayName || target.username }, password);
}

export async function syncCurrentLinuxPassword(user: LocalUser, passwordInput: unknown) {
  const password = typeof passwordInput === "string" ? passwordInput : "";
  if (password.length < 8) throw new LocalApiError(400, "The new password must contain at least 8 characters");
  return ensureLinuxAccount(user, password);
}

export async function deprovisionManagedLinuxUser(actor: LocalUser, targetInput: unknown) {
  const target = targetInput as Partial<LocalUser> | null;
  if (!target?.id || !target.username) throw new LocalApiError(400, "Target user information is incomplete");
  if (target.id === actor.id) throw new LocalApiError(400, "You cannot delete your own Linux account");
  const username = linuxUsernameFor({ id: target.id, username: target.username });
  const exists = await execFileAsync("id", ["-u", username], { timeout: 5000 }).then(() => true).catch(() => false);
  if (!exists) return { success: true as const, linuxUsername: username, removed: false };
  await execFileAsync("pkill", ["-u", username], { timeout: 5000 }).catch(() => undefined);
  await execFileAsync("userdel", ["--remove", username], { timeout: 30000 });
  return { success: true as const, linuxUsername: username, removed: true };
}

export function normalizeServerPath(input: unknown, fallback = "/"): string {
  const raw = typeof input === "string" && input.trim() ? input.trim() : fallback;
  if (raw.includes("\0")) throw new LocalApiError(400, "Invalid path");
  const absolute = raw.startsWith("/") ? raw : `/${raw}`;
  return path.resolve("/", absolute);
}

function assertSafeWrite(target: string) {
  if (target === "/") throw new LocalApiError(400, "The root directory itself cannot be modified");
  if (target === TRASH_ROOT || target.startsWith(`${TRASH_ROOT}/`)) {
    throw new LocalApiError(403, "The internal wFileManager trash cannot be modified from File Explorer");
  }
  if (process.env.WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE === "true") return;
  const blocked = ["/proc", "/sys", "/dev", "/run"];
  if (blocked.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) {
    throw new LocalApiError(403, `Writes to ${target} are disabled because it is a kernel-managed filesystem`);
  }
}

function fileKind(value: Awaited<ReturnType<typeof lstat>>): LocalFileEntry["kind"] {
  if (value.isDirectory()) return "directory";
  if (value.isFile()) return "file";
  if (value.isSymbolicLink()) return "symlink";
  return "other";
}

function mimeFor(filePath: string, kind: LocalFileEntry["kind"]) {
  if (kind === "directory") return "inode/directory";
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".log": "text/plain",
    ".conf": "text/plain",
    ".ini": "text/plain",
    ".service": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".xml": "application/xml",
    ".csv": "text/csv",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".jsx": "text/javascript",
    ".sh": "text/x-shellscript",
    ".py": "text/x-python",
    ".php": "text/x-php",
    ".sql": "application/sql",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
  };
  return map[ext] || "application/octet-stream";
}

async function permissionsFor(target: string) {
  const [readable, writable] = await Promise.all([
    access(target, fsConstants.R_OK).then(() => true).catch(() => false),
    access(target, fsConstants.W_OK).then(() => true).catch(() => false),
  ]);
  return { readable, writable };
}

async function entryFor(parent: string, name: string): Promise<LocalFileEntry> {
  const target = path.join(parent, name);
  const info = await lstat(target);
  const kind = fileKind(info);
  const perms = await permissionsFor(target);
  let linkTarget: string | undefined;
  if (kind === "symlink") linkTarget = await readlink(target).catch(() => undefined);

  return {
    name,
    path: target,
    kind,
    size: info.size,
    mode: (info.mode & 0o7777).toString(8).padStart(4, "0"),
    uid: info.uid,
    gid: info.gid,
    modifiedAt: info.mtime.toISOString(),
    createdAt: info.birthtime.toISOString(),
    accessedAt: info.atime.toISOString(),
    hidden: name.startsWith("."),
    linkTarget,
    mime: mimeFor(target, kind),
    ...perms,
  };
}

export async function listDirectory(inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  const info = await stat(target).catch(() => null);
  if (!info) throw new LocalApiError(404, "Directory not found");
  if (!info.isDirectory()) throw new LocalApiError(400, "The selected path is not a directory");

  const names = await readdir(target);
  const settled = await Promise.allSettled(names.map((name) => entryFor(target, name)));
  const entries = settled
    .filter((result): result is PromiseFulfilledResult<LocalFileEntry> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        if (a.kind === "directory") return -1;
        if (b.kind === "directory") return 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

  return {
    path: target,
    realPath: await realpath(target).catch(() => target),
    entries,
  };
}

function looksBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

export async function readTextFile(inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  const info = await stat(target).catch(() => null);
  if (!info) throw new LocalApiError(404, "File not found");
  if (!info.isFile()) throw new LocalApiError(400, "The selected path is not a regular file");
  if (info.size > MAX_TEXT_BYTES) {
    throw new LocalApiError(413, `This file exceeds the ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB editor limit`);
  }
  const buffer = await readFile(target);
  if (looksBinary(buffer)) throw new LocalApiError(415, "Binary files cannot be edited in the text editor");
  return {
    path: target,
    content: buffer.toString("utf8"),
    size: info.size,
    mime: mimeFor(target, "file"),
    modifiedAt: info.mtime.toISOString(),
    mode: (info.mode & 0o7777).toString(8).padStart(4, "0"),
  };
}

export async function saveTextFile(inputPath: unknown, content: unknown) {
  const target = normalizeServerPath(inputPath);
  assertSafeWrite(target);
  if (typeof content !== "string") throw new LocalApiError(400, "File content must be text");
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new LocalApiError(413, "Content is too large");
  await writeFile(target, content, "utf8");
  return readTextFile(target);
}

function safeName(input: unknown) {
  if (typeof input !== "string") throw new LocalApiError(400, "A name is required");
  const value = input.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\0")) {
    throw new LocalApiError(400, "Invalid filename");
  }
  return value;
}

export async function createFileAt(parentPath: unknown, nameInput: unknown, content: unknown = "") {
  const parent = normalizeServerPath(parentPath);
  const name = safeName(nameInput);
  const target = path.join(parent, name);
  assertSafeWrite(target);
  await writeFile(target, typeof content === "string" ? content : "", { flag: "wx" });
  return entryFor(parent, name);
}

export async function createDirectoryAt(parentPath: unknown, nameInput: unknown) {
  const parent = normalizeServerPath(parentPath);
  const name = safeName(nameInput);
  const target = path.join(parent, name);
  assertSafeWrite(target);
  await mkdir(target, { recursive: false });
  return entryFor(parent, name);
}

async function ensureDestinationAbsent(destination: string) {
  const exists = await lstat(destination).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (exists) throw new LocalApiError(409, `Destination already exists: ${destination}`);
}

export async function renameEntry(inputPath: unknown, nameInput: unknown) {
  const source = normalizeServerPath(inputPath);
  const name = safeName(nameInput);
  const destination = path.join(path.dirname(source), name);
  assertSafeWrite(source);
  assertSafeWrite(destination);
  if (source !== destination) await ensureDestinationAbsent(destination);
  await rename(source, destination);
  return { source, destination };
}

export async function deleteEntry(inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  assertSafeWrite(target);
  await rm(target, { recursive: true, force: false });
  return { deleted: target };
}

export async function copyEntry(sourceInput: unknown, destinationDirectoryInput: unknown) {
  const source = normalizeServerPath(sourceInput);
  const destinationDirectory = normalizeServerPath(destinationDirectoryInput);
  const destination = path.join(destinationDirectory, path.basename(source));
  assertSafeWrite(destination);
  const info = await lstat(source);
  if (info.isDirectory()) await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  else await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  return { source, destination };
}

export async function moveEntry(sourceInput: unknown, destinationDirectoryInput: unknown) {
  const source = normalizeServerPath(sourceInput);
  const destinationDirectory = normalizeServerPath(destinationDirectoryInput);
  const destination = path.join(destinationDirectory, path.basename(source));
  assertSafeWrite(source);
  assertSafeWrite(destination);
  await ensureDestinationAbsent(destination);
  try {
    await rename(source, destination);
  } catch (error: any) {
    if (error?.code !== "EXDEV") throw error;
    const info = await lstat(source);
    if (info.isDirectory()) await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    else await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    await rm(source, { recursive: true });
  }
  return { source, destination };
}

function safeTrashOwner(ownerUserId: string) {
  return ownerUserId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeTrashId(idInput: unknown) {
  const id = String(idInput || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new LocalApiError(400, "Invalid trash item identifier");
  return id;
}

function trashOwnerRoot(ownerUserId: string) {
  return path.join(TRASH_ROOT, safeTrashOwner(ownerUserId));
}

function trashPaths(ownerUserId: string, id: string) {
  const itemRoot = path.join(trashOwnerRoot(ownerUserId), id);
  return { itemRoot, payload: path.join(itemRoot, "payload"), metadata: path.join(itemRoot, "metadata.json") };
}

async function loadTrashMetadata(ownerUserId: string, idInput: unknown): Promise<TrashItem> {
  const id = safeTrashId(idInput);
  const locations = trashPaths(ownerUserId, id);
  const value = JSON.parse(await readFile(locations.metadata, "utf8")) as TrashItem;
  if (value.id !== id) throw new LocalApiError(409, "Trash metadata is inconsistent");
  return value;
}

async function copyAcrossFilesystems(source: string, destination: string) {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await rm(source, { recursive: true, force: false });
}

export async function listTrash(user: LocalUser) {
  const ownerRoot = trashOwnerRoot(user.id);
  await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
  const ids = await readdir(ownerRoot).catch(() => [] as string[]);
  const settled = await Promise.allSettled(ids.map(async (id) => {
    const item = await loadTrashMetadata(user.id, id);
    const payload = trashPaths(user.id, id).payload;
    await lstat(payload);
    return item;
  }));
  const items = settled
    .filter((result): result is PromiseFulfilledResult<TrashItem> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { items, totalSize: items.reduce((sum, item) => sum + item.size, 0) };
}

export async function moveToTrash(user: LocalUser, inputPath: unknown) {
  const source = normalizeServerPath(inputPath);
  assertSafeWrite(source);
  const info = await lstat(source).catch(() => null);
  if (!info) throw new LocalApiError(404, "File or directory not found");
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const locations = trashPaths(user.id, id);
  await mkdir(trashOwnerRoot(user.id), { recursive: true, mode: 0o700 });
  await mkdir(locations.itemRoot, { recursive: false, mode: 0o700 });
  const items = await scanTree(source);
  const metadata: TrashItem = {
    id,
    name: path.basename(source),
    originalPath: source,
    deletedAt: new Date().toISOString(),
    deletedBy: user.displayName || user.username,
    size: items.reduce((sum, item) => sum + item.size, 0),
    kind: fileKind(info),
  };
  await writeFile(locations.metadata, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  try {
    await rename(source, locations.payload);
  } catch (error: any) {
    if (error?.code !== "EXDEV") {
      await rm(locations.itemRoot, { recursive: true, force: true });
      throw error;
    }
    try {
      await copyAcrossFilesystems(source, locations.payload);
    } catch (copyError) {
      await rm(locations.itemRoot, { recursive: true, force: true });
      throw copyError;
    }
  }
  return metadata;
}

export async function restoreTrashItem(user: LocalUser, idInput: unknown) {
  const item = await loadTrashMetadata(user.id, idInput);
  const locations = trashPaths(user.id, item.id);
  const destination = normalizeServerPath(item.originalPath);
  assertSafeWrite(destination);
  await ensureDestinationAbsent(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await rename(locations.payload, destination);
  } catch (error: any) {
    if (error?.code !== "EXDEV") throw error;
    await copyAcrossFilesystems(locations.payload, destination);
  }
  await rm(locations.itemRoot, { recursive: true, force: true });
  return { restored: destination, item };
}

export async function permanentlyDeleteTrashItem(user: LocalUser, idInput: unknown) {
  const item = await loadTrashMetadata(user.id, idInput);
  const locations = trashPaths(user.id, item.id);
  await rm(locations.itemRoot, { recursive: true, force: true });
  return { deleted: item.id, item };
}

export async function emptyTrash(user: LocalUser) {
  const ownerRoot = trashOwnerRoot(user.id);
  const current = await listTrash(user);
  await rm(ownerRoot, { recursive: true, force: true });
  await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
  return { deletedItems: current.items.length, deletedBytes: current.totalSize };
}

export async function changeMode(inputPath: unknown, modeInput: unknown) {
  const target = normalizeServerPath(inputPath);
  assertSafeWrite(target);
  const modeText = String(modeInput || "").replace(/^0o?/, "");
  if (!/^[0-7]{3,4}$/.test(modeText)) throw new LocalApiError(400, "Mode must be an octal value such as 0644 or 0755");
  await chmod(target, Number.parseInt(modeText, 8));
  return { path: target, mode: modeText.padStart(4, "0") };
}

export async function saveRawUpload(parentInput: unknown, nameInput: unknown, body: ReadableStream<Uint8Array> | null) {
  const parent = normalizeServerPath(parentInput);
  const name = safeName(nameInput);
  const target = path.join(parent, name);
  const temporary = path.join(parent, `.${name}.wfilemanager-${crypto.randomUUID()}.part`);
  assertSafeWrite(target);
  if (!body) throw new LocalApiError(400, "Upload body is empty");
  try {
    await pipeline(Readable.fromWeb(body as any), createWriteStream(temporary, { flags: "wx" }));
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return entryFor(parent, name);
}

export async function saveUploads(parentInput: unknown, formData: FormData) {
  const parent = normalizeServerPath(parentInput);
  const uploaded: LocalFileEntry[] = [];
  for (const value of formData.getAll("files")) {
    if (!(value instanceof File)) continue;
    const name = safeName(value.name);
    const target = path.join(parent, name);
    assertSafeWrite(target);
    await writeFile(target, Buffer.from(await value.arrayBuffer()));
    uploaded.push(await entryFor(parent, name));
  }
  if (!uploaded.length) throw new LocalApiError(400, "No files were uploaded");
  return { uploaded };
}

export async function downloadResponse(inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  const info = await stat(target).catch(() => null);
  if (!info) throw new LocalApiError(404, "File not found");
  if (!info.isFile()) throw new LocalApiError(400, "Only regular files can be downloaded in this initial version");
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": mimeFor(target, "file"),
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
      "Cache-Control": "no-store",
    },
  });
}

function parseCd(command: string, cwd: string) {
  const match = command.match(/^\s*cd(?:\s+(.+?))?\s*$/s);
  if (!match) return null;
  let raw = (match[1] || "/root").trim();
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1);
  if (raw === "~" || raw.startsWith("~/")) raw = path.join("/root", raw.slice(2));
  return normalizeServerPath(path.isAbsolute(raw) ? raw : path.resolve(cwd, raw));
}

export async function executeCommand(commandInput: unknown, cwdInput: unknown) {
  const command = typeof commandInput === "string" ? commandInput.trim() : "";
  if (!command) return { cwd: normalizeServerPath(cwdInput, "/root"), stdout: "", stderr: "", exitCode: 0 };
  const cwd = normalizeServerPath(cwdInput, "/root");
  const cwdInfo = await stat(cwd).catch(() => null);
  if (!cwdInfo?.isDirectory()) throw new LocalApiError(400, "The terminal working directory does not exist");

  const cdTarget = parseCd(command, cwd);
  if (cdTarget) {
    const targetInfo = await stat(cdTarget).catch(() => null);
    if (!targetInfo?.isDirectory()) {
      return { cwd, stdout: "", stderr: `bash: cd: ${cdTarget}: No such directory\n`, exitCode: 1 };
    }
    return { cwd: cdTarget, stdout: "", stderr: "", exitCode: 0 };
  }

  try {
    const result = await execFileAsync("/bin/bash", ["-lc", command], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_OUTPUT,
      env: {
        ...process.env,
        HOME: "/root",
        USER: "root",
        LOGNAME: "root",
        SHELL: "/bin/bash",
        TERM: "xterm-256color",
        LANG: process.env.LANG || "C.UTF-8",
      },
    });
    return { cwd, stdout: result.stdout || "", stderr: result.stderr || "", exitCode: 0 };
  } catch (error: any) {
    const timedOut = error?.killed || error?.signal === "SIGTERM";
    return {
      cwd,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: timedOut
        ? `Command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)} seconds\n`
        : typeof error?.stderr === "string" && error.stderr
          ? error.stderr
          : `${error?.message || "Command failed"}\n`,
      exitCode: typeof error?.code === "number" ? error.code : 1,
    };
  }
}

export async function systemSummary() {
  let osRelease: Record<string, string> = {};
  try {
    const content = await readFile("/etc/os-release", "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const raw = match[2].trim();
      osRelease[match[1]] = raw.replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch {
    osRelease = {};
  }
  let disk: { total: number; used: number; available: number; percent: number } | null = null;
  try {
    const { stdout } = await execFileAsync("df", ["-P", "-B1", "/"], { timeout: 5000 });
    const line = stdout.trim().split("\n").at(-1)?.trim().split(/\s+/);
    if (line && line.length >= 5) {
      const total = Number(line[1]);
      const used = Number(line[2]);
      const available = Number(line[3]);
      disk = { total, used, available, percent: total ? Math.round((used / total) * 100) : 0 };
    }
  } catch {
    disk = null;
  }
  let loginUsers = 0;
  try {
    const passwd = await readFile("/etc/passwd", "utf8");
    loginUsers = passwd
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(":"))
      .filter((parts) => {
        const username = parts[0] || "";
        const uid = Number(parts[2]);
        const shell = parts[6] || "";
        const interactiveShell = Boolean(shell) && !shell.endsWith("/nologin") && !shell.endsWith("/false");
        return interactiveShell && (username === "root" || uid >= 1000);
      })
      .length;
  } catch {
    loginUsers = 0;
  }
  return {
    loginUsers,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    uptime: os.uptime(),
    memory: { total: os.totalmem(), free: os.freemem() },
    disk,
    node: process.version,
    os: {
      id: osRelease.ID || os.platform(),
      name: osRelease.NAME || os.platform(),
      versionId: osRelease.VERSION_ID || "",
      versionCodename: osRelease.VERSION_CODENAME || "",
      prettyName: osRelease.PRETTY_NAME || `${os.platform()} ${os.release()}`,
    },
  };
}

export interface StorageMount {
  device: string;
  mountpoint: string;
  fstype: string;
  options: string;
  total: number;
  used: number;
  available: number;
  percent: number;
  inodesTotal: number;
  inodesUsed: number;
  inodesAvailable: number;
  inodePercent: number;
  readonly: boolean;
  health: "healthy" | "warning" | "critical" | "read-only";
}

const IGNORED_FILESYSTEMS = new Set([
  "proc", "sysfs", "devtmpfs", "devpts", "cgroup", "cgroup2", "securityfs",
  "pstore", "debugfs", "tracefs", "configfs", "fusectl", "mqueue", "hugetlbfs",
  "rpc_pipefs", "autofs", "binfmt_misc", "efivarfs", "ramfs", "tmpfs",
  "squashfs", "overlay", "aufs", "nsfs", "fuse.lxcfs",
]);

function flattenFindmnt(items: any[], output: any[] = []) {
  for (const item of items || []) {
    output.push(item);
    if (Array.isArray(item.children)) flattenFindmnt(item.children, output);
  }
  return output;
}

export async function storageSummary(): Promise<{ mounts: StorageMount[]; primary: StorageMount | null; volumeCount: number; generatedAt: string }> {
  const { stdout } = await execFileAsync(
    "findmnt",
    ["--json", "--output", "SOURCE,TARGET,FSTYPE,OPTIONS"],
    { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { filesystems?: any[] };
  const items = flattenFindmnt(parsed.filesystems || []).sort((a, b) => {
    const aRoot = String(a.target || "") === "/" ? 0 : 1;
    const bRoot = String(b.target || "") === "/" ? 0 : 1;
    return aRoot - bRoot;
  });
  const seenDevices = new Set<string>();
  const mounts: StorageMount[] = [];

  for (const item of items) {
    const mountpoint = String(item.target || "");
    const fstype = String(item.fstype || "unknown");
    const rawDevice = String(item.source || "unknown");
    const device = rawDevice.replace(/\[.*$/, "");
    const options = String(item.options || "");

    if (!mountpoint || IGNORED_FILESYSTEMS.has(fstype)) continue;
    if ((mountpoint.startsWith("/proc") || mountpoint.startsWith("/sys") || mountpoint.startsWith("/dev")) && mountpoint !== "/") continue;
    if (["none", "tmpfs", "overlay", "proc", "sysfs"].includes(device)) continue;
    if (mountpoint.startsWith("/var/lib/docker/") || mountpoint.startsWith("/snap/")) continue;
    if (seenDevices.has(device)) continue;
    seenDevices.add(device);

    try {
      const info = await statfs(mountpoint);
      const blockSize = Number(info.bsize || 0);
      const total = Math.max(0, Number(info.blocks || 0) * blockSize);
      const available = Math.max(0, Number(info.bavail || 0) * blockSize);
      const free = Math.max(0, Number(info.bfree || 0) * blockSize);
      const used = Math.max(0, total - free);
      const inodesTotal = Math.max(0, Number(info.files || 0));
      const inodesAvailable = Math.max(0, Number(info.ffree || 0));
      const inodesUsed = Math.max(0, inodesTotal - inodesAvailable);
      const percent = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
      const inodePercent = inodesTotal ? Math.min(100, Math.round((inodesUsed / inodesTotal) * 100)) : 0;
      const readonly = options.split(",").includes("ro");
      const health = readonly ? "read-only" : Math.max(percent, inodePercent) >= 90 ? "critical" : Math.max(percent, inodePercent) >= 80 ? "warning" : "healthy";
      mounts.push({ device, mountpoint, fstype, options, total, used, available, percent, inodesTotal, inodesUsed, inodesAvailable, inodePercent, readonly, health });
    } catch {
      // Ignore transient or inaccessible mount points.
    }
  }

  mounts.sort((a, b) => a.mountpoint === "/" ? -1 : b.mountpoint === "/" ? 1 : a.mountpoint.localeCompare(b.mountpoint));
  const primary = mounts.find((mount) => mount.mountpoint === "/") || mounts[0] || null;
  return { mounts, primary, volumeCount: mounts.length, generatedAt: new Date().toISOString() };
}

export interface UpdateState {
  status: "idle" | "checking" | "downloading" | "verifying" | "extracting" | "installing" | "building" | "switching" | "restarting" | "health-check" | "completed" | "failed" | "rolling-back";
  progress: number;
  message: string;
  currentVersion?: string | null;
  targetVersion?: string | null;
  previousVersion?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

function idleUpdateState(currentVersion?: string): UpdateState {
  return { status: "idle", progress: 0, message: "No update is running", currentVersion: currentVersion || null };
}

async function readUpdateState(currentVersion?: string): Promise<UpdateState> {
  try {
    const value = JSON.parse(await readFile(UPDATE_STATE_FILE, "utf8")) as Partial<UpdateState>;
    return {
      ...idleUpdateState(currentVersion),
      ...value,
      progress: Math.max(0, Math.min(100, Number(value.progress) || 0)),
    };
  } catch {
    return idleUpdateState(currentVersion);
  }
}

async function installedVersion() {
  let currentVersion = process.env.WFILEMANAGER_VERSION || "0.6.11";
  try {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
    if (typeof packageJson.version === "string") currentVersion = packageJson.version;
  } catch {
    // Use the embedded version.
  }
  return currentVersion;
}

function compareVersions(left: string, right: string) {
  const a = left.split(/[.-]/).slice(0, 3).map((value) => Number(value) || 0);
  const b = right.split(/[.-]/).slice(0, 3).map((value) => Number(value) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

export async function updateSummary() {
  const currentVersion = await installedVersion();
  const state = await readUpdateState(currentVersion);
  const sourceConfigured = Boolean(UPDATE_MANIFEST_URL);
  if (!sourceConfigured) {
    return { currentVersion, latestVersion: null, updateAvailable: false, sourceConfigured: false, checkedAt: new Date().toISOString(), state, rollbackAvailable: Boolean(state.previousVersion) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(UPDATE_MANIFEST_URL, { signal: controller.signal, headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!response.ok) throw new Error(`Update server returned ${response.status}`);
    const payload = await response.json() as {
      version?: string; url?: string; releaseUrl?: string; notes?: string | string[];
      publishedAt?: string; size?: number; sha256?: string; channel?: string;
    };
    const latestVersion = typeof payload.version === "string" ? payload.version : null;
    const notes = Array.isArray(payload.notes) ? payload.notes.join("\n") : typeof payload.notes === "string" ? payload.notes : null;
    return {
      currentVersion, latestVersion,
      updateAvailable: Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0),
      sourceConfigured: true,
      downloadUrl: typeof payload.releaseUrl === "string" ? payload.releaseUrl : typeof payload.url === "string" ? payload.url : null,
      notes,
      publishedAt: typeof payload.publishedAt === "string" ? payload.publishedAt : null,
      size: typeof payload.size === "number" ? payload.size : null,
      sha256: typeof payload.sha256 === "string" ? payload.sha256 : null,
      channel: typeof payload.channel === "string" ? payload.channel : "stable",
      checkedAt: new Date().toISOString(),
      state,
      rollbackAvailable: Boolean(state.previousVersion),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function startUpdater(action: "install" | "rollback") {
  try {
    await access(UPDATE_SCRIPT, fsConstants.X_OK);
  } catch {
    throw new LocalApiError(503, `Updater is not installed at ${UPDATE_SCRIPT}`);
  }
  const unit = `wfilemanager-updater@${action}.service`;
  try {
    await execFileAsync("/usr/bin/systemctl", ["start", "--no-block", unit], { timeout: 10_000 });
  } catch (error) {
    const value = error as NodeJS.ErrnoException & { stderr?: string };
    throw new LocalApiError(500, value.stderr?.trim() || value.message || `Unable to start ${action}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { success: true as const, state: await readUpdateState(await installedVersion()) };
}

export function installAvailableUpdate() {
  return startUpdater("install");
}

export function rollbackApplicationUpdate() {
  return startUpdater("rollback");
}


// Long-running local operations -------------------------------------------------

type OperationName = "copy" | "move" | "delete";
type OperationStatus = "queued" | "running" | "completed" | "failed";

export interface OperationJob {
  id: string;
  ownerUserId: string;
  operation: OperationName;
  status: OperationStatus;
  progress: number;
  processedBytes: number;
  totalBytes: number;
  processedItems: number;
  totalItems: number;
  currentItem?: string;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface TreeItem {
  source: string;
  relative: string;
  kind: LocalFileEntry["kind"];
  size: number;
  mode: number;
  linkTarget?: string;
}

type GlobalRuntimeState = typeof globalThis & {
  __wfilemanagerJobs?: Map<string, OperationJob>;
  __wfilemanagerPtySessions?: Map<string, PtySession>;
};

const globalRuntime = globalThis as GlobalRuntimeState;
const operationJobs = globalRuntime.__wfilemanagerJobs ??= new Map<string, OperationJob>();

function updateJob(job: OperationJob, patch: Partial<OperationJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const numerator = job.totalBytes > 0 ? job.processedBytes : job.processedItems;
  const denominator = job.totalBytes > 0 ? job.totalBytes : job.totalItems;
  job.progress = denominator > 0 ? Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100))) : 0;
}

async function scanTree(root: string): Promise<TreeItem[]> {
  const entries: TreeItem[] = [];
  async function visit(target: string, relative: string) {
    const info = await lstat(target);
    const kind = fileKind(info);
    const item: TreeItem = {
      source: target,
      relative,
      kind,
      size: info.isFile() ? info.size : 0,
      mode: info.mode & 0o7777,
    };
    if (kind === "symlink") item.linkTarget = await readlink(target);
    entries.push(item);
    if (kind === "directory") {
      const names = await readdir(target);
      for (const name of names) await visit(path.join(target, name), path.join(relative, name));
    }
  }
  await visit(root, "");
  return entries;
}

async function copyTree(source: string, destination: string, job: OperationJob) {
  const items = await scanTree(source);
  job.totalItems = items.length;
  job.totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  updateJob(job, {});

  for (const item of items) {
    const target = item.relative ? path.join(destination, item.relative) : destination;
    job.currentItem = item.source;
    if (item.kind === "directory") {
      await mkdir(target, { recursive: false, mode: item.mode });
    } else if (item.kind === "file") {
      await copyFile(item.source, target, fsConstants.COPYFILE_EXCL);
      await chmod(target, item.mode).catch(() => undefined);
    } else if (item.kind === "symlink") {
      await symlink(item.linkTarget || "", target);
    } else {
      throw new LocalApiError(415, `Unsupported filesystem entry: ${item.source}`);
    }
    updateJob(job, {
      processedItems: job.processedItems + 1,
      processedBytes: job.processedBytes + item.size,
    });
  }
}

async function deleteTree(target: string, job: OperationJob) {
  const items = await scanTree(target);
  job.totalItems = items.length;
  job.totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  updateJob(job, {});

  for (const item of [...items].reverse()) {
    job.currentItem = item.source;
    if (item.kind === "directory") await rmdir(item.source);
    else await unlink(item.source);
    updateJob(job, {
      processedItems: job.processedItems + 1,
      processedBytes: job.processedBytes + item.size,
    });
  }
}

async function performJob(job: OperationJob, source: string, destinationDirectory?: string) {
  updateJob(job, { status: "running" });
  try {
    assertSafeWrite(source);
    if (job.operation === "delete") {
      await deleteTree(source, job);
      updateJob(job, { status: "completed", progress: 100, result: { deleted: source }, currentItem: undefined });
      return;
    }

    if (!destinationDirectory) throw new LocalApiError(400, "A destination directory is required");
    const destination = path.join(destinationDirectory, path.basename(source));
    assertSafeWrite(destination);
    await ensureDestinationAbsent(destination);

    if (job.operation === "move") {
      try {
        const items = await scanTree(source);
        job.totalItems = items.length;
        job.totalBytes = items.reduce((sum, item) => sum + item.size, 0);
        job.currentItem = source;
        await rename(source, destination);
        updateJob(job, {
          status: "completed",
          processedItems: job.totalItems,
          processedBytes: job.totalBytes,
          progress: 100,
          result: { source, destination },
          currentItem: undefined,
        });
        return;
      } catch (error: any) {
        if (error?.code !== "EXDEV") throw error;
      }
    }

    await copyTree(source, destination, job);
    if (job.operation === "move") {
      const cleanupJob = { ...job, processedItems: 0, processedBytes: 0 } as OperationJob;
      await deleteTree(source, cleanupJob);
    }
    updateJob(job, {
      status: "completed",
      progress: 100,
      result: { source, destination },
      currentItem: undefined,
    });
  } catch (error) {
    updateJob(job, {
      status: "failed",
      error: error instanceof Error ? error.message : "Operation failed",
      currentItem: undefined,
    });
  }
}

export function startOperationJob(ownerUserId: string, operationInput: unknown, sourceInput: unknown, destinationInput?: unknown) {
  const operation = String(operationInput || "") as OperationName;
  if (!["copy", "move", "delete"].includes(operation)) throw new LocalApiError(400, "Unsupported operation");
  const source = normalizeServerPath(sourceInput);
  const destination = destinationInput == null ? undefined : normalizeServerPath(destinationInput);
  const id = crypto.randomUUID();
  const job: OperationJob = {
    id,
    ownerUserId,
    operation,
    status: "queued",
    progress: 0,
    processedBytes: 0,
    totalBytes: 0,
    processedItems: 0,
    totalItems: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  operationJobs.set(id, job);
  void performJob(job, source, destination);
  return publicJob(job);
}

function publicJob(job: OperationJob) {
  const { ownerUserId: _ownerUserId, createdAt: _createdAt, updatedAt: _updatedAt, ...value } = job;
  return value;
}

export function getOperationJob(ownerUserId: string, idInput: unknown) {
  const id = String(idInput || "");
  const job = operationJobs.get(id);
  if (!job || job.ownerUserId !== ownerUserId) throw new LocalApiError(404, "Operation not found");
  return publicJob(job);
}

// Persistent interactive PTY terminal ------------------------------------------

type PtyProcess = import("node-pty").IPty;
interface PtyChunk { sequence: number; data: string }
interface PtySession {
  id: string;
  ownerUserId: string;
  process: PtyProcess;
  chunks: PtyChunk[];
  nextSequence: number;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
  createdAt: number;
  lastSeenAt: number;
}

const ptySessions = globalRuntime.__wfilemanagerPtySessions ??= new Map<string, PtySession>();

function ownedPty(ownerUserId: string, idInput: unknown) {
  const id = String(idInput || "");
  const session = ptySessions.get(id);
  if (!session || session.ownerUserId !== ownerUserId) throw new LocalApiError(404, "Terminal session not found");
  session.lastSeenAt = Date.now();
  return session;
}

export async function createPtySession(user: LocalUser, cwdInput: unknown, colsInput: unknown, rowsInput: unknown, modeInput: unknown) {
  const mode = String(modeInput || "user") === "root" ? "root" : "user";
  const identity = await ensureLinuxAccount(user);
  const fallbackCwd = mode === "root" ? "/root" : identity.home;
  let cwd = normalizeServerPath(cwdInput, fallbackCwd);
  const cwdInfo = await stat(cwd).catch(() => null);
  if (!cwdInfo?.isDirectory()) cwd = fallbackCwd;
  if (mode === "user") {
    const accessible = await execFileAsync("runuser", ["-u", identity.linuxUsername, "--", "test", "-x", cwd], { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!accessible) cwd = identity.home;
  }
  const cols = Math.max(20, Math.min(400, Number(colsInput) || 120));
  const rows = Math.max(5, Math.min(200, Number(rowsInput) || 32));
  const nodePty = await import("node-pty");
  const isRoot = mode === "root";
  const shellUser = isRoot ? "root" : identity.linuxUsername;
  const shellHome = isRoot ? "/root" : identity.home;
  const shellCommand = isRoot ? "/bin/bash" : "/usr/sbin/runuser";
  const shellArgs = isRoot ? ["--login"] : ["-u", identity.linuxUsername, "--", "/bin/bash", "--login"];
  const ptyProcess = nodePty.spawn(shellCommand, shellArgs, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...processEnv(),
      HOME: shellHome,
      USER: shellUser,
      LOGNAME: shellUser,
      SHELL: "/bin/bash",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "C.UTF-8",
      WFILEMANAGER_USER: user.username,
    },
  });
  const id = crypto.randomUUID();
  const session: PtySession = {
    id,
    ownerUserId: user.id,
    process: ptyProcess,
    chunks: [],
    nextSequence: 1,
    exited: false,
    exitCode: null,
    signal: null,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  ptyProcess.onData((data) => {
    session.chunks.push({ sequence: session.nextSequence++, data });
    if (session.chunks.length > 4000) session.chunks.splice(0, session.chunks.length - 3000);
  });
  ptyProcess.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode;
    session.signal = signal ?? null;
    session.chunks.push({ sequence: session.nextSequence++, data: `\r\n[Process exited with code ${exitCode}]\r\n` });
  });
  ptySessions.set(id, session);
  return { sessionId: id, mode, linuxUsername: shellUser, home: shellHome };
}

function processEnv() {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function writePty(ownerUserId: string, idInput: unknown, dataInput: unknown) {
  const session = ownedPty(ownerUserId, idInput);
  if (session.exited) throw new LocalApiError(409, "Terminal process has exited");
  if (typeof dataInput !== "string") throw new LocalApiError(400, "Terminal input must be text");
  session.process.write(dataInput);
  return { success: true as const };
}

export function resizePty(ownerUserId: string, idInput: unknown, colsInput: unknown, rowsInput: unknown) {
  const session = ownedPty(ownerUserId, idInput);
  const cols = Math.max(20, Math.min(400, Number(colsInput) || 120));
  const rows = Math.max(5, Math.min(200, Number(rowsInput) || 32));
  if (!session.exited) session.process.resize(cols, rows);
  return { success: true as const };
}

export function readPtyOutput(ownerUserId: string, idInput: unknown, cursorInput: unknown) {
  const session = ownedPty(ownerUserId, idInput);
  const cursor = Math.max(0, Number(cursorInput) || 0);
  const chunks = session.chunks.filter((chunk) => chunk.sequence > cursor);
  return {
    cursor: chunks.at(-1)?.sequence || cursor,
    data: chunks.map((chunk) => chunk.data).join(""),
    exited: session.exited,
    exitCode: session.exitCode,
    signal: session.signal,
  };
}

export function closePty(ownerUserId: string, idInput: unknown) {
  const session = ownedPty(ownerUserId, idInput);
  if (!session.exited) session.process.kill();
  ptySessions.delete(session.id);
  return { success: true as const };
}

const runtimeCleanupTimer = setInterval(() => {
  const staleBefore = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of ptySessions) {
    if (session.lastSeenAt < staleBefore) {
      if (!session.exited) session.process.kill();
      ptySessions.delete(id);
    }
  }
  const oldJobBefore = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of operationJobs) {
    if (job.updatedAt < oldJobBefore && ["completed", "failed"].includes(job.status)) operationJobs.delete(id);
  }
}, 60_000);
(runtimeCleanupTimer as unknown as { unref?: () => void }).unref?.();
