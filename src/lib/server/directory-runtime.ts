import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readlink, readdir, realpath, stat } from "node:fs/promises";
import {
  LocalApiError,
  normalizeServerPath,
  type LocalFileEntry,
} from "@/lib/server/local-runtime";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1_000;

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
    access(target, fsConstants.R_OK)
      .then(() => true)
      .catch(() => false),
    access(target, fsConstants.W_OK)
      .then(() => true)
      .catch(() => false),
  ]);
  return { readable, writable };
}

async function entryFor(parent: string, name: string): Promise<LocalFileEntry> {
  const target = path.join(parent, name);
  const info = await lstat(target);
  const kind = fileKind(info);
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
    ...(await permissionsFor(target)),
  };
}

export async function listDirectoryPage(
  inputPath: unknown,
  options: { cursor?: unknown; query?: unknown; limit?: unknown } = {},
) {
  const target = normalizeServerPath(inputPath);
  const info = await stat(target).catch(() => null);
  if (!info) throw new LocalApiError(404, "Directory not found");
  if (!info.isDirectory()) throw new LocalApiError(400, "The selected path is not a directory");

  const query = typeof options.query === "string" ? options.query.trim().toLocaleLowerCase() : "";
  const cursor = Math.max(0, Number.parseInt(String(options.cursor || "0"), 10) || 0);
  const limit = Math.max(
    1,
    Math.min(
      MAX_LIMIT,
      Number.parseInt(String(options.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    ),
  );
  const allNames = (await readdir(target))
    .filter((name) => !query || name.toLocaleLowerCase().includes(query))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
    );
  const names = allNames.slice(cursor, cursor + limit);
  const settled = await Promise.allSettled(names.map((name) => entryFor(target, name)));
  const entries = settled
    .filter(
      (result): result is PromiseFulfilledResult<LocalFileEntry> => result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        if (left.kind === "directory") return -1;
        if (right.kind === "directory") return 1;
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    });
  const next = cursor + names.length;

  return {
    path: target,
    realPath: await realpath(target).catch(() => target),
    entries,
    total: allNames.length,
    nextCursor: next < allNames.length ? String(next) : null,
    truncated: next < allNames.length,
  };
}
