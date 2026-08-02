import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("open source release", () => {
  test("setup exposes no plan or activation choice", async () => {
    const setup = await source("src/routes/setup.tsx");
    const installer = await source("deploy/install.sh");

    expect(setup).not.toContain("SQLite on this server");
    expect(setup).not.toContain("activationToken");
    expect(setup).not.toContain("licence key");
    expect(installer).toContain('DATABASE_MODE="sqlite"');
    expect(installer).not.toContain("WFILEMANAGER_PLAN=");
    expect(installer).not.toContain("WFILEMANAGER_SUPABASE_ACTION");
  });

  test("does not install managed backup or recovery helpers", async () => {
    const installer = await source("deploy/install.sh");
    const updater = await source("deploy/update.sh");

    expect(installer).not.toContain("wfilemanager-backup-worker");
    expect(installer).not.toContain("wfilemanager-recovery-kit");
    expect(updater).not.toContain("wfilemanager-backup-worker");
    expect(updater).not.toContain("wfilemanager-recovery-kit");
  });
});

describe("release-only remote backend", () => {
  test("keeps authentication and application data local", async () => {
    const authRuntime = await source("src/lib/server/local-auth-runtime.ts");
    const healthRuntime = await source("src/lib/server/health-runtime.ts");
    const updater = await source("deploy/update.sh");

    expect(authRuntime).not.toContain("SUPABASE");
    expect(authRuntime).not.toContain("fetch(");
    expect(healthRuntime).not.toContain("Managed authentication backend");
    expect(updater).not.toContain("heartbeat_source");
    await expect(access(path.join(root, "deploy/wfilemanager-heartbeat"))).rejects.toThrow();
    await expect(
      access(path.join(root, "supabase/functions/wfilemanager-instance-lifecycle-api/index.ts")),
    ).rejects.toThrow();
  });
});
