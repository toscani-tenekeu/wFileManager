#!/usr/bin/env bash
set -Eeuo pipefail

cd /root

VERSION="0.6.10"
WORKDIR="$(mktemp -d)"
SOURCE="$WORKDIR/wFileManager"
TARGET="/opt/wfilemanager/releases/$VERSION"
PREVIOUS="$(readlink -f /opt/wfilemanager/current 2>/dev/null || true)"

cleanup() {
  rm -rf -- "$WORKDIR"
}
trap cleanup EXIT

echo "==> Cloning current source"
git clone --depth 1 https://github.com/toscani-tenekeu/wFileManager.git "$SOURCE"
cd "$SOURCE"

git config user.name "toscani-tenekeu"
git config user.email "hello@toscani-tenekeu.com"

cat > src/lib/server/archive-runtime-v2.ts <<'TS'
import path from "node:path";
import { execFile } from "node:child_process";
import { lstat, stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ARCHIVE_TIMEOUT_MS = Math.max(60_000, Number(process.env.WFILEMANAGER_ARCHIVE_TIMEOUT_MS || 3_600_000));
const INSPECT_TIMEOUT_MS = Math.max(10_000, Number(process.env.WFILEMANAGER_ARCHIVE_INSPECT_TIMEOUT_MS || 120_000));

export type ArchiveFormat = "zip" | "tar.gz";
export type ExtractionMode = "current" | "folder" | "custom";
export type ConflictPolicy = "error" | "rename" | "overwrite";

export interface ArchiveTopLevelItem {
  name: string;
  kind: "file" | "directory";
}

export interface ArchiveInspection {
  path: string;
  format: ArchiveFormat;
  entries: number;
  topLevelEntries: string[];
  topLevelItems: ArchiveTopLevelItem[];
  multipleTopLevel: boolean;
  suggestedFolder: string;
  destinationParent: string;
  defaultConflicts: string[];
}

const PYTHON_ARCHIVE = String.raw`
import json
import os
import pathlib
import shutil
import stat
import sys
import tarfile
import zipfile


def fail(message):
    raise RuntimeError(message)


def safe_member_name(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        fail("Archive contains an invalid entry name")
    value = value.replace("\\", "/")
    pure = pathlib.PurePosixPath(value)
    if pure.is_absolute():
        fail("Archive contains an absolute path")
    parts = [part for part in pure.parts if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        fail("Archive contains an unsafe path")
    return "/".join(parts)


def safe_target(root, member_name):
    root_real = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root_real, *member_name.split("/")))
    if target != root_real and not target.startswith(root_real + os.sep):
        fail("Archive entry escapes the extraction directory")
    return target


def archive_format(filename):
    lowered = filename.lower()
    if lowered.endswith(".zip"):
        return "zip"
    if lowered.endswith(".tar.gz") or lowered.endswith(".tgz"):
        return "tar.gz"
    fail("Only ZIP and TAR.GZ archives are supported")


def inspect_zip(filename):
    records = []
    with zipfile.ZipFile(filename, "r") as archive:
        for info in archive.infolist():
            name = safe_member_name(info.filename)
            unix_mode = (info.external_attr >> 16) & 0o170000
            if unix_mode == stat.S_IFLNK:
                fail("ZIP archives containing symbolic links are not supported")
            kind = "directory" if info.is_dir() or info.filename.endswith("/") else "file"
            records.append({"name": name, "kind": kind})
    return records


def inspect_tar(filename):
    records = []
    with tarfile.open(filename, "r:gz") as archive:
        for member in archive.getmembers():
            name = safe_member_name(member.name)
            if member.issym() or member.islnk() or member.isdev():
                fail("TAR.GZ archives containing links or device entries are not supported")
            if not (member.isfile() or member.isdir()):
                fail("TAR.GZ archive contains an unsupported entry type")
            records.append({"name": name, "kind": "directory" if member.isdir() else "file"})
    return records


def inspect(filename):
    fmt = archive_format(filename)
    records = inspect_zip(filename) if fmt == "zip" else inspect_tar(filename)
    top = {}
    for record in records:
        name = record["name"]
        root = name.split("/", 1)[0]
        kind = "directory" if "/" in name or record["kind"] == "directory" else "file"
        if root not in top or kind == "directory":
            top[root] = kind
    items = [{"name": name, "kind": top[name]} for name in sorted(top)]
    return {"format": fmt, "entries": len(records), "topLevelItems": items}


def create_zip(source, target):
    skipped = 0
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        if os.path.isfile(source):
            archive.write(source, os.path.basename(source))
            return skipped
        for current, directories, files in os.walk(source, topdown=True, followlinks=False):
            kept = []
            for directory in directories:
                full = os.path.join(current, directory)
                if os.path.islink(full):
                    skipped += 1
                else:
                    kept.append(directory)
            directories[:] = kept
            relative = os.path.relpath(current, os.path.dirname(source)).replace(os.sep, "/")
            if not files and not directories:
                archive.writestr(relative.rstrip("/") + "/", b"")
            for filename in files:
                full = os.path.join(current, filename)
                if os.path.islink(full):
                    skipped += 1
                    continue
                arcname = os.path.relpath(full, os.path.dirname(source)).replace(os.sep, "/")
                archive.write(full, arcname)
    return skipped


def create_tar(source, target):
    skipped = [0]
    base = os.path.basename(source.rstrip(os.sep))
    def filtered(info):
        if info.issym() or info.islnk() or info.isdev():
            skipped[0] += 1
            return None
        info.uid = 0
        info.gid = 0
        info.uname = ""
        info.gname = ""
        return info
    with tarfile.open(target, "w:gz") as archive:
        archive.add(source, arcname=base, recursive=True, filter=filtered)
    return skipped[0]


def create_archive(source, target, fmt):
    if os.path.islink(source) or not (os.path.isfile(source) or os.path.isdir(source)):
        fail("Only regular files and directories can be compressed")
    if os.path.lexists(target):
        fail("Archive destination already exists")
    skipped = create_zip(source, target) if fmt == "zip" else create_tar(source, target)
    return {"path": target, "format": fmt, "skippedLinks": skipped}


def remove_existing(target):
    if os.path.islink(target) or os.path.isfile(target):
        os.unlink(target)
    elif os.path.isdir(target):
        shutil.rmtree(target)


def numbered_name(name, kind, index):
    if kind == "directory":
        return f"{name} ({index})"
    stem, suffix = os.path.splitext(name)
    return f"{stem} ({index}){suffix}" if stem else f"{name} ({index})"


def root_mapping(destination, items, policy):
    mapping = {item["name"]: item["name"] for item in items}
    conflicts = [item for item in items if os.path.lexists(os.path.join(destination, item["name"]))]
    if conflicts and policy == "error":
        fail("Extraction conflicts with existing items: " + ", ".join(item["name"] for item in conflicts[:8]))
    if policy == "overwrite":
        for item in conflicts:
            remove_existing(os.path.join(destination, item["name"]))
    elif policy == "rename":
        reserved = {item["name"] for item in items}
        for item in conflicts:
            for index in range(1, 10000):
                candidate = numbered_name(item["name"], item["kind"], index)
                if candidate not in reserved and not os.path.lexists(os.path.join(destination, candidate)):
                    mapping[item["name"]] = candidate
                    reserved.add(candidate)
                    break
            else:
                fail("Unable to find an available extraction name")
    return mapping, [item["name"] for item in conflicts]


def mapped_name(name, mapping):
    parts = name.split("/", 1)
    root = mapping.get(parts[0], parts[0])
    return root if len(parts) == 1 else root + "/" + parts[1]


def prepare_destination(destination, destination_is_new, policy):
    if destination_is_new:
        if os.path.lexists(destination):
            if policy == "overwrite":
                remove_existing(destination)
            else:
                fail("Extraction folder already exists")
        os.makedirs(destination, mode=0o755)
    elif not os.path.isdir(destination):
        fail("Extraction destination must be an existing directory")


def extract_zip(filename, destination, records, mapping):
    with zipfile.ZipFile(filename, "r") as archive:
        for info, record in zip(archive.infolist(), records):
            name = mapped_name(record["name"], mapping)
            target = safe_target(destination, name)
            if record["kind"] == "directory":
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with archive.open(info, "r") as source, open(target, "xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            mode = (info.external_attr >> 16) & 0o777
            if mode:
                os.chmod(target, mode)


def extract_tar(filename, destination, records, mapping):
    with tarfile.open(filename, "r:gz") as archive:
        members = archive.getmembers()
        for member, record in zip(members, records):
            name = mapped_name(record["name"], mapping)
            target = safe_target(destination, name)
            if record["kind"] == "directory":
                os.makedirs(target, exist_ok=True)
                os.chmod(target, member.mode & 0o777)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                fail("Unable to read an archive entry")
            with source, open(target, "xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            os.chmod(target, member.mode & 0o777)


def extract_archive(filename, destination, destination_is_new, policy):
    result = inspect(filename)
    records = inspect_zip(filename) if result["format"] == "zip" else inspect_tar(filename)
    prepare_destination(destination, destination_is_new, policy)
    mapping, conflicts = root_mapping(destination, result["topLevelItems"], policy)
    try:
        if result["format"] == "zip":
            extract_zip(filename, destination, records, mapping)
        else:
            extract_tar(filename, destination, records, mapping)
    except Exception:
        if destination_is_new:
            shutil.rmtree(destination, ignore_errors=True)
        raise
    return {
        "archive": filename,
        "format": result["format"],
        "extractedTo": destination,
        "entries": result["entries"],
        "topLevelEntries": [mapping.get(item["name"], item["name"]) for item in result["topLevelItems"]],
        "renamedTopLevel": mapping,
        "conflicts": conflicts,
    }


action = sys.argv[1]
if action == "inspect":
    output = inspect(sys.argv[2])
elif action == "create":
    output = create_archive(sys.argv[2], sys.argv[3], sys.argv[4])
elif action == "extract":
    output = extract_archive(sys.argv[2], sys.argv[3], sys.argv[4] == "1", sys.argv[5])
else:
    fail("Unknown archive action")
print(json.dumps(output, separators=(",", ":")))
`;

function normalizeAbsolutePath(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error("A valid absolute path is required");
  if (!path.isAbsolute(value)) throw new Error("Archive paths must be absolute");
  return path.resolve(value);
}

function folderNameFromArchive(value: string) {
  return path.basename(value).replace(/\.tar\.gz$/i, "").replace(/\.tgz$/i, "").replace(/\.zip$/i, "") || "extracted";
}

function safeFolderName(value: unknown, fallback: string) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!candidate || candidate === "." || candidate === ".." || candidate.includes("/") || candidate.includes("\\") || candidate.includes("\0")) throw new Error("Extraction folder name is invalid");
  return candidate;
}

