import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function passwordHash(password: string, saltHex: string, iterations = 210000) {
  const pairs = saltHex.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid password salt");
  const salt = new Uint8Array(pairs.map((value) => Number.parseInt(value, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function passwordPolicyError(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters";
  if (password.length > 256) return "Password is too long";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  if (/[\u0000-\u001f\u007f]/.test(password))
    return "Password contains unsupported control characters";
  return null;
}

function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "")
    .split(",")[0]
    .trim();
}

async function rateCheck(scope: string, identifier: string, ipAddress: string) {
  const { data, error } = await supabase.rpc("wfilemanager_auth_rate_check", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: ipAddress,
  });
  if (error) throw error;
  return data as { allowed?: boolean; retryAfterSeconds?: number };
}

async function rateRecord(scope: string, identifier: string, ipAddress: string, success: boolean) {
  const { error } = await supabase.rpc("wfilemanager_auth_rate_record", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: ipAddress,
    p_success: success,
    p_limit: 8,
    p_window_minutes: 15,
    p_block_minutes: 15,
  });
  if (error) console.warn("Unable to update setup rate limit", error.message);
}

function setupError(message: string) {
  const mapping: Record<string, { status: number; error: string }> = {
    installation_identity_missing: { status: 400, error: "Installation identity is missing" },
    installation_frozen: {
      status: 423,
      error:
        "This installation is frozen. Recover it with the saved Recovery Kit before signing in.",
    },
    subscription_suspended: {
      status: 402,
      error: "This Pro subscription is suspended because payment is more than 7 days overdue.",
    },
    managed_account_deleted: {
      status: 410,
      error: "This Pro managed application-data account has expired or was deleted.",
    },
    installation_disabled: { status: 403, error: "This installation is disabled" },
    already_configured: { status: 409, error: "This instance is already configured" },
    licence_required: { status: 402, error: "A paid Pro licence key is required before setup." },
    licence_invalid: { status: 402, error: "A valid paid Pro licence key is required." },
    licence_wrong_instance: {
      status: 402,
      error: "This Pro licence key belongs to another instance.",
    },
    licence_expired: { status: 402, error: "This Pro licence key has expired." },
    licence_already_claimed: {
      status: 409,
      error: "This Pro licence key has already been activated.",
    },
  };
  return mapping[message] || { status: 500, error: message || "Unexpected setup error" };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const ipAddress = clientIp(request);
  let instanceKey = "";

  try {
    instanceKey = request.headers.get("x-wfilemanager-instance")?.trim() || "";
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const username = String(body.username || "admin")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "Administrator").trim();
    const rootResetTokenHash = String(body.rootResetTokenHash || "")
      .trim()
      .toLowerCase();
    const instanceSecretHash = String(body.instanceSecretHash || "")
      .trim()
      .toLowerCase();
    const activationToken = String(body.activationToken || "").trim();

    if (!instanceKey) return json({ error: "Installation identity is missing" }, 400);

    const rate = await rateCheck("pro_setup", instanceKey, ipAddress);
    if (rate.allowed === false) {
      return json(
        {
          error: "Too many setup attempts. Try again later.",
          retryAfterSeconds: Number(rate.retryAfterSeconds || 900),
        },
        429,
      );
    }

    if (username.length < 3 || username.length > 64 || !/^[a-z0-9._-]+$/.test(username)) {
      await rateRecord("pro_setup", instanceKey, ipAddress, false);
      return json(
        {
          error:
            "Username must contain 3 to 64 lowercase letters, numbers, dots, underscores or hyphens",
        },
        400,
      );
    }
    if (displayName.length < 2 || displayName.length > 120) {
      await rateRecord("pro_setup", instanceKey, ipAddress, false);
      return json({ error: "Display name must contain 2 to 120 characters" }, 400);
    }
    const policyError = passwordPolicyError(password);
    if (policyError) {
      await rateRecord("pro_setup", instanceKey, ipAddress, false);
      return json({ error: policyError }, 400);
    }
    if (!/^[0-9a-f]{64}$/.test(rootResetTokenHash)) {
      await rateRecord("pro_setup", instanceKey, ipAddress, false);
      return json({ error: "The Pro recovery key is not enrolled" }, 400);
    }
    if (instanceSecretHash && !/^[0-9a-f]{64}$/.test(instanceSecretHash)) {
      await rateRecord("pro_setup", instanceKey, ipAddress, false);
      return json({ error: "The Pro heartbeat credential is invalid" }, 400);
    }

    const salt = randomHex(16);
    const iterations = 210000;
    const permissions = [
      "browse",
      "view",
      "preview",
      "read",
      "create_files",
      "create_directories",
      "edit",
      "rename",
      "copy",
      "move",
      "upload",
      "download",
      "compress",
      "extract",
      "delete",
      "restore",
      "permanently_delete",
      "change_permissions",
      "change_owner",
      "change_group",
      "create_symlinks",
      "calculate_checksums",
      "view_logs",
      "manage_users",
      "manage_roles",
      "change_settings",
    ];

    const { data, error } = await supabase.rpc("wfilemanager_setup_pro_instance", {
      p_activation_token_hash: activationToken ? await sha256(activationToken) : "",
      p_instance_key: instanceKey,
      p_instance_name: String(body.instanceName || "wFileManager"),
      p_hostname: body.hostname ? String(body.hostname) : "",
      p_base_url: body.baseUrl ? String(body.baseUrl) : "",
      p_username: username,
      p_email: body.email ? String(body.email).trim().toLowerCase() : "",
      p_display_name: displayName,
      p_password_hash: await passwordHash(password, salt, iterations),
      p_password_salt: salt,
      p_password_iterations: iterations,
      p_root_reset_token_hash: rootResetTokenHash,
      p_instance_secret_hash: instanceSecretHash,
      p_ip_address: ipAddress,
      p_user_agent: request.headers.get("user-agent") || "",
      p_permissions: permissions,
    });

    if (error) {
      await rateRecord("pro_setup", instanceKey, ipAddress, false);
      const mapped = setupError(error.message);
      return json({ error: mapped.error }, mapped.status);
    }

    await rateRecord("pro_setup", instanceKey, ipAddress, true);
    return json(data, 201);
  } catch (error) {
    if (instanceKey) await rateRecord("pro_setup", instanceKey, ipAddress, false);
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
