import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("Community-only release", () => {
  test("setup and installer use local SQLite without Pro activation", async () => {
    const setup = await source("src/routes/setup.tsx");
    const installer = await source("deploy/install.sh");

    expect(setup).toContain("SQLite on this server");
    expect(setup).not.toContain("activationToken");
    expect(setup).not.toContain("licence key");
    expect(installer).toContain('DATABASE_MODE="sqlite"');
    expect(installer).toContain("WFILEMANAGER_PLAN=community");
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

describe("legacy Pro retirement transition", () => {
  test("requires an explicit database flag and a capable 0.10 heartbeat", async () => {
    const lifecycle = await source(
      "supabase/functions/wfilemanager-instance-lifecycle-api/index.ts",
    );
    const migration = await source(
      "supabase/migrations/20260802011102_retire_wfilemanager_pro_transition.sql",
    );
    const heartbeat = await source("deploy/wfilemanager-heartbeat");

    expect(migration).toContain("decommission_requested_at");
    expect(migration).not.toContain("update public.wfilemanager_instances");
    expect(lifecycle).toContain("authorized.instance.decommission_requested_at");
    expect(lifecycle).toContain("supportsProDecommission(appVersion, capabilities)");
    expect(heartbeat).toContain("pro-decommission-v1");
    expect(heartbeat).toContain("actionAuthorization");
  });

  test("binds the retirement action to the instance, version and local credential", async () => {
    const lifecycle = await source(
      "supabase/functions/wfilemanager-instance-lifecycle-api/index.ts",
    );
    const uninstaller = await source("deploy/uninstall.sh");

    expect(lifecycle).toContain("hmacSha256");
    expect(lifecycle).toContain("retire-pro:${authorized.instance.instance_key}:${appVersion}");
    expect(uninstaller).toContain('payload="retire-pro:${INSTANCE_KEY}:${RETIRE_APP_VERSION}"');
    expect(uninstaller).toContain('[[ "$expected" == "$RETIRE_AUTHORIZATION" ]]');
  });

  test("deletes remote data before removing local files and keeps packages", async () => {
    const uninstaller = await source("deploy/uninstall.sh");
    const retirementBlock = uninstaller.slice(
      uninstaller.indexOf('if [[ "$RETIRE_PRO" == "true" ]]'),
    );

    expect(retirementBlock.indexOf("delete_remote_pro_data")).toBeGreaterThan(-1);
    expect(retirementBlock.indexOf("local_remove")).toBeGreaterThan(
      retirementBlock.indexOf("delete_remote_pro_data"),
    );
    expect(retirementBlock).toContain("REMOVE_PACKAGES=false");
  });

  test("keeps retrying while remote deletion is unavailable", async () => {
    const heartbeat = await source("deploy/wfilemanager-heartbeat");
    const timer = await source("deploy/wfilemanager-heartbeat.timer");
    const uninstaller = await source("deploy/uninstall.sh");

    expect(timer).toContain("OnUnitActiveSec=15min");
    expect(timer).toContain("Persistent=true");
    expect(heartbeat).toContain("exit $?");
    expect(uninstaller).toContain("Local files were not removed");
  });
});