async function uniquePath(parent: string, base: string, suffix = "") {
  for (let index = 0; index < 10_000; index += 1) {
    const name = index === 0 ? `${base}${suffix}` : `${base} (${index})${suffix}`;
    const candidate = path.join(parent, name);
    if (!await lstat(candidate).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error("Unable to find an available destination name");
}

async function runPython<T>(args: string[], timeout: number): Promise<T> {
  try {
    const { stdout } = await execFileAsync("python3", ["-c", PYTHON_ARCHIVE, ...args], {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    return JSON.parse(stdout.trim()) as T;
  } catch (cause: any) {
    const raw = typeof cause?.stderr === "string" && cause.stderr.trim() ? cause.stderr.trim().split("\n").at(-1) : cause?.message;
    throw new Error(String(raw || "Archive operation failed").replace(/^RuntimeError:\s*/, ""));
  }
}

export async function inspectArchive(inputPath: unknown): Promise<ArchiveInspection> {
  const archivePath = normalizeAbsolutePath(inputPath);
  const info = await lstat(archivePath).catch(() => null);
  if (!info?.isFile()) throw new Error("Archive file not found");
  const result = await runPython<{ format: ArchiveFormat; entries: number; topLevelItems: ArchiveTopLevelItem[] }>(["inspect", archivePath], INSPECT_TIMEOUT_MS);
  const destinationParent = path.dirname(archivePath);
  const defaultConflicts: string[] = [];
  for (const item of result.topLevelItems) {
    if (await lstat(path.join(destinationParent, item.name)).then(() => true).catch(() => false)) defaultConflicts.push(item.name);
  }
  return {
    path: archivePath,
    format: result.format,
    entries: result.entries,
    topLevelEntries: result.topLevelItems.map((item) => item.name),
    topLevelItems: result.topLevelItems,
    multipleTopLevel: result.topLevelItems.length > 1,
    suggestedFolder: folderNameFromArchive(archivePath),
    destinationParent,
    defaultConflicts,
  };
}

export async function createArchive(inputPath: unknown, formatInput: unknown) {
  const source = normalizeAbsolutePath(inputPath);
  const format = formatInput === "zip" ? "zip" : formatInput === "tar.gz" ? "tar.gz" : null;
  if (!format) throw new Error("Archive format must be zip or tar.gz");
  const info = await lstat(source).catch(() => null);
  if (!info || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error("Only regular files and directories can be compressed");
  const suffix = format === "zip" ? ".zip" : ".tar.gz";
  const target = await uniquePath(path.dirname(source), path.basename(source), suffix);
  return runPython<{ path: string; format: ArchiveFormat; skippedLinks: number }>(["create", source, target, format], ARCHIVE_TIMEOUT_MS);
}

export async function extractArchive(
  inputPath: unknown,
  modeInput: unknown,
  folderNameInput?: unknown,
  destinationInput?: unknown,
  conflictPolicyInput?: unknown,
) {
  const archivePath = normalizeAbsolutePath(inputPath);
  const inspection = await inspectArchive(archivePath);
  const mode: ExtractionMode = modeInput === "current" || modeInput === "folder" || modeInput === "custom" ? modeInput : (() => { throw new Error("Extraction mode is invalid"); })();
  const conflictPolicy: ConflictPolicy = conflictPolicyInput === "overwrite" || conflictPolicyInput === "error" || conflictPolicyInput === "rename" ? conflictPolicyInput : "rename";
  const parent = path.dirname(archivePath);
  let destination = parent;
  let destinationIsNew = false;
  if (mode === "folder") {
    const folderName = safeFolderName(folderNameInput, inspection.suggestedFolder);
    destination = conflictPolicy === "rename" ? await uniquePath(parent, folderName) : path.join(parent, folderName);
    destinationIsNew = true;
  } else if (mode === "custom") {
    destination = normalizeAbsolutePath(destinationInput);
    const destinationInfo = await stat(destination).catch(() => null);
    if (!destinationInfo?.isDirectory()) throw new Error("The selected extraction destination does not exist or is not a directory");
  }
  const result = await runPython<{
    archive: string;
    format: ArchiveFormat;
    extractedTo: string;
    entries: number;
    topLevelEntries: string[];
    renamedTopLevel: Record<string, string>;
    conflicts: string[];
  }>(["extract", archivePath, destination, destinationIsNew ? "1" : "0", conflictPolicy], ARCHIVE_TIMEOUT_MS);
  return { ...result, mode, conflictPolicy };
}
TS

cat > src/lib/archive-api.ts <<'TS'
import { wfilemanagerApi } from "./wfilemanager-api";

export type ArchiveFormat = "zip" | "tar.gz";
export type ExtractionMode = "current" | "folder" | "custom";
export type ConflictPolicy = "error" | "rename" | "overwrite";

export interface ArchiveTopLevelItem {
  name: string;
  kind: "file" | "directory";
}

export interface ArchiveInspection {
  path: string;
  format: ArchiveFormat;
  entries: number;
  topLevelEntries: string[];
  topLevelItems: ArchiveTopLevelItem[];
  multipleTopLevel: boolean;
  suggestedFolder: string;
  destinationParent: string;
  defaultConflicts: string[];
}

export interface ArchiveCreationResult {
  path: string;
  format: ArchiveFormat;
  skippedLinks: number;
}

export interface ArchiveExtractionResult {
  archive: string;
  format: ArchiveFormat;
  extractedTo: string;
  entries: number;
  topLevelEntries: string[];
  renamedTopLevel: Record<string, string>;
  conflicts: string[];
  mode: ExtractionMode;
  conflictPolicy: ConflictPolicy;
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Archive request failed (${response.status})`);
  return payload as T;
}

function headers(json = false): HeadersInit {
  const token = wfilemanagerApi.getToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const archiveApi = {
  inspect: (path: string) => {
    const query = new URLSearchParams({ action: "archive-inspect", path });
    return fetch(`/api/local?${query}`, { headers: headers(), cache: "no-store" }).then(parse<ArchiveInspection>);
  },
  create: (path: string, format: ArchiveFormat) => fetch("/api/local?action=archive-create", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ path, format }),
  }).then(parse<ArchiveCreationResult>),
  extract: (path: string, options: {
    mode: ExtractionMode;
    folderName?: string;
    destination?: string;
    conflictPolicy?: ConflictPolicy;
  }) => fetch("/api/local?action=archive-extract", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ path, ...options }),
  }).then(parse<ArchiveExtractionResult>),
};
TS

python3 <<'PY'
from pathlib import Path
import json
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Unable to patch {label}")
    return text.replace(old, new, 1)

api = Path("src/routes/api.local.ts")
text = api.read_text()
text = replace_once(text, 'return import("@/lib/server/archive-runtime");', 'return import("@/lib/server/archive-runtime-v2");', "archive runtime import")
text = replace_once(text, 'return json(await archive.extractArchive(body.path, body.mode, body.folderName), 201);', 'return json(await archive.extractArchive(body.path, body.mode, body.folderName, body.destination, body.conflictPolicy), 201);', "archive extraction API")
api.write_text(text)

explorer = Path("src/routes/_app.explorer.tsx")
text = explorer.read_text()
text = replace_once(
    text,
    'import { archiveApi, type ArchiveFormat, type ArchiveInspection } from "@/lib/archive-api";',
    'import { archiveApi, type ArchiveFormat, type ArchiveInspection, type ConflictPolicy, type ExtractionMode } from "@/lib/archive-api";',
    "archive API imports",
)
text = replace_once(
    text,
    '  const [archiveBusy, setArchiveBusy] = useState(false);',
    '  const [archiveBusy, setArchiveBusy] = useState(false);\n  const [extractDestination, setExtractDestination] = useState("");\n  const [extractFolderName, setExtractFolderName] = useState("");\n  const [extractConflictPolicy, setExtractConflictPolicy] = useState<ConflictPolicy>("rename");',
    "archive state",
)

new_extract = r'''  const extractArchive = async (entry: LocalFileEntry) => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    setOperationProgress({ label: `Inspecting ${entry.name}`, percent: 15, detail: "Checking archive safety and destination" });
    try {
      const inspection = await archiveApi.inspect(entry.path);
      setOperationProgress(null);
      if (inspection.multipleTopLevel || inspection.defaultConflicts.length > 0) {
        setExtractDestination(inspection.destinationParent);
        setExtractFolderName(inspection.suggestedFolder);
        setExtractConflictPolicy("rename");
        setExtractPlan({ entry, inspection });
      } else {
        setOperationProgress({ label: `Extracting ${entry.name}`, percent: 35, detail: `Into ${inspection.destinationParent}` });
        const result = await archiveApi.extract(entry.path, { mode: "current", conflictPolicy: "error" });
        setOperationProgress({ label: `Extracting ${entry.name}`, percent: 100, detail: result.extractedTo });
        toast.success(`${entry.name} extracted into ${result.extractedTo}`);
        await load();
      }
    } catch (cause) {
      setOperationProgress(null);
      toast.error(cause instanceof Error ? cause.message : "Archive extraction failed");
    } finally {
      window.setTimeout(() => setOperationProgress(null), 650);
      setArchiveBusy(false);
    }
  };

  const confirmExtraction = async (mode: ExtractionMode) => {
    if (!extractPlan || archiveBusy) return;
    const plan = extractPlan;
    setExtractPlan(null);
    setArchiveBusy(true);
    const detail = mode === "folder"
      ? `Into ${extractFolderName || plan.inspection.suggestedFolder}`
      : mode === "custom"
        ? `Into ${extractDestination}`
        : `Into ${plan.inspection.destinationParent}`;
    setOperationProgress({ label: `Extracting ${plan.entry.name}`, percent: 35, detail });
    try {
      const result = await archiveApi.extract(plan.entry.path, {
        mode,
        folderName: mode === "folder" ? extractFolderName || plan.inspection.suggestedFolder : undefined,
        destination: mode === "custom" ? extractDestination : undefined,
        conflictPolicy: extractConflictPolicy,
      });
      setOperationProgress({ label: `Extracting ${plan.entry.name}`, percent: 100, detail: result.extractedTo });
      const renamed = Object.entries(result.renamedTopLevel).filter(([from, to]) => from !== to);
      toast.success(`${plan.entry.name} extracted into ${result.extractedTo}${renamed.length ? ` · ${renamed.length} conflict(s) renamed` : ""}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Archive extraction failed");
    } finally {
      window.setTimeout(() => setOperationProgress(null), 650);
      setArchiveBusy(false);
    }
  };

  const openRename'''
text, count = re.subn(r'  const extractArchive = async \(entry: LocalFileEntry\) => \{.*?\n  const openRename', new_extract, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Unable to replace extraction workflow")

text = text.replace(
    '{entry.kind === "directory" && <DropdownMenuItem onClick={() => void createArchive',
    '{(entry.kind === "directory" || entry.kind === "file") && <DropdownMenuItem onClick={() => void createArchive',
)
text = text.replace(
    '{entry.kind === "directory" && <ContextMenuItem onClick={() => void createArchive',
    '{(entry.kind === "directory" || entry.kind === "file") && <ContextMenuItem onClick={() => void createArchive',
)
text = text.replace(
    '`Move ${selectedEntries.length} selected items to trash`',
    '`Delete all selected (${selectedEntries.length})`',
)

text, count = re.subn(
    r'\n        \{selectedEntries\.length > 0 && \(\n          <div className="mt-2.*?\n        \)\}\n',
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Unable to remove the multiple-selection toolbar")

new_dialog = r'''
      <Dialog open={Boolean(extractPlan)} onOpenChange={(open) => !open && setExtractPlan(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Archive extraction options</DialogTitle>
            <DialogDescription>
              Choose how and where <span className="font-mono">{extractPlan?.entry.name}</span> should be extracted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {extractPlan?.inspection.multipleTopLevel && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">This archive has several items at its first level.</p>
                <p className="mt-1 text-muted-foreground">Extracting here will place all of them directly in the destination directory.</p>
              </div>
            )}

            {(extractPlan?.inspection.defaultConflicts.length || 0) > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">Existing destination items detected</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{extractPlan?.inspection.defaultConflicts.join(", ")}</p>
              </div>
            )}

            <div className="max-h-28 overflow-y-auto rounded-md border border-border bg-muted/25 p-2 font-mono text-xs">
              {extractPlan?.inspection.topLevelItems.slice(0, 20).map((item) => <div key={item.name}>{item.kind === "directory" ? "folder" : "file"} · {item.name}</div>)}
              {(extractPlan?.inspection.topLevelItems.length || 0) > 20 && <div>…and {(extractPlan?.inspection.topLevelItems.length || 0) - 20} more</div>}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">When an item already exists</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={extractConflictPolicy === "rename" ? "secondary" : "outline"} onClick={() => setExtractConflictPolicy("rename")}>Keep both · use (1), (2)…</Button>
                <Button type="button" size="sm" variant={extractConflictPolicy === "overwrite" ? "destructive" : "outline"} onClick={() => setExtractConflictPolicy("overwrite")}>Replace existing</Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">New folder name</label>
                <Input value={extractFolderName} onChange={(event) => setExtractFolderName(event.target.value)} className="font-mono" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">Custom destination</label>
                <Input value={extractDestination} onChange={(event) => setExtractDestination(event.target.value)} className="font-mono" />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-wrap gap-2 sm:justify-end">
            <Button variant="ghost" onClick={() => setExtractPlan(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => void confirmExtraction("current")}>Extract here</Button>
            <Button variant="outline" onClick={() => void confirmExtraction("folder")}>Extract into new folder</Button>
            <Button onClick={() => void confirmExtraction("custom")}>Extract to destination</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>'''
text, count = re.subn(r'\n      <AlertDialog open=\{Boolean\(extractPlan\)\}.*?\n      </AlertDialog>', new_dialog, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Unable to replace the extraction dialog")

explorer.write_text(text)

storage = Path("src/lib/server/storage-analysis.ts")
text = storage.read_text()
old = r'"-printf", "%y\t%s\t%p\0",'
new = r'"-printf", "%y\\t%s\\t%p\\0",'
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("Unable to patch the storage scan null-byte bug")
storage.write_text(text)

package = Path("package.json")
data = json.loads(package.read_text())
data["version"] = "0.6.10"
package.write_text(json.dumps(data, indent=2) + "\n")

for filename, pattern, replacement in [
    ("src/lib/demo/data.ts", r'wfmVersion: "[0-9]+\.[0-9]+\.[0-9]+"', 'wfmVersion: "0.6.10"'),
    ("src/lib/server/local-runtime.ts", r'WFILEMANAGER_VERSION \|\| "[0-9]+\.[0-9]+\.[0-9]+"', 'WFILEMANAGER_VERSION || "0.6.10"'),
]:
    file = Path(filename)
    value, count = re.subn(pattern, replacement, file.read_text(), count=1)
    if count != 1:
        raise SystemExit(f"Unable to update version in {filename}")
    file.write_text(value)
PY

echo "==> Installing dependencies and building"
bun install --frozen-lockfile
bun run typecheck
bun run build

echo "==> Running focused archive test"
TEST_ROOT="$(mktemp -d)"
mkdir -p "$TEST_ROOT/a"
printf 'archive test\n' > "$TEST_ROOT/a/file.txt"
printf 'single file\n' > "$TEST_ROOT/single.txt"
TEST_ROOT="$TEST_ROOT" bun -e '
import { readFile } from "node:fs/promises";
import { createArchive, inspectArchive, extractArchive } from "./src/lib/server/archive-runtime-v2.ts";
const root = process.env.TEST_ROOT!;
for (const format of ["zip", "tar.gz"] as const) {
  const fileArchive = await createArchive(`${root}/single.txt`, format);
  const fileInspection = await inspectArchive(fileArchive.path);
  if (fileInspection.topLevelEntries[0] !== "single.txt") throw new Error(`${format} file compression failed`);
}
const archive = await createArchive(`${root}/a`, "zip");
const inspection = await inspectArchive(archive.path);
if (!inspection.defaultConflicts.includes("a")) throw new Error("Existing-folder conflict was not detected");
const extracted = await extractArchive(archive.path, "current", undefined, undefined, "rename");
if (extracted.renamedTopLevel.a !== "a (1)") throw new Error("Conflict rename did not use (1)");
const content = await readFile(`${root}/a (1)/file.txt`, "utf8");
if (content !== "archive test\n") throw new Error("Renamed extraction content mismatch");
console.log("Archive behavior: OK");
'
rm -rf -- "$TEST_ROOT"

echo "==> Committing corrected implementation"
git add -A
git commit -m "Fix explorer selection and archive extraction behavior"
git push origin main

echo "==> Installing local release $VERSION"
rm -rf -- "$TARGET"
rm -rf -- .git
mkdir -p /opt/wfilemanager/releases
mv "$SOURCE" "$TARGET"
chown -R root:root "$TARGET"

ln -sfn "$TARGET" /opt/wfilemanager/current.next
mv -Tf /opt/wfilemanager/current.next /opt/wfilemanager/current

if ! systemctl restart wfilemanager.service; then
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" /opt/wfilemanager/current.next
    mv -Tf /opt/wfilemanager/current.next /opt/wfilemanager/current
    systemctl restart wfilemanager.service || true
  fi
  journalctl -u wfilemanager.service -n 120 --no-pager
  exit 1
fi

systemctl is-active --quiet wfilemanager.service
curl -fsS --max-time 20 http://127.0.0.1:1973/ >/dev/null

echo
echo "wFileManager $VERSION installed successfully."
echo "Selection toolbar removed."
echo "Files and folders can be compressed."
echo "Extraction destination and conflict handling corrected."
