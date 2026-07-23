import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("managed Supabase recovery lifecycle", () => {
  test("freezes after 30 days and deletes after 90 days", async () => {
    const migration = await source("supabase/migrations/20260723183000_wfilemanager_supabase_recovery_lifecycle.sql");

    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("interval '90 days'");
    expect(migration).toContain("status = 'frozen'");
    expect(migration).toContain("wfilemanager_delete_instance");
    expect(migration).toContain("wfilemanager-instance-lifecycle");
  });

  test("does not create inactivity warning notifications or email jobs", async () => {
    const migration = (await source("supabase/migrations/20260723183000_wfilemanager_supabase_recovery_lifecycle.sql")).toLowerCase();

    expect(migration).not.toContain("insert into public.wfilemanager_notifications");
    expect(migration).not.toContain("send_email");
    expect(migration).not.toContain("mailgun");
    expect(migration).not.toContain("resend");
  });

  test("installer supports create, recover and remote delete actions", async () => {
    const installer = await source("deploy/install.sh");

    expect(installer).toContain("WFILEMANAGER_SUPABASE_ACTION=new, recover or delete");
    expect(installer).toContain("Recover an existing installation with a Recovery Kit");
    expect(installer).toContain("Permanently delete an existing remote installation");
    expect(installer).toContain("recoveryKeyRotated");
    expect(installer).toContain("/root/wfilemanager-recovery-kit.txt");
  });

  test("heartbeat runs twice daily and uses the recovery secret", async () => {
    const timer = await source("deploy/wfilemanager-heartbeat.timer");
    const heartbeat = await source("deploy/wfilemanager-heartbeat");

    expect(timer).toContain("OnUnitActiveSec=12h");
    expect(timer).toContain("Persistent=true");
    expect(heartbeat).toContain("x-wfilemanager-recovery-key");
    expect(heartbeat).toContain("/heartbeat");
  });

  test("uninstall removes both remote data and local lifecycle helpers", async () => {
    const uninstaller = await source("deploy/uninstall.sh");

    expect(uninstaller).toContain("/delete");
    expect(uninstaller).toContain("wfilemanager-heartbeat.timer");
    expect(uninstaller).toContain("wfilemanager-recovery-kit");
    expect(uninstaller).toContain("/root/wfilemanager-recovery-kit.txt");
  });
});
