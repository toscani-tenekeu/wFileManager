import path from "node:path";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";

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
const TRASH_ROOT = path.resolve(process.env.WFILEMANAGER_TRASH_DIR || "/var/lib/wfilemanager/trash");
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

  const payload = await response.json() as { user?: LocalUser };
  if (!payload.user || payload.user.status !== "active") {
    throw new LocalApiError(403, "This account is not active");
  }

  let user = payload.user;
  try {
    const roleResponse = await fetch(ROLE_ACCESS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-wfilemanager-instance": INSTANCE_KEY,
      },
    });
    if (roleResponse.ok) {
      const access = await roleResponse.json() as {
        roleId?: string | null;
        roleName?: string | null;
        permissions?: string[];
      };
      user = {
        ...user,
        roleId: access.roleId ?? user.roleId,
        roleName: access.roleName ?? user.roleName,
        permissions: Array.isArray(access.permissions) ? access.permissions.filter((permission) => permission !== "use_terminal") : [],
      };
    }
  } catch {
    if (!user.isAdmin) user = { ...user, permissions: [] };
  }

  authCache.set(token, { user, expiresAt: Date.now() + 30_000 });
  return user;
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

export function normalizeServerPath(input: unknown, fallback = "/") {
  const raw = typeof input === "string" && input.trim() ? input.trim() : fallback;
  if (raw.includes("\0")) throw new LocalApiError(400, "Invalid path");
  return path.resolve("/", raw.startsWith("/") ? raw : `/${raw}`);
}

function isInside(target: string, root: string) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function assertSafeWrite(target: string) {
  if (target === "/") throw new LocalApiError(400, "The root directory itself cannot be modified");
  if (isInside(target, TRASH_ROOT)) {
    throw new LocalApiError(403, "The internal wFileManager trash cannot be modified from File Explorer");
  }
  if (process.env.WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE === "true") return;
  const blocked = ["/proc", "/sys", "/dev", "/run"].find((root) => isInside(target, root));
  if (blocked) throw new LocalApiError(403, `Writes to ${blocked} are disabled because it is a kernel-managed filesystem`);
}

function safeName(input: unknown) {
  if (typeof input !== "string") throw new LocalApiError(400, "A name is required");
  const value = input.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new LocalApiError(400, "Invalid filename");
  }
  return value;
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
  const permissions = await permissionsFor(target);
  const linkTarget = kind === "symlink" ? await readlink(target).catch(() => undefined) : undefined;
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
    ...permissions,
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
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        if (left.kind === "directory") return -1;
        if (right.kind === "directory") return 1;
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    });

  return {
    path: target,
    realPath: await realpath(target).catch(() => target),
    entries,
  };
}

function looksBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
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

  const handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW);
  try {
    await handle.writeFile(content, { encoding: "utf8" });
  } finally {
    await handle.close();
  }
  return readTextFile(target);
}

export async function createFileAt(parentPath: unknown, nameInput: unknown, content: unknown = "") {
  const parent = normalizeServerPath(parentPath);
  const name = safeName(nameInput);
  const target = path.join(parent, name);
  assertSafeWrite(target);
  const handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(typeof content === "string" ? content : "", { encoding: "utf8" });
  } finally {
    await handle.close();
  }
  return entryFor(parent, name);
}

