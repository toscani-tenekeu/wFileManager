import crypto from "node:crypto";
import path from "node:path";
import { chmod, open, rename, rm, stat } from "node:fs/promises";
import { LocalApiError, readTextFile } from "@/lib/server/local-runtime";
import { assertSafeExistingMutation } from "@/lib/server/safe-path-runtime";

const MAX_TEXT_BYTES = Number(process.env.WFILEMANAGER_MAX_TEXT_BYTES || 5 * 1024 * 1024);

export async function saveTextFileAtomic(
  inputPath: unknown,
  content: unknown,
  expectedModifiedAt?: unknown,
) {
  if (typeof content !== "string") throw new LocalApiError(400, "File content must be text");
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES)
    throw new LocalApiError(413, "Content is too large");

  const target = await assertSafeExistingMutation(inputPath);
  const current = await stat(target);
  if (!current.isFile()) throw new LocalApiError(400, "The selected path is not a regular file");

  if (typeof expectedModifiedAt === "string" && expectedModifiedAt) {
    const expected = new Date(expectedModifiedAt).getTime();
    if (!Number.isFinite(expected) || Math.abs(current.mtimeMs - expected) > 1) {
      throw new LocalApiError(
        409,
        "The file changed after it was opened. Reload it before saving to avoid overwriting another change.",
      );
    }
  }

  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.wfilemanager-${crypto.randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporary, current.mode & 0o7777);
    await rename(temporary, target);

    const directory = await open(path.dirname(target), "r").catch(() => null);
    if (directory) {
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  return readTextFile(target);
}
