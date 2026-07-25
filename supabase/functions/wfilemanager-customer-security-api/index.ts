import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;

type Customer = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function clean(value: unknown) {
  return String(value ?? "").trim();
}
function normalizeEmail(value: unknown) {
  return clean(value).toLowerCase();
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
async function passwordHash(
  password: string,
  salt = randomHex(16),
  iterations = PASSWORD_ITERATIONS,
) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexBytes(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return { salt, hash: hex(new Uint8Array(bits)), iterations };
}
function passwordPolicy(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters";
  if (password.length > 256) return "Password is too long";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  if (/[\u0000-\u001f\u007f]/.test(password))
    return "Password contains unsupported control characters";
  return "";
}
function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "")
    .split(",")[0]
    .trim();
}
function bearer(request: Request) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
function escapeHtml(value: unknown) {
  return clean(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

async function config() {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select(
      "mailtrap_api_token,mailtrap_api_url,mailtrap_from_email,mailtrap_from_name,support_email,site_url",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return {
    mailtrapToken: String(data?.mailtrap_api_token || ""),
    mailtrapUrl: String(data?.mailtrap_api_url || "https://send.api.mailtrap.io/api/send"),
    fromEmail: String(data?.mailtrap_from_email || "support@kmerhosting.com"),
    fromName: String(data?.mailtrap_from_name || "KmerHosting"),
    supportEmail: String(data?.support_email || "support@kmerhosting.com"),
    siteUrl: String(data?.site_url || "https://wfilemanager.com").replace(/\/$/, ""),
  };
}

async function sendMail(
  settings: Awaited<ReturnType<typeof config>>,
  params: {
    email: string;
    name: string;
    subject: string;
    text: string;
    html: string;
    category: string;
  },
) {
  if (!settings.mailtrapToken) throw new Error("Mailtrap API token is not configured");
  const response = await fetch(settings.mailtrapUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.mailtrapToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: settings.fromEmail, name: settings.fromName },
      to: [{ email: params.email, name: params.name || "Customer" }],
      subject: params.subject,
      text: params.text,
      html: params.html,
      category: params.category,
    }),
  });
  if (!response.ok) throw new Error(`Mail delivery failed (${response.status})`);
}

async function rateCheck(scope: string, identifier: string, ipAddress: string) {
  const { data, error } = await db.rpc("wfilemanager_auth_rate_check", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: ipAddress,
  });
  if (error) throw error;
  return data as { allowed?: boolean; retryAfterSeconds?: number };
}
async function rateRecord(
  scope: string,
  identifier: string,
  ipAddress: string,
  success: boolean,
  limit = 5,
) {
  const { error } = await db.rpc("wfilemanager_auth_rate_record", {
    p_scope: scope,
    p_identifier_hash: await sha256(identifier),
    p_ip_address: ipAddress,
    p_success: success,
    p_limit: limit,
    p_window_minutes: 15,
    p_block_minutes: 15,
  });
  if (error) console.warn("Unable to update customer security rate limit", error.message);
}

