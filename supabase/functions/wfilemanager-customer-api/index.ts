import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Cache-Control": "no-store",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const db = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 210000;

type Customer = Record<string, any>;
type Config = {
  subscriptionApi: string;
  priceUsd: number;
  periodDays: number;
  storageQuotaBytes: number;
  usdToXafRate: number;
  camerpayBaseUrl: string;
  camerpayToken: string;
  camerpayMethod: string;
  mailtrapToken: string;
  mailtrapUrl: string;
  fromEmail: string;
  fromName: string;
  supportEmail: string;
  siteUrl: string;
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
function normalizeEmail(value: unknown) {
  return clean(value).toLowerCase();
}
function emailValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function randomHex(length = 16) {
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
async function passwordValid(password: string, customer: Customer) {
  const result = await passwordHash(
    password,
    customer.password_salt,
    Number(customer.password_iterations || 150000),
  );
  return result.hash === customer.password_hash;
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
function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("6")) return `237${digits}`;
  return digits;
}
function reference(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomHex(8).toUpperCase()}`;
}
function pick(payload: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    let current: unknown = payload;
    for (const key of path.split(".")) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    if (current !== undefined && current !== null && clean(current)) return current;
  }
  return undefined;
}
function paymentUrl(payload: Record<string, unknown>) {
  return clean(
    pick(payload, [
      "pay_url",
      "payUrl",
      "payment_url",
      "paymentUrl",
      "checkout_url",
      "checkoutUrl",
      "redirect_url",
      "redirectUrl",
      "url",
      "data.pay_url",
      "data.payment_url",
      "data.checkout_url",
      "data.url",
    ]),
  );
}
function providerReference(payload: Record<string, unknown>) {
  return clean(
    pick(payload, [
      "transaction_uuid",
      "uuid",
      "reference",
      "transaction_id",
      "transactionId",
      "payment_id",
      "data.transaction_uuid",
      "data.uuid",
      "data.reference",
      "data.transaction_id",
    ]),
  );
}
function providerStatus(payload: Record<string, unknown>) {
  return clean(
    pick(payload, [
      "status",
      "payment_status",
      "paymentStatus",
      "data.status",
      "data.payment_status",
    ]),
  ).toLowerCase();
}
function providerAmount(payload: Record<string, unknown>) {
  const number = Number(
    pick(payload, ["amount", "paid_amount", "data.amount", "data.paid_amount"]),
  );
  return Number.isFinite(number) ? number : null;
}
function isPaid(status: string) {
  return [
    "paid",
    "success",
    "successful",
    "completed",
    "approved",
    "confirmed",
    "succeeded",
    "done",
    "vire",
    "viré",
  ].includes(status);
}
function publicCustomer(customer: Customer) {
  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.full_name,
    phone: customer.phone,
    company: customer.company,
    country: customer.country,
    billingAddress: customer.billing_address,
    billingCity: customer.billing_city,
    billingPostalCode: customer.billing_postal_code,
    status: customer.status,
    balanceUsd: money(customer.balance_usd),
    autoRenewDefault: customer.auto_renew_default === true,
    emailVerified: Boolean(customer.email_verified_at),
  };
}
async function loadConfig(): Promise<Config> {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Billing configuration is missing");
  return {
    subscriptionApi: String(
      data.function_url || `${supabaseUrl}/functions/v1/wfilemanager-pro-subscription-api`,
    ).replace(/\/$/, ""),
    priceUsd: Number(data.price_usd || 50),
    periodDays: Number(data.period_days || 365),
    storageQuotaBytes: Number(data.storage_quota_bytes || 104857600),
    usdToXafRate: Number(data.usd_to_xaf_rate || 600),
    camerpayBaseUrl: String(data.camerpay_api_base_url || "https://camerpay.biz").replace(
      /\/$/,
      "",
    ),
    camerpayToken: String(data.camerpay_api_token || ""),
    camerpayMethod: String(data.camerpay_payment_method || "auto"),
    mailtrapToken: String(data.mailtrap_api_token || ""),
    mailtrapUrl: String(data.mailtrap_api_url || "https://send.api.mailtrap.io/api/send"),
    fromEmail: String(data.mailtrap_from_email || "support@kmerhosting.com"),
    fromName: String(data.mailtrap_from_name || "KmerHosting"),
    supportEmail: String(data.support_email || "support@kmerhosting.com"),
    siteUrl: String(data.site_url || "https://wfilemanager.com").replace(/\/$/, ""),
  };
}
async function sendMail(
  config: Config,
  params: {
    email: string;
    name: string;
    subject: string;
    text: string;
    html: string;
    category: string;
  },
) {
  if (!config.mailtrapToken) throw new Error("Mailtrap API token is not configured");
  const response = await fetch(config.mailtrapUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mailtrapToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: config.fromEmail, name: config.fromName },
      to: [{ email: params.email, name: params.name || "Customer" }],
      subject: params.subject,
      text: params.text,
      html: params.html,
      category: params.category,
    }),
  });
  if (!response.ok) throw new Error(`Mailtrap failed (${response.status})`);
}
async function licenceEmail(
  config: Config,
  customer: Customer,
  orderReference: string,
  key: string,
) {
  const name = customer.full_name || "Customer";
  await sendMail(config, {
    email: customer.email,
    name,
    subject: "Your wFileManager Pro licence key",
    text: `Hello ${name},\n\nYour wFileManager Pro licence purchase is confirmed.\n\nLicence key: ${key}\n\nUse this key on the /setup page.\nOrder reference: ${orderReference}\n\nTechnical support: ${config.supportEmail}.`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>Your wFileManager Pro licence key</h2><p>Hello ${name},</p><pre style="padding:12px;background:#f3f4f6;border-radius:8px">${key}</pre><p>Use this key on the <strong>/setup</strong> page.</p><p>Order reference: <strong>${orderReference}</strong></p></body></html>`,
    category: "wfilemanager-wallet-licence",
  });
}
async function renewalEmail(
  config: Config,
  customer: Customer,
  instanceKey: string,
  paidUntil: string,
  balance: number,
) {
  const name = customer.full_name || "Customer";
  await sendMail(config, {
    email: customer.email,
    name,
    subject: "Your wFileManager Pro renewal is confirmed",
    text: `Hello ${name},\n\nYour renewal is confirmed.\n\nInstance: ${instanceKey}\nPaid until: ${paidUntil}\nAccount balance: $${balance.toFixed(2)} USD\n\nNo new licence key is required.`,
    html: `<!doctype html><html><body><h2>wFileManager Pro renewal confirmed</h2><p>Instance: <strong>${instanceKey}</strong></p><p>Paid until: <strong>${paidUntil}</strong></p><p>Account balance: <strong>$${balance.toFixed(2)} USD</strong></p></body></html>`,
    category: "wfilemanager-wallet-renewal",
  });
}
async function topupEmail(
  config: Config,
  customer: Customer,
  amount: number,
  balance: number,
  topupReference: string,
) {
  const name = customer.full_name || "Customer";
  await sendMail(config, {
    email: customer.email,
    name,
    subject: "Your wFileManager account top-up is confirmed",
    text: `Hello ${name},\n\nYour top-up is confirmed.\n\nAmount added: $${amount.toFixed(2)} USD\nNew balance: $${balance.toFixed(2)} USD\nReference: ${topupReference}`,
    html: `<!doctype html><html><body><h2>Account top-up confirmed</h2><p>Amount added: <strong>$${amount.toFixed(2)} USD</strong></p><p>New balance: <strong>$${balance.toFixed(2)} USD</strong></p><p>Reference: <strong>${topupReference}</strong></p></body></html>`,
    category: "wfilemanager-wallet-topup",
  });
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
  if (error) console.warn("Rate-limit update failed", error.message);
}
async function createSession(customerId: string, request: Request) {
  const token = `wfm_${randomHex(32)}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error } = await db.from("wfilemanager_customer_sessions").insert({
    customer_id: customerId,
    token_hash: await sha256(token),
    user_agent: request.headers.get("user-agent") || null,
    ip_address: clientIp(request) || null,
    last_seen_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  if (error) throw error;
  return { token, expiresAt };
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
  await db
    .from("wfilemanager_customer_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return { customer, sessionId: String(data.id) };
}
function profile(body: Record<string, unknown>) {
  return {
    email: normalizeEmail(body.email),
    password: clean(body.password),
    fullName: clean(body.fullName || body.name),
    phone: normalizePhone(clean(body.phone)),
    company: clean(body.company) || null,
    country: clean(body.country),
    billingAddress: clean(body.billingAddress || body.address),
    billingCity: clean(body.billingCity || body.city) || null,
    billingPostalCode: clean(body.billingPostalCode || body.postalCode) || null,
  };
}
function validateProfile(input: ReturnType<typeof profile>, requirePassword = false) {
  if (!emailValid(input.email)) return "A valid email is required";
  if (requirePassword) {
    const error = passwordPolicy(input.password);
    if (error) return error;
  }
  if (input.fullName.length < 2) return "Full name is required";
  if (input.country.length < 2) return "Country is required";
  if (input.billingAddress.length < 4) return "Billing address is required";
  return "";
}

async function register(request: Request, body: Record<string, unknown>) {
  const input = profile(body);
  const validation = validateProfile(input, true);
  if (validation) return json({ error: validation }, 400);
  const ip = clientIp(request);
  const rate = await rateCheck("customer_register", input.email, ip);
  if (rate.allowed === false)
    return json(
      {
        error: "Too many account creation attempts. Try again later.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
    );
  const password = await passwordHash(input.password);
  const { data: customer, error } = await db
    .from("wfilemanager_customer_accounts")
    .insert({
      email: input.email,
      password_hash: password.hash,
      password_salt: password.salt,
      password_iterations: password.iterations,
      full_name: input.fullName,
      phone: input.phone || null,
      company: input.company,
      country: input.country,
      billing_address: input.billingAddress,
      billing_city: input.billingCity,
      billing_postal_code: input.billingPostalCode,
      balance_usd: 0,
      auto_renew_default: false,
    })
    .select("*")
    .single();
  if (error) {
    await rateRecord("customer_register", input.email, ip, false, 8);
    if (String(error.code) === "23505")
      return json({ error: "An account already exists for this email" }, 409);
    throw error;
  }
  await rateRecord("customer_register", input.email, ip, true, 8);
  const session = await createSession(customer.id, request);
  return json(
    { customer: publicCustomer(customer), token: session.token, expiresAt: session.expiresAt },
    201,
  );
}
async function login(request: Request, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  const password = clean(body.password);
  if (!emailValid(email) || !password)
    return json({ error: "Email and password are required" }, 400);
  const ip = clientIp(request);
  const rate = await rateCheck("customer_login", email, ip);
  if (rate.allowed === false)
    return json(
      {
        error: "Too many sign-in attempts. Try again later.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
    );
  const { data: customer, error } = await db
    .from("wfilemanager_customer_accounts")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!customer || customer.status !== "active" || !(await passwordValid(password, customer))) {
    await rateRecord("customer_login", email, ip, false);
    return json({ error: "Invalid email or password" }, 401);
  }
  await rateRecord("customer_login", email, ip, true);
  await db
    .from("wfilemanager_customer_accounts")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", customer.id);
  const session = await createSession(customer.id, request);
  return json({
    customer: publicCustomer(customer),
    token: session.token,
    expiresAt: session.expiresAt,
  });
}
async function logout(request: Request) {
  const current = await authenticate(request);
  if (current)
    await db
      .from("wfilemanager_customer_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", current.sessionId);
  return json({ ok: true });
}
async function updateProfile(request: Request, body: Record<string, unknown>) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const input = profile({ ...body, email: current.customer.email });
  const validation = validateProfile(input, false);
  if (validation) return json({ error: validation }, 400);
  const update: Record<string, unknown> = {
    full_name: input.fullName,
    phone: input.phone || null,
    company: input.company,
    country: input.country,
    billing_address: input.billingAddress,
    billing_city: input.billingCity,
    billing_postal_code: input.billingPostalCode,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.autoRenewDefault === "boolean") update.auto_renew_default = body.autoRenewDefault;
  const { data, error } = await db
    .from("wfilemanager_customer_accounts")
    .update(update)
    .eq("id", current.customer.id)
    .select("*")
    .single();
  if (error) throw error;
  return json({ customer: publicCustomer(data) });
}
async function sessions(request: Request) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  if (request.method === "GET") {
    const { data, error } = await db
      .from("wfilemanager_customer_sessions")
      .select("id,user_agent,ip_address,last_seen_at,created_at,expires_at")
      .eq("customer_id", current.customer.id)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("last_seen_at", { ascending: false });
    if (error) throw error;
    return json({
      sessions: (data || []).map((item) => ({ ...item, current: item.id === current.sessionId })),
    });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.all === true) {
    await db
      .from("wfilemanager_customer_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("customer_id", current.customer.id)
      .is("revoked_at", null);
    return json({ success: true, currentRevoked: true });
  }
  const id = clean(body.id);
  if (!id) return json({ error: "Session id is required" }, 400);
  const { error } = await db
    .from("wfilemanager_customer_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("customer_id", current.customer.id);
  if (error) throw error;
  return json({ success: true, currentRevoked: id === current.sessionId });
}

async function instanceFor(order: any, token: any) {
  const id = token?.claimed_by_instance_id;
  if (id) {
    const { data } = await db
      .from("wfilemanager_instances")
      .select("instance_key,paid_until,subscription_status,data_status,status,auto_renew")
      .eq("id", id)
      .maybeSingle();
    if (data) return data;
  }
  const instanceKey = clean(order.target_instance_key || token?.instance_key);
  if (!instanceKey) return null;
  const { data } = await db
    .from("wfilemanager_instances")
    .select("instance_key,paid_until,subscription_status,data_status,status,auto_renew")
    .eq("instance_key", instanceKey)
    .maybeSingle();
  return data;
}
async function safeOrder(order: any) {
  const token = order.wfilemanager_pro_activation_tokens || null;
  const instance = await instanceFor(order, token);
  let keyStatus = "not_issued";
  if (["payment_pending", "pending"].includes(order.status)) keyStatus = "payment_pending";
  else if (["failed", "cancelled"].includes(order.status)) keyStatus = order.status;
  else if (order.order_type === "renewal")
    keyStatus = order.status === "renewal_applied" ? "renewed" : order.status;
  else if (token?.claimed_at || instance?.paid_until) keyStatus = "activated";
  else if (order.license_key_plain && token?.status === "available") keyStatus = "available";
  else if (order.license_key_plain) keyStatus = token?.status || "issued";
  return {
    orderReference: order.order_reference,
    orderType: order.order_type || "new_licence_key",
    status: order.status,
    keyStatus,
    amountUsd: money(order.amount_usd),
    paymentUrl: order.provider_payment_url,
    paymentMethod: order.provider || "camerpay",
    paidAt: order.paid_at,
    emailSentAt: order.token_email_sent_at,
    emailError: Boolean(order.token_email_error),
    licenceKey: order.license_key_plain || null,
    licenseKey: order.license_key_plain || null,
    activationKey: order.license_key_plain || null,
    keyExpiresAt: keyStatus === "available" ? token?.expires_at || null : null,
    keyInstanceKey:
      instance?.instance_key || token?.instance_key || order.target_instance_key || null,
    paidUntil: order.renewal_paid_until || instance?.paid_until || null,
    subscriptionStatus: instance?.subscription_status || null,
    dataStatus: instance?.data_status || null,
    autoRenew: instance?.auto_renew === true,
    canRenew: Boolean(
      (token?.claimed_at || instance?.paid_until) &&
      (instance?.instance_key || token?.instance_key),
    ),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}
async function dashboard(request: Request) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const config = await loadConfig();
  const { data: customer, error: customerError } = await db
    .from("wfilemanager_customer_accounts")
    .select("*")
    .eq("id", current.customer.id)
    .single();
  if (customerError) throw customerError;
  await db
    .from("wfilemanager_pro_orders")
    .update({ customer_id: customer.id })
    .eq("buyer_email", customer.email)
    .is("customer_id", null);
  const { data: orders, error } = await db
    .from("wfilemanager_pro_orders")
    .select(
      "order_reference,order_type,target_instance_key,status,amount_usd,provider,provider_payment_url,paid_at,token_email_sent_at,token_email_error,license_key_plain,renewal_paid_until,created_at,updated_at,wfilemanager_pro_activation_tokens(status,claimed_at,expires_at,instance_key,claimed_by_instance_id)",
    )
    .eq("buyer_email", customer.email)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const safeOrders = [];
  for (const order of orders || []) safeOrders.push(await safeOrder(order));
  const { data: topups, error: topupError } = await db
    .from("wfilemanager_wallet_topups")
    .select(
      "topup_reference,status,amount_usd,provider_payment_url,paid_at,credited_at,email_error,created_at",
    )
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (topupError) throw topupError;
  const { data: transactions, error: transactionError } = await db
    .from("wfilemanager_wallet_transactions")
    .select("id,transaction_type,amount_usd,balance_after_usd,reference,created_at")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (transactionError) throw transactionError;
  return json({
    customer: publicCustomer(customer),
    wallet: {
      balanceUsd: money(customer.balance_usd),
      currency: "USD",
      autoRenewDefault: customer.auto_renew_default === true,
    },
    plan: {
      name: "wFileManager Pro",
      priceUsd: config.priceUsd,
      currency: "USD",
      periodDays: config.periodDays,
      storageQuotaBytes: config.storageQuotaBytes,
    },
    orders: safeOrders,
    topups: (topups || []).map((item: any) => ({
      reference: item.topup_reference,
      status: item.status,
      amountUsd: money(item.amount_usd),
      paymentUrl: item.provider_payment_url,
      paidAt: item.paid_at,
      creditedAt: item.credited_at,
      emailError: Boolean(item.email_error),
      createdAt: item.created_at,
    })),
    transactions: (transactions || []).map((item: any) => ({
      id: item.id,
      type: item.transaction_type,
      amountUsd: money(item.amount_usd),
      balanceAfterUsd: money(item.balance_after_usd),
      reference: item.reference,
      createdAt: item.created_at,
    })),
  });
}
async function linkOrder(customer: Customer, orderReference: string) {
  if (orderReference)
    await db
      .from("wfilemanager_pro_orders")
      .update({ customer_id: customer.id })
      .eq("order_reference", orderReference)
      .eq("buyer_email", customer.email);
}
async function directCheckout(customer: Customer, body: Record<string, unknown>) {
  const config = await loadConfig();
  const response = await fetch(`${config.subscriptionApi}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      buyerName: customer.full_name,
      buyerEmail: customer.email,
      buyerPhone: customer.phone,
      buyerCompany: customer.company,
      buyerCountry: customer.country,
      billingAddress: customer.billing_address,
      billingCity: customer.billing_city,
      billingPostalCode: customer.billing_postal_code,
      orderType: clean(body.orderType) || "new_licence_key",
      targetInstanceKey: clean(body.targetInstanceKey || body.instanceKey) || undefined,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.orderReference)
    await linkOrder(customer, String(payload.orderReference));
  return json(payload, response.status);
}
async function walletBuy(customer: Customer) {
  const config = await loadConfig();
  const { data, error } = await db.rpc("wfilemanager_wallet_buy_licence", {
    p_customer_id: customer.id,
    p_amount_usd: config.priceUsd,
    p_period_days: config.periodDays,
    p_storage_quota_bytes: config.storageQuotaBytes,
    p_buyer_name: customer.full_name,
    p_buyer_email: customer.email,
    p_buyer_phone: customer.phone || "",
    p_buyer_company: customer.company || "",
    p_buyer_country: customer.country || "",
    p_billing_address: customer.billing_address || "",
    p_billing_city: customer.billing_city || "",
    p_billing_postal_code: customer.billing_postal_code || "",
    p_exchange_rate: config.usdToXafRate,
    p_idempotency_key: `wallet-buy:${customer.id}:${crypto.randomUUID()}`,
  });
  if (error) {
    if (String(error.message).includes("insufficient_balance"))
      return json(
        { error: `Insufficient balance. $${config.priceUsd.toFixed(2)} USD is required.` },
        402,
      );
    throw error;
  }
  const result = data?.[0];
  try {
    await licenceEmail(config, customer, result.order_reference, result.licence_key);
    await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "activation_sent",
        token_email_sent_at: new Date().toISOString(),
        token_email_error: null,
      })
      .eq("id", result.order_id);
  } catch (value) {
    await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "email_failed",
        token_email_error: value instanceof Error ? value.message : "Email failed",
      })
      .eq("id", result.order_id);
  }
  return json({
    success: true,
    paymentMethod: "balance",
    orderReference: result.order_reference,
    licenceKey: result.licence_key,
    balanceUsd: money(result.balance_usd),
  });
}
async function checkout(request: Request) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return clean(body.paymentMode) === "balance"
    ? walletBuy(current.customer)
    : directCheckout(current.customer, { ...body, orderType: "new_licence_key" });
}
async function ownedInstance(customer: Customer, instanceKey: string) {
  const { data: token } = await db
    .from("wfilemanager_pro_activation_tokens")
    .select("id")
    .eq("instance_key", instanceKey)
    .eq("status", "claimed")
    .or(`customer_id.eq.${customer.id},customer_email.eq.${customer.email}`)
    .limit(1)
    .maybeSingle();
  if (!token) return null;
  const { data, error } = await db
    .from("wfilemanager_instances")
    .select("*")
    .eq("instance_key", instanceKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function walletRenew(customer: Customer, instanceKey: string) {
  const config = await loadConfig();
  const instance = await ownedInstance(customer, instanceKey);
  if (!instance) return json({ error: "This instance is not linked to your account" }, 403);
  await db
    .from("wfilemanager_instances")
    .update({ billing_customer_id: customer.id })
    .eq("id", instance.id);
  const orderReference = reference("WFM-REN-WAL");
  const { data: order, error: orderError } = await db
    .from("wfilemanager_pro_orders")
    .insert({
      order_reference: orderReference,
      order_type: "renewal",
      target_instance_key: instanceKey,
      status: "pending",
      customer_id: customer.id,
      buyer_name: customer.full_name,
      buyer_email: customer.email,
      buyer_phone: customer.phone || "",
      buyer_company: customer.company,
      buyer_country: customer.country || "",
      billing_address: customer.billing_address || "",
      billing_city: customer.billing_city,
      billing_postal_code: customer.billing_postal_code,
      amount_usd: config.priceUsd,
      amount_xaf: Math.max(1, Math.round(config.priceUsd * config.usdToXafRate)),
      currency: "USD",
      period_days: config.periodDays,
      storage_quota_bytes: config.storageQuotaBytes,
      provider: "wallet",
      payment_source: "wallet",
      automation_note: "Manual renewal paid from customer USD balance",
    })
    .select("id")
    .single();
  if (orderError) throw orderError;
  const { data, error } = await db.rpc("wfilemanager_wallet_renew_instance", {
    p_customer_id: customer.id,
    p_instance_key: instanceKey,
    p_amount_usd: config.priceUsd,
    p_period_days: config.periodDays,
    p_transaction_type: "renewal_debit",
    p_reference: orderReference,
    p_idempotency_key: `wallet-renew:${order.id}`,
    p_metadata: { order_reference: orderReference, payment_method: "wallet" },
  });
  if (error) {
    await db
      .from("wfilemanager_pro_orders")
      .update({ status: "failed", automation_note: error.message })
      .eq("id", order.id);
    if (String(error.message).includes("insufficient_balance"))
      return json(
        { error: `Insufficient balance. $${config.priceUsd.toFixed(2)} USD is required.` },
        402,
      );
    throw error;
  }
  const result = data?.[0];
  try {
    await renewalEmail(config, customer, instanceKey, result.paid_until, money(result.balance_usd));
    await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "renewal_applied",
        paid_at: new Date().toISOString(),
        renewal_applied_at: new Date().toISOString(),
        renewal_paid_until: result.paid_until,
        token_email_sent_at: new Date().toISOString(),
        token_email_error: null,
      })
      .eq("id", order.id);
  } catch (value) {
    await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "renewal_applied",
        paid_at: new Date().toISOString(),
        renewal_applied_at: new Date().toISOString(),
        renewal_paid_until: result.paid_until,
        token_email_error: value instanceof Error ? value.message : "Email failed",
      })
      .eq("id", order.id);
  }
  return json({
    success: true,
    paymentMethod: "balance",
    status: "renewal_applied",
    orderReference,
    paidUntil: result.paid_until,
    balanceUsd: money(result.balance_usd),
  });
}
async function renew(request: Request) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const instanceKey = clean(body.targetInstanceKey || body.instanceKey);
  if (!instanceKey) return json({ error: "Instance key is required" }, 400);
  return clean(body.paymentMode) === "balance"
    ? walletRenew(current.customer, instanceKey)
    : directCheckout(current.customer, { orderType: "renewal", targetInstanceKey: instanceKey });
}
async function autoRenew(request: Request) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const instanceKey = clean(body.instanceKey || body.targetInstanceKey);
  if (!instanceKey) return json({ error: "Instance key is required" }, 400);
  const instance = await ownedInstance(current.customer, instanceKey);
  if (!instance) return json({ error: "This instance is not linked to your account" }, 403);
  const enabled = body.enabled === true;
  const { error } = await db
    .from("wfilemanager_instances")
    .update({
      billing_customer_id: current.customer.id,
      auto_renew: enabled,
      auto_renew_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", instance.id);
  if (error) throw error;
  return json({ success: true, instanceKey, autoRenew: enabled });
}
async function createPayment(
  config: Config,
  customer: Customer,
  paymentReference: string,
  amountXaf: number,
) {
  const body: Record<string, unknown> = {
    amount: amountXaf,
    currency: "XAF",
    customer_phone: customer.phone,
    customer_name: customer.full_name,
    customer_email: customer.email,
    merchant_invoice_id: paymentReference,
    merchant_callback_url: "https://kmerhosting.com/api/webhooks/camerpay",
    merchant_return_url: `${config.siteUrl}/account?payment=returned&reference=${encodeURIComponent(paymentReference)}`,
    idempotency_key: paymentReference,
    source: "api",
  };
  if (
    ["orange_money", "mtn_momo", "stripe", "paypal"].includes(config.camerpayMethod.toLowerCase())
  )
    body.payment_method = config.camerpayMethod.toLowerCase();
  const response = await fetch(`${config.camerpayBaseUrl}/api/payment/initiate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.camerpayToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      clean(payload.error || payload.message) || `CamerPay failed (${response.status})`,
    );
  const url = paymentUrl(payload);
  if (!url) throw new Error("CamerPay did not return a payment link");
  return { url, providerReference: providerReference(payload), payload };
}
async function topup(request: Request) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const amountUsd = money(body.amountUsd);
  if (amountUsd < 5 || amountUsd > 5000)
    return json({ error: "Top-up amount must be between $5.00 and $5,000.00 USD" }, 400);
  const config = await loadConfig();
  const topupReference = reference("WFM-TOPUP");
  const amountXaf = Math.max(1, Math.round(amountUsd * config.usdToXafRate));
  const { data: row, error } = await db
    .from("wfilemanager_wallet_topups")
    .insert({
      customer_id: current.customer.id,
      topup_reference: topupReference,
      status: "pending",
      amount_usd: amountUsd,
      amount_xaf: amountXaf,
      currency: "USD",
      provider_currency: "XAF",
      exchange_rate: config.usdToXafRate,
    })
    .select("*")
    .single();
  if (error) throw error;
  try {
    const payment = await createPayment(config, current.customer, topupReference, amountXaf);
    await db
      .from("wfilemanager_wallet_topups")
      .update({
        status: "payment_pending",
        provider_reference: payment.providerReference,
        provider_payment_url: payment.url,
        provider_payload: payment.payload,
        next_reconcile_at: new Date(Date.now() + 5 * 60000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return json({
      reference: topupReference,
      status: "payment_pending",
      amountUsd,
      paymentUrl: payment.url,
    });
  } catch (value) {
    await db
      .from("wfilemanager_wallet_topups")
      .update({
        status: "failed",
        reconciliation_error: value instanceof Error ? value.message : "Payment failed",
      })
      .eq("id", row.id);
    throw value;
  }
}
async function topupStatus(request: Request, url: URL) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const topupReference = clean(url.searchParams.get("reference"));
  const config = await loadConfig();
  const { data: found, error } = await db
    .from("wfilemanager_wallet_topups")
    .select("*")
    .eq("customer_id", current.customer.id)
    .eq("topup_reference", topupReference)
    .maybeSingle();
  if (error) throw error;
  if (!found) return json({ error: "Top-up not found" }, 404);
  let row = found;
  if (!["credited", "failed", "cancelled"].includes(row.status) && row.provider_reference) {
    const response = await fetch(
      `${config.camerpayBaseUrl}/api/payment/${row.provider_reference}/status`,
      { headers: { Authorization: `Bearer ${config.camerpayToken}`, Accept: "application/json" } },
    );
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && isPaid(providerStatus(payload))) {
      const amount = providerAmount(payload);
      if (amount === null || amount >= Number(row.amount_xaf)) {
        const paidAt = row.paid_at || new Date().toISOString();
        await db
          .from("wfilemanager_wallet_topups")
          .update({ status: "paid", paid_at: paidAt, status_payload: payload })
          .eq("id", row.id);
        row = { ...row, status: "paid", paid_at: paidAt };
      }
    }
  }
  if (row.status === "paid" && !row.credited_at) {
    const { data: credit, error: creditError } = await db.rpc("wfilemanager_wallet_credit", {
      p_customer_id: current.customer.id,
      p_amount_usd: row.amount_usd,
      p_transaction_type: "topup_credit",
      p_reference: row.topup_reference,
      p_idempotency_key: `topup:${row.id}`,
      p_metadata: { provider: "camerpay", provider_reference: row.provider_reference },
    });
    if (creditError) throw creditError;
    const result = credit?.[0];
    await db
      .from("wfilemanager_wallet_topups")
      .update({
        status: "credited",
        credited_at: new Date().toISOString(),
        wallet_transaction_id: result.transaction_id,
      })
      .eq("id", row.id);
    try {
      await topupEmail(
        config,
        current.customer,
        money(row.amount_usd),
        money(result.balance_usd),
        row.topup_reference,
      );
      await db
        .from("wfilemanager_wallet_topups")
        .update({ email_sent_at: new Date().toISOString(), email_error: null })
        .eq("id", row.id);
    } catch (value) {
      await db
        .from("wfilemanager_wallet_topups")
        .update({ email_error: value instanceof Error ? value.message : "Email failed" })
        .eq("id", row.id);
    }
    return json({
      reference: row.topup_reference,
      status: "credited",
      amountUsd: money(row.amount_usd),
      balanceUsd: money(result.balance_usd),
    });
  }
  const { data: customer } = await db
    .from("wfilemanager_customer_accounts")
    .select("balance_usd")
    .eq("id", current.customer.id)
    .single();
  return json({
    reference: row.topup_reference,
    status: row.status,
    amountUsd: money(row.amount_usd),
    paymentUrl: row.provider_payment_url,
    balanceUsd: money(customer?.balance_usd),
  });
}
async function orderStatus(request: Request, url: URL) {
  const current = await authenticate(request);
  if (!current) return json({ error: "Authentication required" }, 401);
  const orderReference = clean(
    url.searchParams.get("orderReference") || url.searchParams.get("order"),
  );
  if (!orderReference) return json({ error: "Order reference is required" }, 400);
  const config = await loadConfig();
  const response = await fetch(
    `${config.subscriptionApi}/order?${new URLSearchParams({ orderReference, email: current.customer.email })}`,
  );
  const payload = await response.json().catch(() => ({}));
  if (response.ok) await linkOrder(current.customer, orderReference);
  return json(payload, response.status);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "status";
    if (action === "register" && request.method === "POST")
      return register(request, await request.json().catch(() => ({})));
    if (action === "login" && request.method === "POST")
      return login(request, await request.json().catch(() => ({})));
    if (action === "logout" && request.method === "POST") return logout(request);
    if (action === "profile" && ["POST", "PUT"].includes(request.method))
      return updateProfile(request, await request.json().catch(() => ({})));
    if ((action === "dashboard" || action === "me") && request.method === "GET")
      return dashboard(request);
    if (action === "sessions" && ["GET", "DELETE"].includes(request.method))
      return sessions(request);
    if (action === "checkout" && request.method === "POST") return checkout(request);
    if (action === "renew" && request.method === "POST") return renew(request);
    if (action === "auto-renew" && request.method === "POST") return autoRenew(request);
    if (action === "topup" && request.method === "POST") return topup(request);
    if (action === "topup-status" && request.method === "GET") return topupStatus(request, url);
    if (action === "order" && request.method === "GET") return orderStatus(request, url);
    if (action === "status")
      return json({
        ok: true,
        customerAccounts: true,
        secureSessions: true,
        rateLimiting: true,
        licenceKeys: true,
        renewals: true,
        walletUsd: true,
        topups: true,
        autoRenewOptIn: true,
        passwordPolicy: "12+ characters",
      });
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Customer API failed" }, 500);
  }
});
