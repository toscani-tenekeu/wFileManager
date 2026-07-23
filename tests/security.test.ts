import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeExistingMutation } from "../src/lib/server/safe-path-runtime";
import { saveRawUpload } from "../src/lib/server/upload-runtime";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(roots.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("filesystem mutation safety", () => {
  test("rejects a mutation path that traverses a symbolic link", async () => {
    const root = await temporaryDirectory("wfm-safe-path-");
    const actual = path.join(root, "actual");
    await mkdir(actual);
    await writeFile(path.join(actual, "file.txt"), "safe");
    await symlink(actual, path.join(root, "linked"));

    await expect(assertSafeExistingMutation(path.join(root, "linked", "file.txt")))
      .rejects.toThrow("symbolic links");
  });

  test("never overwrites an existing upload destination", async () => {
    const root = await temporaryDirectory("wfm-upload-");
    const target = path.join(root, "existing.txt");
    await writeFile(target, "original", { mode: 0o600 });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("replacement"));
        controller.close();
      },
    });

    await expect(saveRawUpload(root, "existing.txt", body)).rejects.toThrow("already exists");
    expect(await readFile(target, "utf8")).toBe("original");
  });
});

describe("archive extraction safety", () => {
  test("rejects archives that exceed the configured entry count", async () => {
    process.env.WFILEMANAGER_ARCHIVE_MAX_ENTRIES = "100";
    const root = await temporaryDirectory("wfm-archive-");
    const archive = path.join(root, "many.zip");
    const script = [
      "import zipfile, sys",
      "with zipfile.ZipFile(sys.argv[1], 'w') as z:",
      "    for i in range(101): z.writestr(f'entry-{i}.txt', '')",
    ].join("\n");
    await execFileAsync("python3", ["-c", script, archive]);
    const { inspectArchiveSafety } = await import("../src/lib/server/archive-guard");

    await expect(inspectArchiveSafety(archive, root)).rejects.toThrow("the limit is 100");
  });
});

describe("authentication protection", () => {
  test("blocks repeated SQLite login failures for the same IP and account", async () => {
    process.env.WFILEMANAGER_LOGIN_MAX_FAILURES = "3";
    process.env.WFILEMANAGER_LOGIN_BLOCK_MS = "30000";
    const limiter = await import("../src/lib/server/login-rate-limit");
    const request = new Request("https://files.example.test/api/sqlite", {
      headers: { "x-forwarded-for": "192.0.2.40" },
    });
    const login = `test-${Date.now()}`;

    limiter.assertLoginAllowed(request, login);
    limiter.recordLoginFailure(request, login);
    limiter.recordLoginFailure(request, login);
    limiter.recordLoginFailure(request, login);
    expect(() => limiter.assertLoginAllowed(request, login)).toThrow("Too many failed sign-in attempts");
  });
});

describe("application health", () => {
  test("checks application metadata and persistent filesystem access", async () => {
    const stateRoot = await temporaryDirectory("wfm-health-");
    process.env.WFILEMANAGER_DATABASE_MODE = "supabase";
    process.env.WFILEMANAGER_STATE_ROOT = stateRoot;
    const { healthSummary } = await import("../src/lib/server/health-runtime");
    const result = await healthSummary();

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name).sort()).toEqual(["application", "database", "filesystem"]);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });
});
