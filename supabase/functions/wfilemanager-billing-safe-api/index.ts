import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wfilemanager-automation-secret",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const UPSTREAM = `${supabaseUrl}/functions/v1/wfilemanager-billing-automation-api`;
const TIMEOUT_MS = 50_000;

type Row = Record<string, any>;
type Config = {
  automationSecretHash: string;
  mailtrapToken: string;
  mailtrapUrl: string;
  fromEmail: string;
  fromName: string;
  supportEmail: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function clean(value: unknown) {
  return String(value ?? "").trim();
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function backoffMinutes(attempts: number) {
  return Math.min(360, Math.max(5, 5 * 2 ** Math.min(6, Math.max(0, attempts - 1))));
}
async function timedFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function config(): Promise<Config> {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Billing configuration is missing");
  return {
    automationSecretHash: clean(data.automation_secret_hash),
    mailtrapToken: clean(data.mailtrap_api_token),
    mailtrapUrl: clean(data.mailtrap_api_url || "https://send.api.mailtrap.io/api/send"),
    fromEmail: clean(data.mailtrap_from_email || "support@kmerhosting.com"),
    fromName: clean(data.mailtrap_from_name || "KmerHosting"),
    supportEmail: clean(data.support_email || "support@kmerhosting.com"),
  };
}
async function authorized(request: Request, settings: Config) {
  const secret = clean(request.headers.get("x-wfilemanager-automation-secret"));
  return Boolean(
    secret &&
      settings.automationSecretHash &&
      safeEqual(await sha256(secret), settings.automationSecretHash),
  );
}
async function sendDeletionEmail(settings: Config, info: Row) {
  if (!settings.mailtrapToken || !info.customerEmail) return { skipped: true };
  const name = clean(info.customerName) || "Customer";
  const response = await timedFetch(settings.mailtrapUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.mailtrapToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: settings.fromEmail, name: settings.fromName },
      to: [{ email: info.customerEmail, name }],
      subject: "Your wFileManager Pro managed account was deleted",
      text: `Hello ${name},\n\nThe managed application data for ${info.instanceKey} was deleted after the applicable unpaid retention period.\n\nA new installation requires a new licence key.\nTechnical support: ${settings.supportEmail}.`,
      html: `<h2>Managed account deleted</h2><p>The managed application data for <strong>${info.instanceKey}</strong> was deleted after the applicable unpaid retention period.</p><p>A new installation requires a new licence key.</p>`,
      category: "wfilemanager-instance-deleted",
    }),
  });
  if (!response.ok) throw new Error(`Deletion email failed (${response.status})`);
  return { sent: true };
}

async function cleanupLifecycle(settings: Config) {
  const { data: events, error } = await db
    .from("wfilemanager_lifecycle_events")
    .select("*")
    .in("status", ["pending", "failed", "database_deleted", "cleanup_failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  const results: unknown[] = [];
  for (const event of events || []) {
    const attempts = Number(event.attempt_count || 0) + 1;
    try {
      let info: Row;
      if (["database_deleted", "cleanup_failed"].includes(event.status)) {
        info = {
          eventId: event.id,
          instanceKey: event.instance_key,
          customerEmail: event.customer_email,
          customerName: event.customer_name,
          cleanupPaths: Array.isArray(event.metadata?.cleanup_paths)
            ? event.metadata.cleanup_paths
            : [],
          databaseDeleted: true,
        };
      } else {
        const { data, error: prepareError } = await db.rpc(
          "wfilemanager_prepare_instance_deletion",
          { p_event_id: event.id },
        );
        if (prepareError) throw prepareError;
        info = data as Row;
      }

      const paths = Array.isArray(info.cleanupPaths)
        ? info.cleanupPaths.map(String).filter(Boolean)
        : [];
      if (paths.length) {
        const removal = await db.storage.from("wfilemanager-backups").remove(paths);
        if (removal.error) throw removal.error;
      }

      let emailError: string | null = null;
      try {
        await sendDeletionEmail(settings, info);
      } catch (mailError) {
        emailError = mailError instanceof Error ? mailError.message : "Deletion email failed";
      }
      const { error: completeError } = await db
        .from("wfilemanager_lifecycle_events")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          last_error: emailError,
          metadata: {
            ...(event.metadata || {}),
            cleanup_paths: paths,
            storage_deleted_at: new Date().toISOString(),
            email_error: emailError,
          },
        })
        .eq("id", event.id);
      if (completeError) throw completeError;
      results.push({ instance: info.instanceKey, databaseDeleted: true, backupsDeleted: true });
    } catch (value) {
      const message = value instanceof Error ? value.message : "Lifecycle cleanup failed";
      const databaseDeleted = ["database_deleted", "cleanup_failed"].includes(event.status) ||
        !(await db
          .from("wfilemanager_instances")
          .select("id", { count: "exact", head: true })
          .eq("id", event.instance_id)
          .then((result) => (result.count || 0) > 0));
      await db
        .from("wfilemanager_lifecycle_events")
        .update({
          status: databaseDeleted ? "cleanup_failed" : "failed",
          attempt_count: attempts,
          next_attempt_at: new Date(Date.now() + backoffMinutes(attempts) * 60000).toISOString(),
          last_error: message,
        })
        .eq("id", event.id);
      results.push({ instance: event.instance_key, completed: false, databaseDeleted, error: message });
    }
  }
  return { checked: events?.length || 0, results };
}

async function callUpstream(request: Request, action: string) {
  const secret = clean(request.headers.get("x-wfilemanager-automation-secret"));
  const response = await timedFetch(`${UPSTREAM}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wfilemanager-automation-secret": secret,
    },
    body: "{}",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      clean((payload as Row).error) || `Billing automation failed (${response.status})`,
    );
  return payload;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "run-fast";
    if (!["run-fast", "run-daily", "run"].includes(action))
      return json({ error: "Not found" }, 404);
    const settings = await config();
    if (!(await authorized(request, settings)))
      return json({ error: "Unauthorized automation request" }, 401);
    const lifecycle = await cleanupLifecycle(settings);
    const upstream = await callUpstream(request, action === "run" ? "run-daily" : action);
    return json({ ok: true, safeLifecycle: lifecycle, billing: upstream });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Safe billing automation failed" }, 500);
  }
});
