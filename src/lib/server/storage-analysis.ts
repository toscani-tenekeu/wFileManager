import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = Math.max(30_000, Number(process.env.WFILEMANAGER_STORAGE_ANALYSIS_CACHE_MS || 300_000));
const SCAN_TIMEOUT_MS = Math.max(30_000, Number(process.env.WFILEMANAGER_STORAGE_ANALYSIS_TIMEOUT_MS || 180_000));
const MIN_REAL_UID = Math.max(0, Number(process.env.WFILEMANAGER_MIN_REAL_UID || 1000));

export interface FileTypeSummary {
  type: string;
  count: number;
  bytes: number;
}

export interface FileCategorySummary {
  category: string;
  count: number;
  bytes: number;
}

export interface HomeUsageSummary {
  username: string;
  uid: number;
  path: string;
  bytes: number;
}

export interface StorageAnalysis {
  generatedAt: string;
  root: string;
  totalFiles: number;
  totalDirectories: number;
  totalSymlinks: number;
  totalOther: number;
  totalItems: number;
  totalFileBytes: number;
  fileTypes: FileTypeSummary[];
  categories: FileCategorySummary[];
  homeUsage: HomeUsageSummary[];
}

const CATEGORY_EXTENSIONS: Record<string, Set<string>> = {
  Images: new Set(["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]),
  Videos: new Set(["avi", "flv", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm", "wmv"]),
  Audio: new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]),
  Documents: new Set(["csv", "doc", "docx", "epub", "md", "odf", "ods", "odt", "pdf", "ppt", "pptx", "rtf", "txt", "xls", "xlsx"]),
  Archives: new Set(["7z", "bz2", "deb", "gz", "iso", "rar", "rpm", "tar", "tgz", "xz", "zip", "zst"]),
  Code: new Set(["c", "cc", "cpp", "cs", "css", "go", "h", "hpp", "html", "java", "js", "jsx", "kt", "lua", "php", "py", "rb", "rs", "scss", "sh", "sql", "svelte", "swift", "ts", "tsx", "vue"]),
  Data: new Set(["conf", "ini", "json", "log", "toml", "xml", "yaml", "yml"]),
  Executables: new Set(["appimage", "bin", "dll", "exe", "msi", "so"]),
};

const COMPOUND_EXTENSIONS = ["tar.gz", "tar.bz2", "tar.xz", "tar.zst"];

function extensionFor(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  for (const extension of COMPOUND_EXTENSIONS) {
    if (name.endsWith(`.${extension}`)) return `.${extension}`;
  }
  const extension = path.extname(name).slice(1);
  return extension ? `.${extension}` : "No extension";
}

function categoryFor(type: string) {
  const extension = type.startsWith(".") ? type.slice(1).split(".").at(-1) || "" : "";
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(extension)) return category;
  }
  return "Other";
}

function updateSummary<T extends { count: number; bytes: number }>(map: Map<string, T>, key: string, bytes: number) {
  const current = map.get(key);
  if (current) {
    current.count += 1;
    current.bytes += bytes;
    return;
  }
  map.set(key, { count: 1, bytes } as T);
}

