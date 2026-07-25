import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { LocalApiError, normalizeServerPath } from "@/lib/server/local-runtime";

function mimeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".txt": "text/plain",
    ".log": "text/plain",
    ".conf": "text/plain",
    ".ini": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".xml": "application/xml",
    ".csv": "text/csv",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".ts": "text/typescript",
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

function rangeFor(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) throw new LocalApiError(416, "Invalid byte range");
  let start = match[1] ? Number(match[1]) : NaN;
  let end = match[2] ? Number(match[2]) : NaN;
  if (!Number.isFinite(start) && Number.isFinite(end)) {
    const suffix = Math.max(1, end);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = size - 1;
  }
  if (start < 0 || end < start || start >= size)
    throw new LocalApiError(416, "Requested byte range is outside the file");
  return { start, end: Math.min(size - 1, end) };
}

export async function streamedDownloadResponse(request: Request, inputPath: unknown) {
  const target = normalizeServerPath(inputPath);
  const info = await stat(target).catch(() => null);
  if (!info) throw new LocalApiError(404, "File not found");
  if (!info.isFile()) throw new LocalApiError(400, "Only regular files can be downloaded");
  const requestedRange = rangeFor(request.headers.get("range"), info.size);
  const start = requestedRange?.start ?? 0;
  const end = requestedRange?.end ?? Math.max(0, info.size - 1);
  const length = info.size === 0 ? 0 : end - start + 1;
  const stream = Readable.toWeb(
    createReadStream(target, requestedRange ? { start, end } : undefined),
  ) as ReadableStream;
  const headers = new Headers({
    "Content-Type": mimeFor(target),
    "Content-Length": String(length),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  if (requestedRange) headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  return new Response(stream, { status: requestedRange ? 206 : 200, headers });
}
