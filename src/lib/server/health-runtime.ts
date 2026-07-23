import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const DATABASE_MODE = process.env.WFILEMANAGER_DATABASE_MODE === "sqlite" ? "sqlite" : "supabase";
const DB_PATH = process.env.WFILEMANAGER_SQLITE_PATH || "/var/lib/wfilemanager/wfilemanager.db";
const STATE_ROOT = process.env.WFILEMANAGER_STATE_ROOT || "/var/lib/wfilemanager";

export type HealthCheck = {
  name: string;
  ok: boolean;
  message: string;
  durationMs: number;
};

async function timed(name: string, operation: () => Promise<string>): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const message = await operation();
    return { name, ok: true, message, durationMs: Date.now() - started };
  } catch (error) {
    return { name, ok: false, message: error instanceof Error ? error.message : "Health check failed", durationMs: Date.now() - started };
  }
}

async function databaseCheck() {
  if (DATABASE_MODE !== "sqlite") return "Managed authentication backend configured";
  const sqlite = await import("node:sqlite");
  const database = new sqlite.DatabaseSync(DB_PATH, { readOnly: true });
  try {
    database.prepare("SELECT 1 AS healthy").get();
    database.prepare("SELECT value FROM wfm_meta WHERE key = 'configured'").get();
    return "SQLite database is readable";
  } finally {
    database.close();
  }
}

async function filesystemCheck() {
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  const target = path.join(STATE_ROOT, `.health-${process.pid}-${crypto.randomUUID()}`);
  const marker = crypto.randomBytes(24).toString("hex");
  try {
    await writeFile(target, marker, { flag: "wx", mode: 0o600 });
    const value = await readFile(target, "utf8");
    if (value !== marker) throw new Error("Filesystem write verification failed");
    return "Persistent state directory is readable and writable";
  } finally {
    await rm(target, { force: true }).catch(() => undefined);
  }
}

async function applicationCheck() {
  const packagePath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { name?: string; version?: string };
  if (packageJson.name !== "wfilemanager" || !packageJson.version) throw new Error("Application release metadata is invalid");
  return `wFileManager ${packageJson.version} is loaded`;
}

export async function healthSummary(scope?: string | null) {
  const available = {
    application: () => timed("application", applicationCheck),
    database: () => timed("database", databaseCheck),
    filesystem: () => timed("filesystem", filesystemCheck),
  };
  const selected = scope && scope in available
    ? [await available[scope as keyof typeof available]()]
    : await Promise.all(Object.values(available).map((check) => check()));
  const ok = selected.every((check) => check.ok);
  return {
    ok,
    status: ok ? "healthy" : "unhealthy",
    checks: selected,
    checkedAt: new Date().toISOString(),
  };
}
