import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wfilemanager-instance",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
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
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function passwordHash(password: string, saltHex: string, iterations = 210000) {
  const pairs = saltHex.match(/.{1,2}/g);
  if (!pairs) throw new Error("Invalid password salt");
  const salt = new Uint8Array(pairs.map((value) => Number.parseInt(value, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function passwordPolicyError(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters";
  if (!/^[A-Za-z0-9]+$/.test(password)) return "Password may contain only uppercase letters, lowercase letters and numbers";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  if (/(.)\1/.test(password)) return "Password must not contain identical consecutive characters";
  return null;
}

function safeUser(user: Record<string, unknown>) {
  return {
    id: user.id,
    instanceId: user.instance_id,
    roleId: user.role_id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    isAdmin: user.is_admin,
    mustChangePassword: user.must_change_password,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const now = new Date().toISOString();
    const instanceKey = request.headers.get("x-wfilemanager-instance")?.trim() || "";
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const username = String(body.username || "admin").trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || "Administrator").trim();
    const rootResetTokenHash = String(body.rootResetTokenHash || "").trim().toLowerCase();
    const instanceSecretHash = String(body.instanceSecretHash || "").trim().toLowerCase();

    if (!instanceKey) return json({ error: "Installation identity is missing" }, 400);
    if (username.length < 3) return json({ error: "Username must contain at least 3 characters" }, 400);
    if (!displayName) return json({ error: "Display name is required" }, 400);
    const policyError = passwordPolicyError(password);
    if (policyError) return json({ error: policyError }, 400);
    if (!/^[0-9a-f]{64}$/.test(rootResetTokenHash)) {
      return json({ error: "The Pro recovery key is not enrolled" }, 400);
    }
    if (instanceSecretHash && !/^[0-9a-f]{64}$/.test(instanceSecretHash)) {
      return json({ error: "The Pro heartbeat credential is invalid" }, 400);
    }

    let { data: instance, error: instanceError } = await supabase
      .from("wfilemanager_instances")
      .select("*")
      .eq("instance_key", instanceKey)
      .maybeSingle();
    if (instanceError) throw instanceError;

    if (instance?.status === "frozen") {
      return json({ error: "This installation is frozen. Recover it with the saved Recovery Kit before signing in." }, 423);
    }
    if (instance?.status === "disabled") {
      return json({ error: "This installation is disabled" }, 403);
    }

    if (!instance) {
      const created = await supabase.from("wfilemanager_instances").insert({
        instance_key: instanceKey,
        name: String(body.instanceName || "wFileManager"),
        hostname: body.hostname ? String(body.hostname) : null,
        base_url: body.baseUrl ? String(body.baseUrl) : null,
        status: "active",
        service_plan: "pro",
        subscription_status: "active",
        data_status: "active",
        last_seen_at: now,
      }).select().single();
      if (created.error) throw created.error;
      instance = created.data;
    } else {
      const updated = await supabase.from("wfilemanager_instances").update({
        hostname: body.hostname ? String(body.hostname) : instance.hostname,
        base_url: body.baseUrl ? String(body.baseUrl) : instance.base_url,
        status: "active",
        data_status: "active",
        last_seen_at: now,
        frozen_at: null,
        delete_after_at: null,
        updated_at: now,
      }).eq("id", instance.id).select().single();
      if (updated.error) throw updated.error;
      instance = updated.data;
    }

    const { count, error: countError } = await supabase
      .from("wfilemanager_users")
      .select("id", { count: "exact", head: true })
      .eq("instance_id", instance.id);
    if (countError) throw countError;
    if ((count || 0) > 0) return json({ error: "This instance is already configured" }, 409);

    const permissions = [
      "browse", "view", "preview", "read", "create_files", "create_directories", "edit", "rename",
      "copy", "move", "upload", "download", "compress", "extract", "delete", "restore",
      "permanently_delete", "change_permissions", "change_owner", "change_group", "create_symlinks",
      "calculate_checksums", "view_logs", "manage_users", "manage_roles", "change_settings",
    ];

    const roleResult = await supabase.from("wfilemanager_roles").insert({
      instance_id: instance.id,
      name: "Administrator",
      description: "Full access",
      permissions,
      is_system: true,
    }).select().single();
    if (roleResult.error) throw roleResult.error;

    const salt = randomHex(16);
    const iterations = 210000;
    const userResult = await supabase.from("wfilemanager_users").insert({
      instance_id: instance.id,
      role_id: roleResult.data.id,
      username,
      email: body.email ? String(body.email).trim().toLowerCase() : null,
      display_name: displayName,
      password_hash: await passwordHash(password, salt, iterations),
      password_salt: salt,
      password_iterations: iterations,
      is_admin: true,
      status: "active",
      must_change_password: false,
    }).select().single();
    if (userResult.error) throw userResult.error;

    const pathRuleResult = await supabase.from("wfilemanager_path_rules").insert({
      instance_id: instance.id,
      user_id: userResult.data.id,
      path: "/",
      access_mode: "allow",
      recursive: true,
    });
    if (pathRuleResult.error) throw pathRuleResult.error;

    const resetResult = await supabase.from("wfilemanager_root_reset_tokens").upsert({
      instance_id: instance.id,
      token_hash: rootResetTokenHash,
      updated_at: now,
    }, { onConflict: "instance_id" });
    if (resetResult.error) throw resetResult.error;

    if (instanceSecretHash) {
      const credentialResult = await supabase.from("wfilemanager_instance_credentials").upsert({
        instance_id: instance.id,
        credential_type: "heartbeat",
        secret_hash: instanceSecretHash,
        last_used_at: null,
        revoked_at: null,
        updated_at: now,
      }, { onConflict: "instance_id,credential_type" });
      if (credentialResult.error) throw credentialResult.error;
    }

    await supabase.from("wfilemanager_audit_logs").insert({
      instance_id: instance.id,
      user_id: userResult.data.id,
      username,
      action: "instance.setup",
      target: instanceKey,
      result: "success",
      metadata: {
        password_policy: "admin_v2",
        recovery_key_enrolled: true,
        heartbeat_secret_enrolled: Boolean(instanceSecretHash),
      },
      ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      user_agent: request.headers.get("user-agent") || null,
    });

    return json({ success: true, user: safeUser(userResult.data) }, 201);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