export async function createDirectoryAt(parentPath: unknown, nameInput: unknown) {
  const parent = normalizeServerPath(parentPath);
  const name = safeName(nameInput);
  const target = path.join(parent, name);
  assertSafeWrite(target);
  await mkdir(target, { recursive: false, mode: 0o750 });
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

export async function changeMode(inputPath: unknown, modeInput: unknown) {
  const target = normalizeServerPath(inputPath);
  assertSafeWrite(target);
  const modeText = String(modeInput || "").replace(/^0o?/, "");
  if (!/^[0-7]{3,4}$/.test(modeText)) throw new LocalApiError(400, "Mode must be an octal value such as 0644 or 0755");
  await chmod(target, Number.parseInt(modeText, 8));
  return { path: target, mode: modeText.padStart(4, "0") };
}

export async function downloadResponse(inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  const info = await stat(target).catch(() => null);
  if (!info) throw new LocalApiError(404, "File not found");
  if (!info.isFile()) throw new LocalApiError(400, "Only regular files can be downloaded");
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": mimeFor(target, "file"),
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
  return {
    itemRoot,
    payload: path.join(itemRoot, "payload"),
    metadata: path.join(itemRoot, "metadata.json"),
  };
}

interface TreeItem {
  source: string;
  relative: string;
  kind: LocalFileEntry["kind"];
  size: number;
  mode: number;
  linkTarget?: string;
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
      for (const name of await readdir(target)) {
        await visit(path.join(target, name), path.join(relative, name));
      }
    }
  }
  await visit(root, "");
  return entries;
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
    await lstat(trashPaths(user.id, id).payload);
    return item;
  }));
  const items = settled
    .filter((result): result is PromiseFulfilledResult<TrashItem> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
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
  await writeFile(locations.metadata, JSON.stringify(metadata, null, 2), { mode: 0o600, flag: "wx" });

  try {
    await rename(source, locations.payload);
  } catch (error) {
    const value = error as NodeJS.ErrnoException;
    if (value.code !== "EXDEV") {
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
  } catch (error) {
    const value = error as NodeJS.ErrnoException;
    if (value.code !== "EXDEV") throw error;
    await copyAcrossFilesystems(locations.payload, destination);
  }
  await rm(locations.itemRoot, { recursive: true, force: true });
  return { restored: destination, item };
}

export async function permanentlyDeleteTrashItem(user: LocalUser, idInput: unknown) {
  const item = await loadTrashMetadata(user.id, idInput);
  await rm(trashPaths(user.id, item.id).itemRoot, { recursive: true, force: true });
  return { deleted: item.id, item };
}

export async function emptyTrash(user: LocalUser) {
  const ownerRoot = trashOwnerRoot(user.id);
  const current = await listTrash(user);
  await rm(ownerRoot, { recursive: true, force: true });
  await mkdir(ownerRoot, { recursive: true, mode: 0o700 });
  return { deletedItems: current.items.length, deletedBytes: current.totalSize };
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
  return {
    status: "idle",
    progress: 0,
    message: "No update is running",
    currentVersion: currentVersion || null,
  };
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
  let currentVersion = process.env.WFILEMANAGER_VERSION || "0.7.3";
  try {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    if (typeof packageJson.version === "string") currentVersion = packageJson.version;
  } catch {
    // Use the embedded version.
  }
  return currentVersion;
}

function compareVersions(left: string, right: string) {
  const first = left.split(/[.-]/).slice(0, 3).map((value) => Number(value) || 0);
  const second = right.split(/[.-]/).slice(0, 3).map((value) => Number(value) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((first[index] || 0) > (second[index] || 0)) return 1;
    if ((first[index] || 0) < (second[index] || 0)) return -1;
  }
  return 0;
}

export async function updateSummary() {
  const currentVersion = await installedVersion();
  const state = await readUpdateState(currentVersion);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(UPDATE_MANIFEST_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error(`Update server returned ${response.status}`);
    const payload = await response.json() as {
      version?: string;
      url?: string;
      releaseUrl?: string;
      notes?: string | string[];
      publishedAt?: string;
      size?: number;
      sha256?: string;
      channel?: string;
    };
    const latestVersion = typeof payload.version === "string" ? payload.version : null;
    const notes = Array.isArray(payload.notes)
      ? payload.notes.join("\n")
      : typeof payload.notes === "string" ? payload.notes : null;
    return {
      currentVersion,
      latestVersion,
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

type RuntimeState = typeof globalThis & {
  __wfilemanagerJobs?: Map<string, OperationJob>;
};

const runtime = globalThis as RuntimeState;
const operationJobs = runtime.__wfilemanagerJobs ??= new Map<string, OperationJob>();

function updateJob(job: OperationJob, patch: Partial<OperationJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const numerator = job.totalBytes > 0 ? job.processedBytes : job.processedItems;
  const denominator = job.totalBytes > 0 ? job.totalBytes : job.totalItems;
  job.progress = denominator > 0
    ? Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)))
    : 0;
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
      updateJob(job, {
        status: "completed",
        progress: 100,
        result: { deleted: source },
        currentItem: undefined,
      });
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
      } catch (error) {
        const value = error as NodeJS.ErrnoException;
        if (value.code !== "EXDEV") throw error;
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

export function startOperationJob(
  ownerUserId: string,
  operationInput: unknown,
  sourceInput: unknown,
  destinationInput?: unknown,
) {
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

const jobCleanupTimer = setInterval(() => {
  const staleBefore = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of operationJobs) {
    if (job.updatedAt < staleBefore && ["completed", "failed"].includes(job.status)) operationJobs.delete(id);
  }
}, 10 * 60 * 1000);
(jobCleanupTimer as unknown as { unref?: () => void }).unref?.();
