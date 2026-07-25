import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function migrationContaining(needle: string) {
  const directory = path.join(root, "supabase/migrations");
  for (const name of await readdir(directory)) {
    const content = await readFile(path.join(directory, name), "utf8");
    if (content.includes(needle)) return content;
  }
  throw new Error(`No migration contains ${needle}`);
}

describe("Pro managed application-data billing lifecycle", () => {
  test("suspends after 7 unpaid days and deletes after 30 unpaid days", async () => {
    const migration = await source(
      "supabase/migrations/20260724213000_wfilemanager_pro_billing_enforcement.sql",
    );

    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("subscription_status = 'suspended'");
    expect(migration).toContain("data_status = 'suspended'");
    expect(migration).toContain("wfilemanager_delete_instance");
    expect(migration).toContain("pro-payment-7-day-suspend-30-day-delete");
  });

  test("requires a paid licence key before atomic Pro setup", async () => {
    const setupApi = await source("supabase/functions/wfilemanager-setup-api/index.ts");
    const setupMigration = await migrationContaining("wfilemanager_setup_pro_instance");
    const setupRoute = await source("src/routes/setup.tsx");

    expect(setupApi).toContain("wfilemanager_setup_pro_instance");
    expect(setupApi).toContain("A paid Pro licence key is required before setup.");
    expect(setupMigration).toContain("wfilemanager_pro_activation_tokens");
    expect(setupMigration).toContain("for update");
    expect(setupRoute).toContain("Pro licence key");
    expect(setupRoute).toContain("+7 days suspend · +30 days delete");
  });

  test("does not create inactivity warning notifications or email jobs", async () => {
    const migration = (
      await source("supabase/migrations/20260724213000_wfilemanager_pro_billing_enforcement.sql")
    ).toLowerCase();

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

  test("heartbeat runs twice daily and uses a separate instance secret", async () => {
    const timer = await source("deploy/wfilemanager-heartbeat.timer");
    const heartbeat = await source("deploy/wfilemanager-heartbeat");

    expect(timer).toContain("OnUnitActiveSec=12h");
    expect(timer).toContain("Persistent=true");
    expect(heartbeat).toContain("x-wfilemanager-instance-secret");
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
