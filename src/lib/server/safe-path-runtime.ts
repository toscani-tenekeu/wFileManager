import path from "node:path";
import { lstat, realpath, stat } from "node:fs/promises";
import { LocalApiError } from "@/lib/server/local-runtime";

const TRASH_ROOT = path.resolve(process.env.WFILEMANAGER_TRASH_DIR || "/var/lib/wfilemanager/trash");
const BLOCKED_ROOTS = ["/proc", "/sys", "/dev", "/run"].map((value) => path.resolve(value));

export function normalizeMutationPath(input: unknown) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) throw new LocalApiError(400, "A valid path is required");
  return path.resolve("/", input.startsWith("/") ? input : `/${input}`);
}

function isInside(target: string, root: string) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function assertAllowedResolvedPath(target: string) {
  if (target === "/") throw new LocalApiError(400, "The root directory itself cannot be modified");
  if (isInside(target, TRASH_ROOT)) throw new LocalApiError(403, "The internal wFileManager trash cannot be modified from File Explorer");
  if (process.env.WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE === "true") return;
  const blocked = BLOCKED_ROOTS.find((root) => isInside(target, root));
  if (blocked) throw new LocalApiError(403, `Writes to ${blocked} are disabled because it is a kernel-managed filesystem`);
}

async function assertNoSymlinkComponents(target: string, allowMissingLeaf: boolean) {
  const parts = target.split(path.sep).filter(Boolean);
  let current = "/";
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) {
      if (allowMissingLeaf && index === parts.length - 1) return;
      throw new LocalApiError(404, `Path does not exist: ${current}`);
    }
    if (info.isSymbolicLink()) {
      throw new LocalApiError(403, `Filesystem mutations through symbolic links are disabled: ${current}`);
    }
  }
}

export async function assertSafeExistingMutation(input: unknown) {
  const target = normalizeMutationPath(input);
  assertAllowedResolvedPath(target);
  await assertNoSymlinkComponents(target, false);
  const resolved = await realpath(target);
  assertAllowedResolvedPath(resolved);
  return resolved;
}

export async function assertSafeDestination(input: unknown) {
  const target = normalizeMutationPath(input);
  assertAllowedResolvedPath(target);
  const parent = path.dirname(target);
  await assertNoSymlinkComponents(parent, false);
  const resolvedParent = await realpath(parent);
  assertAllowedResolvedPath(resolvedParent);
  const resolvedTarget = path.join(resolvedParent, path.basename(target));
  assertAllowedResolvedPath(resolvedTarget);
  const existing = await lstat(resolvedTarget).catch(() => null);
  if (existing?.isSymbolicLink()) throw new LocalApiError(403, "The destination is a symbolic link");
  return resolvedTarget;
}

export async function assertSafeDirectory(input: unknown) {
  const target = await assertSafeExistingMutation(input);
  const info = await stat(target);
  if (!info.isDirectory()) throw new LocalApiError(400, "The selected path is not a directory");
  return target;
}

export async function assertDestinationAbsent(input: unknown) {
  const target = await assertSafeDestination(input);
  const exists = await lstat(target).then(() => true).catch(() => false);
  if (exists) throw new LocalApiError(409, "A file or directory already exists at the destination");
  return target;
}