async function scanRootFilesystem() {
  const fileTypes = new Map<string, { count: number; bytes: number }>();
  const categories = new Map<string, { count: number; bytes: number }>();
  let totalFiles = 0;
  let totalDirectories = 0;
  let totalSymlinks = 0;
  let totalOther = 0;
  let totalFileBytes = 0;

  const args = [
    "/",
    "-xdev",
    "(",
    "-path", "/proc",
    "-o", "-path", "/sys",
    "-o", "-path", "/dev",
    "-o", "-path", "/run",
    "-o", "-path", "/var/lib/wfilemanager/trash",
    ")",
    "-prune",
    "-o",
    "-printf", "%y\t%s\t%p\0",
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("find", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let pending = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const consume = (chunk: string) => {
      pending += chunk;
      const records = pending.split("\0");
      pending = records.pop() || "";
      for (const record of records) {
        if (!record) continue;
        const firstTab = record.indexOf("\t");
        const secondTab = record.indexOf("\t", firstTab + 1);
        if (firstTab < 0 || secondTab < 0) continue;
        const kind = record.slice(0, firstTab);
        const size = Math.max(0, Number(record.slice(firstTab + 1, secondTab)) || 0);
        const filePath = record.slice(secondTab + 1);
        if (filePath === "/") continue;

        if (kind === "f") {
          totalFiles += 1;
          totalFileBytes += size;
          const type = extensionFor(filePath);
          updateSummary(fileTypes, type, size);
          updateSummary(categories, categoryFor(type), size);
        } else if (kind === "d") {
          totalDirectories += 1;
        } else if (kind === "l") {
          totalSymlinks += 1;
        } else {
          totalOther += 1;
        }
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", consume);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      if (code === 0 || code === 1) finish();
      else finish(new Error(`Filesystem scan failed${signal ? ` (${signal})` : ""}: ${stderr.trim() || `find exited with code ${code}`}`));
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Filesystem scan timed out after ${Math.round(SCAN_TIMEOUT_MS / 1000)} seconds`));
    }, SCAN_TIMEOUT_MS);
    timer.unref();
  });

  return {
    totalFiles,
    totalDirectories,
    totalSymlinks,
    totalOther,
    totalFileBytes,
    fileTypes: Array.from(fileTypes, ([type, value]) => ({ type, ...value }))
      .sort((left, right) => right.count - left.count || right.bytes - left.bytes || left.type.localeCompare(right.type)),
    categories: Array.from(categories, ([category, value]) => ({ category, ...value }))
      .sort((left, right) => right.count - left.count || right.bytes - left.bytes),
  };
}

async function realHomeUsers() {
  const passwd = await readFile("/etc/passwd", "utf8");
  const seenHomes = new Set<string>();
  const users: Array<{ username: string; uid: number; path: string }> = [];

  for (const line of passwd.split("\n")) {
    if (!line) continue;
    const fields = line.split(":");
    if (fields.length < 7) continue;
    const username = fields[0];
    const uid = Number(fields[2]);
    const home = fields[5];
    const shell = fields[6];
    if (!username || !Number.isFinite(uid) || uid < MIN_REAL_UID) continue;
    if (!home.startsWith("/home/") || seenHomes.has(home)) continue;
    if (shell.endsWith("/nologin") || shell.endsWith("/false")) continue;
    const info = await stat(home).catch(() => null);
    if (!info?.isDirectory()) continue;
    seenHomes.add(home);
    users.push({ username, uid, path: home });
  }

  return users.sort((left, right) => left.uid - right.uid || left.username.localeCompare(right.username));
}

async function homeUsage(): Promise<HomeUsageSummary[]> {
  const users = await realHomeUsers().catch(() => []);
  const output: HomeUsageSummary[] = [];

  for (const user of users) {
    try {
      const { stdout } = await execFileAsync(
        "du",
        ["-s", "-B1", "--one-file-system", "--", user.path],
        { timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      );
      const bytes = Math.max(0, Number(stdout.trim().split(/\s+/)[0]) || 0);
      output.push({ ...user, bytes });
    } catch {
      output.push({ ...user, bytes: 0 });
    }
  }

  return output.sort((left, right) => right.bytes - left.bytes || left.username.localeCompare(right.username));
}

async function buildStorageAnalysis(): Promise<StorageAnalysis> {
  const [filesystem, homes] = await Promise.all([scanRootFilesystem(), homeUsage()]);
  return {
    generatedAt: new Date().toISOString(),
    root: "/",
    ...filesystem,
    totalItems: filesystem.totalFiles + filesystem.totalDirectories + filesystem.totalSymlinks + filesystem.totalOther,
    homeUsage: homes,
  };
}

let cached: { expiresAt: number; value: StorageAnalysis } | null = null;
let pending: Promise<StorageAnalysis> | null = null;

export async function storageAnalysis(force = false): Promise<StorageAnalysis> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending) return pending;

  pending = buildStorageAnalysis()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}