async function authenticate(request: Request) {
  const token = bearer(request);
  if (!token) return null;
  const { data, error } = await db
    .from("wfilemanager_customer_sessions")
    .select("id,customer_id,wfilemanager_customer_accounts(*)")
    .eq("token_hash", await sha256(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  const customer = data?.wfilemanager_customer_accounts as Customer | undefined;
  if (!customer || customer.status !== "active") return null;
  return customer;
}

async function issueToken(
  customer: Customer,
  purpose: "password_reset" | "email_verification",
  lifetimeMinutes: number,
) {
  const token = `wfm_${randomHex(32)}`;
  await db
    .from("wfilemanager_customer_auth_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("customer_id", customer.id)
    .eq("purpose", purpose)
    .is("consumed_at", null);
  const { error } = await db.from("wfilemanager_customer_auth_tokens").insert({
    customer_id: customer.id,
    purpose,
    token_hash: await sha256(token),
    expires_at: new Date(Date.now() + lifetimeMinutes * 60_000).toISOString(),
  });
  if (error) throw error;
  await db
    .from("wfilemanager_customer_auth_tokens")
    .delete()
    .lt("expires_at", new Date(Date.now() - 7 * 86400000).toISOString());
  return token;
}

async function requestPasswordReset(request: Request, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!email)
    return json({
      success: true,
      message: "If an account exists, a password reset email will be sent.",
    });
  const ip = clientIp(request);
  const rate = await rateCheck("customer_password_reset", email, ip);
  if (rate.allowed === false)
    return json(
      {
        error: "Too many password reset requests. Try again later.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
    );
  const { data: customer, error } = await db
    .from("wfilemanager_customer_accounts")
    .select("id,email,full_name,status")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (customer?.status === "active") {
    const settings = await config();
    const token = await issueToken(customer, "password_reset", 30);
    const url = `${settings.siteUrl}/account?reset=${encodeURIComponent(token)}`;
    const name = customer.full_name || "Customer";
    try {
      await sendMail(settings, {
        email: customer.email,
        name,
        subject: "Reset your wFileManager customer password",
        text: `Hello ${name},\n\nUse this link within 30 minutes to reset your password:\n${url}\n\nIf you did not request this, ignore this message. Technical support: ${settings.supportEmail}.`,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>Reset your password</h2><p>Hello ${escapeHtml(name)},</p><p>This link expires in 30 minutes.</p><p><a href="${url}">Reset customer password</a></p><p>If you did not request this, ignore this message.</p></body></html>`,
        category: "wfilemanager-customer-password-reset",
      });
      await rateRecord("customer_password_reset", email, ip, true, 4);
    } catch (mailError) {
      await rateRecord("customer_password_reset", email, ip, false, 4);
      console.error(mailError);
    }
  } else {
    await rateRecord("customer_password_reset", email, ip, true, 4);
  }
  return json({
    success: true,
    message: "If an account exists, a password reset email will be sent.",
  });
}

async function resetPassword(request: Request, body: Record<string, unknown>) {
  const token = clean(body.token);
  const password = clean(body.password || body.newPassword);
  const policyError = passwordPolicy(password);
  if (!token || policyError) return json({ error: policyError || "Reset token is required" }, 400);
  const ip = clientIp(request);
  const rate = await rateCheck("customer_password_reset_consume", token.slice(0, 20), ip);
  if (rate.allowed === false)
    return json(
      {
        error: "Too many reset attempts. Try again later.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
    );
  const material = await passwordHash(password);
  const { data, error } = await db.rpc("wfilemanager_consume_customer_auth_token", {
    p_token_hash: await sha256(token),
    p_purpose: "password_reset",
    p_password_hash: material.hash,
    p_password_salt: material.salt,
    p_password_iterations: material.iterations,
  });
  if (error) {
    await rateRecord("customer_password_reset_consume", token.slice(0, 20), ip, false);
    if (String(error.message).includes("invalid_or_expired_token"))
      return json({ error: "This password reset link is invalid or expired" }, 400);
    throw error;
  }
  await rateRecord("customer_password_reset_consume", token.slice(0, 20), ip, true);
  return json({ success: true, result: data });
}

async function resendVerification(request: Request) {
  const customer = await authenticate(request);
  if (!customer) return json({ error: "Authentication required" }, 401);
  if (customer.email_verified_at) return json({ success: true, alreadyVerified: true });
  const ip = clientIp(request);
  const rate = await rateCheck("customer_email_verification", customer.email, ip);
  if (rate.allowed === false)
    return json(
      {
        error: "Too many verification requests. Try again later.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
    );
  const settings = await config();
  const token = await issueToken(customer, "email_verification", 24 * 60);
  const url = `${settings.siteUrl}/account?verify=${encodeURIComponent(token)}`;
  const name = customer.full_name || "Customer";
  await sendMail(settings, {
    email: customer.email,
    name,
    subject: "Verify your wFileManager customer email",
    text: `Hello ${name},\n\nVerify your email within 24 hours:\n${url}\n\nTechnical support: ${settings.supportEmail}.`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>Verify your email</h2><p>Hello ${escapeHtml(name)},</p><p><a href="${url}">Verify customer email</a></p><p>This link expires in 24 hours.</p></body></html>`,
    category: "wfilemanager-customer-email-verification",
  });
  await rateRecord("customer_email_verification", customer.email, ip, true, 4);
  return json({ success: true });
}

async function verifyEmail(request: Request, body: Record<string, unknown>) {
  const token = clean(body.token);
  if (!token) return json({ error: "Verification token is required" }, 400);
  const ip = clientIp(request);
  const rate = await rateCheck("customer_email_verification_consume", token.slice(0, 20), ip);
  if (rate.allowed === false)
    return json(
      {
        error: "Too many verification attempts. Try again later.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
    );
  const { data, error } = await db.rpc("wfilemanager_consume_customer_auth_token", {
    p_token_hash: await sha256(token),
    p_purpose: "email_verification",
    p_password_hash: null,
    p_password_salt: null,
    p_password_iterations: null,
  });
  if (error) {
    await rateRecord("customer_email_verification_consume", token.slice(0, 20), ip, false);
    if (String(error.message).includes("invalid_or_expired_token"))
      return json({ error: "This verification link is invalid or expired" }, 400);
    throw error;
  }
  await rateRecord("customer_email_verification_consume", token.slice(0, 20), ip, true);
  return json({ success: true, result: data });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "status";
    if (action === "request-password-reset" && request.method === "POST")
      return requestPasswordReset(request, await request.json().catch(() => ({})));
    if (action === "reset-password" && request.method === "POST")
      return resetPassword(request, await request.json().catch(() => ({})));
    if (action === "resend-verification" && request.method === "POST")
      return resendVerification(request);
    if (action === "verify-email" && request.method === "POST")
      return verifyEmail(request, await request.json().catch(() => ({})));
    if (action === "status")
      return json({
        ok: true,
        passwordReset: true,
        emailVerification: true,
        tokenStorage: "hashed",
      });
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Customer security service failed" },
      500,
    );
  }
});
