import crypto from "node:crypto";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { link, rm, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LocalApiError, listDirectory, type LocalFileEntry } from "@/lib/server/local-runtime";
import { assertDestinationAbsent, assertSafeDirectory } from "@/lib/server/safe-path-runtime";

const MAX_UPLOAD_BYTES = Number(process.env.WFILEMANAGER_MAX_UPLOAD_BYTES || 10 * 1024 * 1024 * 1024);

function safeName(input: unknown) {
  if (typeof input !== "string") throw new LocalApiError(400, "A filename is required");
  const value = input.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new LocalApiError(400, "Invalid filename");
  }
  return value;
}

async function commitTemporaryFile(temporary: string, target: string) {
  try {
    await link(temporary, target);
  } catch (error: unknown) {
    const value = error as NodeJS.ErrnoException;
    if (value.code === "EEXIST") throw new LocalApiError(409, "A file with this name already exists");
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function uploadedEntry(parent: string, name: string): Promise<LocalFileEntry> {
  const result = await listDirectory(parent);
  const entry = result.entries.find((item) => item.name === name);
  if (!entry) throw new LocalApiError(500, "The uploaded file could not be verified");
  return entry;
}

async function streamUpload(parentInput: unknown, nameInput: unknown, body: ReadableStream<Uint8Array> | null, expectedSize?: number) {
  const parent = await assertSafeDirectory(parentInput);
  const name = safeName(nameInput);
  const target = await assertDestinationAbsent(path.join(parent, name));
  if (!body) throw new LocalApiError(400, "Upload body is empty");
  if (expectedSize != null && expectedSize > MAX_UPLOAD_BYTES) throw new LocalApiError(413, "The uploaded file exceeds the configured size limit");

  const temporary = path.join(parent, `.${name}.wfilemanager-${crypto.randomUUID()}.part`);
  let written = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > MAX_UPLOAD_BYTES) throw new LocalApiError(413, "The uploaded file exceeds the configured size limit");
      controller.enqueue(chunk);
    },
  });

  try {
    const limited = body.pipeThrough(limiter);
    await pipeline(Readable.fromWeb(limited as never), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    await commitTemporaryFile(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return uploadedEntry(parent, name);
}

export function saveRawUpload(parent: unknown, name: unknown, body: ReadableStream<Uint8Array> | null) {
  return streamUpload(parent, name, body);
}

export async function saveUploads(parentInput: unknown, formData: FormData) {
  const uploaded: LocalFileEntry[] = [];
  for (const value of formData.getAll("files")) {
    if (!(value instanceof File)) continue;
    uploaded.push(await streamUpload(parentInput, value.name, value.stream() as ReadableStream<Uint8Array>, value.size));
  }
  if (!uploaded.length) throw new LocalApiError(400, "No files were uploaded");
  return { uploaded };
}
