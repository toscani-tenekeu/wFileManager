import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wfilemanager-automation-secret",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BUCKET = "wfilemanager-backups";
const MAGIC = encoder.encode("WFMBAK1");
const PAGE_SIZE = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function digest(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
async function keyFromSecret(secret: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encrypt(secret: string, value: unknown) {
  const key = await keyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const output = new Uint8Array(MAGIC.length + iv.length + encrypted.length);
  output.set(MAGIC, 0);
  output.set(iv, MAGIC.length);
  output.set(encrypted, MAGIC.length + iv.length);
  return output;
}
async function decrypt(secret: string, bytes: Uint8Array) {
  const magic = bytes.slice(0, MAGIC.length);
  if (!safeEqual(hex(magic), hex(MAGIC))) throw new Error("Invalid backup format");
  const iv = bytes.slice(MAGIC.length, MAGIC.length + 12);
  const ciphertext = bytes.slice(MAGIC.length + 12);
  const key = await keyFromSecret(secret);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(decoder.decode(plaintext));
}
async function configHash() {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select("automation_secret_hash")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return String(data?.automation_secret_hash || "");
}
async function authorize(request: Request) {
  const secret = String(request.headers.get("x-wfilemanager-automation-secret") || "").trim();
  if (!secret) return null;
  const supplied = await digest(encoder.encode(secret));
  if (!safeEqual(supplied, await configHash())) return null;
  return secret;
}
function backupKey(automationSecret: string) {
  const configured = String(Deno.env.get("WFILEMANAGER_BACKUP_ENCRYPTION_KEY") || "").trim();
  return {
    secret: configured || automationSecret,
    version: configured
      ? String(Deno.env.get("WFILEMANAGER_BACKUP_KEY_VERSION") || "v1")
      : "legacy-automation-secret",
    dedicated: Boolean(configured),
  };
}
function policy(now = new Date()) {
  if (now.getUTCDate() === 1) return { snapshotType: "monthly", retentionDays: 190 };
  if (now.getUTCDay() === 0) return { snapshotType: "weekly", retentionDays: 35 };
  return { snapshotType: "automatic", retentionDays: 8 };
}
async function rows(table: string, instanceId: string) {
  const result: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .eq("instance_id", instanceId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return result;
}
async function createSnapshot(
  encryptionSecret: string,
  keyVersion: string,
  instance: Record<string, unknown>,
) {
  const now = new Date();
  const selectedPolicy = policy(now);
  const [roles, users, settings, notifications, pathRules, auditLogs] = await Promise.all([
    rows("wfilemanager_roles", String(instance.id)),
    rows("wfilemanager_users", String(instance.id)),
    rows("wfilemanager_settings", String(instance.id)),
    rows("wfilemanager_notifications", String(instance.id)),
    rows("wfilemanager_path_rules", String(instance.id)),
    rows("wfilemanager_audit_logs", String(instance.id)),
  ]);
  const document = {
    format: "wfilemanager-pro-snapshot-v1",
    encrypted: true,
    createdAt: now.toISOString(),
    instance: {
      id: instance.id,
      instanceKey: instance.instance_key,
      name: instance.name,
      hostname: instance.hostname,
      baseUrl: instance.base_url,
      paidUntil: instance.paid_until,
      storageQuotaBytes: instance.storage_quota_bytes,
    },
    data: { roles, users, settings, notifications, pathRules, auditLogs },
  };
  const encrypted = await encrypt(encryptionSecret, document);
  const checksum = await digest(encrypted);
  const safeKey = String(instance.instance_key).replace(/[^A-Za-z0-9._-]/g, "_");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const storagePath = `instances/${safeKey}/${now.toISOString().slice(0, 10)}/${stamp}.wfmbackup`;
  const retentionUntil = new Date(
    now.getTime() + selectedPolicy.retentionDays * 86400000,
  ).toISOString();
  const upload = await db.storage.from(BUCKET).upload(storagePath, encrypted, {
    contentType: "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) throw upload.error;
  const { data: snapshot, error } = await db
    .from("wfilemanager_backup_snapshots")
    .insert({
      instance_id: instance.id,
      snapshot_type: selectedPolicy.snapshotType,
      status: "available",
      size_bytes: encrypted.byteLength,
      checksum_sha256: checksum,
      storage_path: storagePath,
      retention_until: retentionUntil,
      manifest: {
        format: document.format,
        encrypted: true,
        cipher: "AES-256-GCM",
        keyVersion,
        counts: {
          roles: roles.length,
          users: users.length,
          settings: settings.length,
          notifications: notifications.length,
          pathRules: pathRules.length,
          auditLogs: auditLogs.length,
        },
      },
    })
    .select("id")
    .single();
  if (error) {
    await db.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }
  try {
    const downloaded = await db.storage.from(BUCKET).download(storagePath);
    if (downloaded.error) throw downloaded.error;
    const verificationBytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (!safeEqual(checksum, await digest(verificationBytes)))
      throw new Error("Backup checksum mismatch");
    const verifiedDocument = await decrypt(encryptionSecret, verificationBytes);
    if (
      verifiedDocument?.format !== document.format ||
      verifiedDocument?.instance?.id !== instance.id
    )
      throw new Error("Backup content verification failed");
    await db
      .from("wfilemanager_backup_snapshots")
      .update({ verified_at: new Date().toISOString(), verification_error: null })
      .eq("id", snapshot.id);
  } catch (verificationError) {
    await db
      .from("wfilemanager_backup_snapshots")
      .update({
        status: "failed",
        verification_error:
          verificationError instanceof Error ? verificationError.message : "Verification failed",
      })
      .eq("id", snapshot.id);
    throw verificationError;
  }
  return {
    snapshotId: snapshot.id,
    storagePath,
    sizeBytes: encrypted.byteLength,
    checksum,
    retentionUntil,
    keyVersion,
  };
}
async function runSnapshots(encryptionSecret: string, keyVersion: string) {
  const results: unknown[] = [];
  let checked = 0;
  for (let from = 0; ; from += 100) {
    const { data: instances, error } = await db
      .from("wfilemanager_instances")
      .select("*")
      .eq("service_plan", "pro")
      .in("data_status", ["active", "frozen", "suspended"])
      .order("id", { ascending: true })
      .range(from, from + 99);
    if (error) throw error;
    for (const instance of instances || []) {
      checked += 1;
      const { data: latest } = await db
        .from("wfilemanager_backup_snapshots")
        .select("created_at,status")
        .eq("instance_id", instance.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest && new Date(latest.created_at).getTime() > Date.now() - 20 * 3600000) {
        results.push({ instance: instance.instance_key, skipped: "recent_snapshot" });
        continue;
      }
      try {
        results.push({
          instance: instance.instance_key,
          snapshot: await createSnapshot(encryptionSecret, keyVersion, instance),
        });
      } catch (value) {
        results.push({
          instance: instance.instance_key,
          error: value instanceof Error ? value.message : "Snapshot failed",
        });
      }
    }
    if (!instances || instances.length < 100) break;
  }
  return { checked, results };
}
async function cleanupExpired() {
  let deleted = 0;
  while (true) {
    const { data: snapshots, error } = await db
      .from("wfilemanager_backup_snapshots")
      .select("id,storage_path")
      .lt("retention_until", new Date().toISOString())
      .limit(500);
    if (error) throw error;
    if (!snapshots?.length) break;
    const paths = snapshots.map((snapshot) => snapshot.storage_path).filter(Boolean);
    if (paths.length) {
      const removal = await db.storage.from(BUCKET).remove(paths);
      if (removal.error) throw removal.error;
    }
    const ids = snapshots.map((snapshot) => snapshot.id);
    const deletion = await db.from("wfilemanager_backup_snapshots").delete().in("id", ids);
    if (deletion.error) throw deletion.error;
    deleted += ids.length;
    if (snapshots.length < 500) break;
  }
  return { deleted };
}
async function restoreSnapshot(encryptionSecret: string, body: Record<string, unknown>) {
  const snapshotId = String(body.snapshotId || "").trim();
  const dryRun = body.dryRun !== false;
  if (!snapshotId) throw new Error("snapshotId is required");
  const { data: snapshot, error } = await db
    .from("wfilemanager_backup_snapshots")
    .select(
      "id,instance_id,status,storage_path,checksum_sha256,manifest,wfilemanager_instances(instance_key)",
    )
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw error;
  if (!snapshot || snapshot.status !== "available" || !snapshot.storage_path)
    throw new Error("Snapshot is unavailable");
  const downloaded = await db.storage.from(BUCKET).download(snapshot.storage_path);
  if (downloaded.error) throw downloaded.error;
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (!safeEqual(String(snapshot.checksum_sha256 || ""), await digest(bytes)))
    throw new Error("Backup checksum mismatch");
  const document = await decrypt(encryptionSecret, bytes);
  if (String(document?.instance?.id || "") !== String(snapshot.instance_id))
    throw new Error("Snapshot instance mismatch");
  const instanceKey = String((snapshot.wfilemanager_instances as any)?.instance_key || "");
  if (!dryRun && String(body.confirmInstanceKey || "") !== instanceKey)
    throw new Error("confirmInstanceKey must exactly match the target instance key");
  const { data: result, error: restoreError } = await db.rpc(
    "wfilemanager_restore_managed_snapshot",
    {
      p_instance_id: snapshot.instance_id,
      p_document: document,
      p_dry_run: dryRun,
    },
  );
  if (restoreError) {
    await db
      .from("wfilemanager_backup_snapshots")
      .update({ restore_error: restoreError.message })
      .eq("id", snapshot.id);
    throw restoreError;
  }
  if (!dryRun)
    await db
      .from("wfilemanager_backup_snapshots")
      .update({ restored_at: new Date().toISOString(), restore_error: null })
      .eq("id", snapshot.id);
  return { snapshotId, instanceKey, ...result };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "status";
    if (action === "status")
      return json({
        ok: true,
        encryptedSnapshots: true,
        cipher: "AES-256-GCM",
        checksumVerification: true,
        transactionalRestore: true,
        dedicatedEncryptionKeyConfigured: Boolean(
          Deno.env.get("WFILEMANAGER_BACKUP_ENCRYPTION_KEY"),
        ),
        retention: { dailyDays: 8, weeklyDays: 35, monthlyDays: 190 },
      });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const automationSecret = await authorize(request);
    if (!automationSecret) return json({ error: "Unauthorized backup request" }, 401);
    const key = backupKey(automationSecret);
    if (action === "run" || action === "snapshot")
      return json({
        ok: true,
        snapshots: await runSnapshots(key.secret, key.version),
        cleanup: await cleanupExpired(),
        dedicatedEncryptionKey: key.dedicated,
      });
    if (action === "cleanup") return json({ ok: true, cleanup: await cleanupExpired() });
    if (action === "restore")
      return json({
        ok: true,
        restore: await restoreSnapshot(key.secret, await request.json().catch(() => ({}))),
      });
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Backup automation failed" },
      500,
    );
  }
});
