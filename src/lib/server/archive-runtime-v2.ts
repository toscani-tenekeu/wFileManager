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
