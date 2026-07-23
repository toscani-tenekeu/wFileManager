import path from "node:path";
import { execFile } from "node:child_process";
import { stat, statfs } from "node:fs/promises";
import { promisify } from "node:util";
import { LocalApiError } from "@/lib/server/local-runtime";

const execFileAsync = promisify(execFile);
const MAX_ENTRIES = Math.max(100, Number(process.env.WFILEMANAGER_ARCHIVE_MAX_ENTRIES || 50_000));
const MAX_EXPANDED_BYTES = Math.max(100 * 1024 * 1024, Number(process.env.WFILEMANAGER_ARCHIVE_MAX_EXPANDED_BYTES || 20 * 1024 * 1024 * 1024));
const MAX_COMPRESSION_RATIO = Math.max(10, Number(process.env.WFILEMANAGER_ARCHIVE_MAX_RATIO || 200));

const SCRIPT = String.raw`
import json, os, sys, tarfile, zipfile
filename = sys.argv[1]
entries = 0
expanded = 0
compressed = 0
lower = filename.lower()
if lower.endswith('.zip'):
    with zipfile.ZipFile(filename, 'r') as archive:
        for info in archive.infolist():
            entries += 1
            expanded += int(info.file_size or 0)
            compressed += int(info.compress_size or 0)
elif lower.endswith('.tar.gz') or lower.endswith('.tgz'):
    with tarfile.open(filename, 'r:gz') as archive:
        for member in archive.getmembers():
            entries += 1
            if member.isfile():
                expanded += int(member.size or 0)
    compressed = os.path.getsize(filename)
else:
    raise RuntimeError('Only ZIP and TAR.GZ archives are supported')
print(json.dumps({'entries': entries, 'expandedBytes': expanded, 'compressedBytes': compressed}, separators=(',', ':')))
`;

export interface ArchiveSafety {
  entries: number;
  expandedBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  availableBytes: number;
}

export async function inspectArchiveSafety(archiveInput: unknown, destinationInput?: unknown): Promise<ArchiveSafety> {
  if (typeof archiveInput !== "string" || !path.isAbsolute(archiveInput)) throw new LocalApiError(400, "A valid archive path is required");
  const archivePath = path.resolve(archiveInput);
  const archiveInfo = await stat(archivePath).catch(() => null);
  if (!archiveInfo?.isFile()) throw new LocalApiError(404, "Archive file not found");

  const { stdout } = await execFileAsync("python3", ["-c", SCRIPT, archivePath], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  const value = JSON.parse(stdout) as { entries: number; expandedBytes: number; compressedBytes: number };
  const compressedBytes = Math.max(1, Number(value.compressedBytes) || archiveInfo.size || 1);
  const expandedBytes = Math.max(0, Number(value.expandedBytes) || 0);
  const entries = Math.max(0, Number(value.entries) || 0);
  const compressionRatio = expandedBytes / compressedBytes;

  if (entries > MAX_ENTRIES) throw new LocalApiError(413, `Archive contains ${entries.toLocaleString()} entries; the limit is ${MAX_ENTRIES.toLocaleString()}`);
  if (expandedBytes > MAX_EXPANDED_BYTES) throw new LocalApiError(413, "Archive expands beyond the configured extraction limit");
  if (compressionRatio > MAX_COMPRESSION_RATIO && expandedBytes > 100 * 1024 * 1024) {
    throw new LocalApiError(413, "Archive compression ratio is unsafe");
  }

  const destination = typeof destinationInput === "string" && destinationInput
    ? path.resolve(destinationInput)
    : path.dirname(archivePath);
  const filesystem = await statfs(destination);
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  const reserve = Math.max(128 * 1024 * 1024, Math.floor(availableBytes * 0.05));
  if (expandedBytes > Math.max(0, availableBytes - reserve)) {
    throw new LocalApiError(507, "The destination does not have enough free space to extract this archive safely");
  }

  return { entries, expandedBytes, compressedBytes, compressionRatio, availableBytes };
}
