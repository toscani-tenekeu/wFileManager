import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { LocalApiError } from "@/lib/server/local-runtime";
import { assertSafeExistingMutation } from "@/lib/server/safe-path-runtime";

export async function fileIntegrityHash(inputPath: unknown, algorithmInput: unknown) {
  const target = await assertSafeExistingMutation(inputPath);
  const info = await stat(target);
  if (!info.isFile())
    throw new LocalApiError(400, "Integrity hashes are available only for regular files");
  const algorithm = String(algorithmInput || "sha256").toLowerCase();
  if (algorithm !== "sha256" && algorithm !== "sha512")
    throw new LocalApiError(400, "Unsupported integrity algorithm");
  const digest = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { path: target, algorithm, checksum: digest.digest("hex"), size: info.size };
}
