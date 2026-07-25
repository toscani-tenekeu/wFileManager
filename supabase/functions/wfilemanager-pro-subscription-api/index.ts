import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-camerpay-signature, x-signature, signature",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();
const CAMERPAY_DASHBOARD_CALLBACK_URL = "https://kmerhosting.com/api/webhooks/camerpay";
const CAMERPAY_DASHBOARD_RETURN_URL = "https://kmerhosting.com/payment/top-up/return";

type Config = {
  camerpayApiBaseUrl: string;
  camerpayApiToken: string;
  camerpayPaymentMethod: string;
  mailtrapApiToken: string;
  mailtrapApiUrl: string;
  mailtrapFromEmail: string;
  mailtrapFromName: string;
  siteUrl: string;
  functionUrl: string;
  supportEmail: string;
  priceUsd: number;
  priceXaf: number;
  currency: string;
  storageQuotaBytes: number;
  periodDays: number;
};

type Order = Record<string, any>;
type TokenRow = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function clean(value: unknown) {
  return String(value ?? "").trim();
}
function emailValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes).toUpperCase();
}
async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function loadConfig(): Promise<Config> {
  const { data, error } = await supabase
    .from("wfilemanager_pro_subscription_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("wFileManager Pro subscription configuration is missing");
  return {
    camerpayApiBaseUrl: String(data.camerpay_api_base_url || "https://camerpay.biz").replace(
      /\/$/,
      "",
    ),
    camerpayApiToken: String(data.camerpay_api_token || ""),
    camerpayPaymentMethod: String(data.camerpay_payment_method || "auto"),
    mailtrapApiToken: String(data.mailtrap_api_token || ""),
    mailtrapApiUrl: String(data.mailtrap_api_url || "https://send.api.mailtrap.io/api/send"),
    mailtrapFromEmail: String(data.mailtrap_from_email || "support@kmerhosting.com"),
    mailtrapFromName: String(data.mailtrap_from_name || "KmerHosting"),
    siteUrl: String(data.site_url || "https://wfilemanager.com").replace(/\/$/, ""),
    functionUrl: String(
      data.function_url || `${supabaseUrl}/functions/v1/wfilemanager-pro-subscription-api`,
    ).replace(/\/$/, ""),
    supportEmail: String(data.support_email || "support@kmerhosting.com"),
    priceUsd: Number(data.price_usd || 50),
    priceXaf: Number(data.price_xaf || 30000),
    currency: String(data.currency || "XAF"),
    storageQuotaBytes: Number(data.storage_quota_bytes || 104857600),
    periodDays: Number(data.period_days || 365),
  };
}

function normalizeCameroonPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("6")) return `237${digits}`;
  if (digits.length === 12 && digits.startsWith("237")) return digits;
  return digits;
}
function orderReference(orderType = "new_licence_key") {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix =
    orderType === "renewal" ? "WFM-REN" : orderType === "storage_upgrade" ? "WFM-STO" : "WFM-LIC";
  return `${prefix}-${stamp}-${randomHex(4)}-${randomHex(4)}`;
}
function pick(obj: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    let current: any = obj;
    for (const key of path.split(".")) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (current !== undefined && current !== null && String(current).trim() !== "") return current;
  }
  return undefined;
}
function paymentUrlFrom(payload: Record<string, unknown>) {
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
      "link",
      "data.pay_url",
      "data.payment_url",
      "data.checkout_url",
      "data.redirect_url",
      "data.url",
      "data.link",
    ]),
  );
}
function providerRefFrom(payload: Record<string, unknown>) {
  return clean(
    pick(payload, [
      "transaction_uuid",
      "uuid",
      "reference",
      "transaction_id",
      "transactionId",
      "payment_id",
      "paymentId",
      "data.transaction_uuid",
      "data.uuid",
      "data.reference",
      "data.transaction_id",
      "data.payment_id",
    ]),
  );
}
function invoiceFromPayload(payload: Record<string, unknown>) {
  return clean(
    pick(payload, [
      "merchant_invoice_id",
      "merchantInvoiceId",
      "idempotency_key",
      "invoice_id",
      "invoiceId",
      "order_reference",
      "orderReference",
      "data.merchant_invoice_id",
      "data.merchantInvoiceId",
      "data.idempotency_key",
      "data.invoice_id",
      "data.order_reference",
    ]),
  );
}
function statusFromPayload(payload: Record<string, unknown>) {
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
function amountFromPayload(payload: Record<string, unknown>) {
  const amount = Number(
    pick(payload, ["amount", "paid_amount", "data.amount", "data.paid_amount"]),
  );
  return Number.isFinite(amount) ? amount : null;
}
function isPaidStatus(status: string) {
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
function camerPayError(status: number, payload: Record<string, unknown>) {
  const message = clean(payload.message || payload.error) || `CamerPay failed (${status})`;
  const errors = payload.errors ? ` ${JSON.stringify(payload.errors)}` : "";
  return `CamerPay failed (${status}): ${message}${errors}`;
}

async function createCamerPayLink(config: Config, order: Order) {
  if (!config.camerpayApiToken) throw new Error("CamerPay API token is not configured");
  const body: Record<string, unknown> = {
    amount: order.amount_xaf,
    currency: order.currency,
    customer_phone: order.buyer_phone,
    customer_name: order.buyer_name,
    customer_email: order.buyer_email,
    merchant_invoice_id: order.order_reference,
    merchant_callback_url: CAMERPAY_DASHBOARD_CALLBACK_URL,
    merchant_return_url: CAMERPAY_DASHBOARD_RETURN_URL,
    idempotency_key: order.order_reference,
    source: "api",
  };
  const paymentMethod = config.camerpayPaymentMethod.toLowerCase();
  if (["orange_money", "mtn_momo", "stripe", "paypal"].includes(paymentMethod))
    body.payment_method = paymentMethod;
  const response = await fetch(`${config.camerpayApiBaseUrl}/api/payment/initiate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.camerpayApiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(camerPayError(response.status, payload));
  const paymentUrl = paymentUrlFrom(payload);
  if (!paymentUrl || !/^https?:\/\//i.test(paymentUrl))
    throw new Error("CamerPay did not return a payment link");
  return { payload, paymentUrl, providerReference: providerRefFrom(payload) || null };
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
  if (!config.mailtrapApiToken) throw new Error("Mailtrap API token is not configured");
  const response = await fetch(config.mailtrapApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mailtrapApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: config.mailtrapFromEmail, name: config.mailtrapFromName },
      to: [{ email: params.email, name: params.name || "Customer" }],
      subject: params.subject,
      text: params.text,
      html: params.html,
      category: params.category,
    }),
  });
  const result = await response.text();
  if (!response.ok)
    throw new Error(`Mailtrap failed (${response.status}): ${result.slice(0, 300)}`);
}

async function sendLicenceEmail(
  config: Config,
  params: { email: string; name: string; orderReference: string; licenceKey: string },
) {
  const name = params.name || "Customer";
  const text = `Hello ${name},\n\nYour wFileManager Pro payment is confirmed.\n\nLicence key: ${params.licenceKey}\n\nUse this licence key on the /setup page when installing wFileManager Pro.\n\nOrder reference: ${params.orderReference}\n\nThis key is valid for one Pro installation. If you need help, contact ${config.supportEmail}.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>wFileManager Pro licence key</h2><p>Hello ${name},</p><p>Your wFileManager Pro payment is confirmed.</p><p><strong>Licence key</strong></p><pre style="padding:12px;background:#f3f4f6;border-radius:8px;font-size:16px">${params.licenceKey}</pre><p>Use this licence key on the <strong>/setup</strong> page when installing wFileManager Pro.</p><p>Order reference: <strong>${params.orderReference}</strong></p><p>This key is valid for one Pro installation.</p><p>Support: <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></p></body></html>`;
  await sendMail(config, {
    email: params.email,
    name,
    subject: "Your wFileManager Pro licence key",
    text,
    html,
    category: "wfilemanager-pro-licence-key",
  });
}

async function sendRenewalEmail(
  config: Config,
  params: {
    email: string;
    name: string;
    orderReference: string;
    instanceKey: string;
    paidUntil: string;
  },
) {
  const name = params.name || "Customer";
  const text = `Hello ${name},\n\nYour wFileManager Pro renewal is confirmed.\n\nInstance: ${params.instanceKey}\nPaid until: ${params.paidUntil}\nOrder reference: ${params.orderReference}\n\nYou do not need a new licence key for renewal. If you need help, contact ${config.supportEmail}.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>wFileManager Pro renewal confirmed</h2><p>Hello ${name},</p><p>Your wFileManager Pro renewal is confirmed.</p><p><strong>Instance:</strong> ${params.instanceKey}</p><p><strong>Paid until:</strong> ${params.paidUntil}</p><p><strong>Order reference:</strong> ${params.orderReference}</p><p>You do not need a new licence key for renewal.</p><p>Support: <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></p></body></html>`;
  await sendMail(config, {
    email: params.email,
    name,
    subject: "Your wFileManager Pro renewal is confirmed",
    text,
    html,
    category: "wfilemanager-pro-renewal",
  });
}

async function customerOwnsInstance(buyerEmail: string, instanceKey: string) {
  const { data, error } = await supabase
    .from("wfilemanager_pro_activation_tokens")
    .select("id")
    .eq("customer_email", buyerEmail)
    .eq("instance_key", instanceKey)
    .eq("status", "claimed")
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function checkout(config: Config, body: Record<string, unknown>) {
  const buyerName = clean(body.buyerName || body.name);
  const buyerEmail = clean(body.buyerEmail || body.email).toLowerCase();
  const buyerPhone = normalizeCameroonPhone(clean(body.buyerPhone || body.phone));
  const buyerCompany = clean(body.buyerCompany || body.company) || null;
  const buyerCountry = clean(body.buyerCountry || body.country);
  const billingAddress = clean(body.billingAddress || body.address);
  const billingCity = clean(body.billingCity || body.city) || null;
  const billingPostalCode = clean(body.billingPostalCode || body.postalCode) || null;
  const orderType = ["renewal", "storage_upgrade"].includes(clean(body.orderType))
    ? clean(body.orderType)
    : "new_licence_key";
  const targetInstanceKey = clean(body.targetInstanceKey || body.instanceKey) || null;
  if (buyerName.length < 2) return json({ error: "Buyer name is required" }, 400);
  if (!emailValid(buyerEmail)) return json({ error: "A valid billing email is required" }, 400);
  if (buyerPhone.length < 9) return json({ error: "Buyer phone is required" }, 400);
  if (buyerCountry.length < 2) return json({ error: "Buyer country is required" }, 400);
  if (billingAddress.length < 4) return json({ error: "Billing address is required" }, 400);
  if (orderType === "renewal") {
    if (!targetInstanceKey) return json({ error: "Instance key is required for renewal" }, 400);
    if (!(await customerOwnsInstance(buyerEmail, targetInstanceKey)))
      return json({ error: "This instance is not linked to your customer account" }, 403);
  }
  const reference = orderReference(orderType);
  const { data: order, error } = await supabase
    .from("wfilemanager_pro_orders")
    .insert({
      order_reference: reference,
      order_type: orderType,
      target_instance_key: targetInstanceKey,
      status: "pending",
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      buyer_phone: buyerPhone,
      buyer_company: buyerCompany,
      buyer_country: buyerCountry,
      billing_address: billingAddress,
      billing_city: billingCity,
      billing_postal_code: billingPostalCode,
      amount_usd: config.priceUsd,
      amount_xaf: config.priceXaf,
      currency: config.currency,
      period_days: config.periodDays,
      storage_quota_bytes: config.storageQuotaBytes,
    })
    .select("*")
    .single();
  if (error) throw error;
  try {
    const payment = await createCamerPayLink(config, order);
    const { error: updateError } = await supabase
      .from("wfilemanager_pro_orders")
      .update({
        status: "payment_pending",
        provider_reference: payment.providerReference,
        provider_payment_url: payment.paymentUrl,
        provider_payload: payment.payload,
      })
      .eq("id", order.id);
    if (updateError) throw updateError;
    return json({
      orderReference: reference,
      orderType,
      targetInstanceKey,
      paymentUrl: payment.paymentUrl,
      amountUsd: config.priceUsd,
      amountXaf: config.priceXaf,
      currency: config.currency,
      status: "payment_pending",
    });
  } catch (error) {
    await supabase
      .from("wfilemanager_pro_orders")
      .update({
        status: "failed",
        provider_payload: {
          error: error instanceof Error ? error.message : "Payment link generation failed",
        },
      })
      .eq("id", order.id);
    throw error;
  }
}

async function updatePaymentFromPayload(order: Order, payload: Record<string, unknown>) {
  const paymentStatus = statusFromPayload(payload);
  const paidAmount = amountFromPayload(payload);
  const amountOk = paidAmount === null || paidAmount >= Number(order.amount_xaf || 0);
  const paid = isPaidStatus(paymentStatus) && amountOk;
  await supabase
    .from("wfilemanager_pro_orders")
    .update({
      webhook_payload: payload,
      provider_reference: providerRefFrom(payload) || order.provider_reference,
      status: paid ? "paid" : order.status,
      paid_at: paid ? order.paid_at || new Date().toISOString() : order.paid_at,
    })
    .eq("id", order.id);
  return paid;
}
async function refreshFromCamerPay(config: Config, order: Order) {
  if (!order.provider_reference) return order;
  if (
    ["activation_sent", "email_failed", "renewal_applied", "upgrade_applied"].includes(
      String(order.status),
    )
  )
    return order;
  const response = await fetch(
    `${config.camerpayApiBaseUrl}/api/payment/${order.provider_reference}/status`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${config.camerpayApiToken}`, Accept: "application/json" },
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    await supabase
      .from("wfilemanager_pro_orders")
      .update({
        webhook_payload: {
          status_check_error: camerPayError(response.status, payload),
          status_check_payload: payload,
        },
      })
      .eq("id", order.id);
    return order;
  }
  await updatePaymentFromPayload(order, payload);
  const { data: refreshed, error } = await supabase
    .from("wfilemanager_pro_orders")
    .select("*")
    .eq("id", order.id)
    .single();
  if (error) throw error;
  return refreshed;
}

async function reissueFromOldUnclaimedToken(order: Order) {
  if (!order.activation_token_id || order.license_key_plain) return false;
  const { data: oldToken, error } = await supabase
    .from("wfilemanager_pro_activation_tokens")
    .select("id,status,claimed_at,claimed_by_instance_id")
    .eq("id", order.activation_token_id)
    .maybeSingle();
  if (error) throw error;
  if (
    !oldToken ||
    oldToken.claimed_at ||
    oldToken.claimed_by_instance_id ||
    oldToken.status === "claimed"
  )
    return false;
  await supabase
    .from("wfilemanager_pro_activation_tokens")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", oldToken.id);
  await supabase
    .from("wfilemanager_pro_orders")
    .update({
      activation_token_id: null,
      token_email_sent_at: null,
      token_email_error: null,
      status: "paid",
    })
    .eq("id", order.id);
  return true;
}

async function issueLicenceKeyOnce(config: Config, order: Order) {
  if (order.activation_token_id && !order.license_key_plain) {
    const reissued = await reissueFromOldUnclaimedToken(order);
    if (reissued) {
      const { data: reload, error } = await supabase
        .from("wfilemanager_pro_orders")
        .select("*")
        .eq("id", order.id)
        .single();
      if (error) throw error;
      order = reload;
    }
  }
  if (order.activation_token_id || order.license_key_plain) {
    if (order.license_key_plain && !order.token_email_sent_at && !order.token_email_error) {
      try {
        await sendLicenceEmail(config, {
          email: order.buyer_email,
          name: order.buyer_name,
          orderReference: order.order_reference,
          licenceKey: order.license_key_plain,
        });
        await supabase
          .from("wfilemanager_pro_orders")
          .update({
            status: "activation_sent",
            token_email_sent_at: new Date().toISOString(),
            token_email_error: null,
          })
          .eq("id", order.id);
      } catch (error) {
        await supabase
          .from("wfilemanager_pro_orders")
          .update({
            status: "email_failed",
            token_email_error: error instanceof Error ? error.message : "Email failed",
          })
          .eq("id", order.id);
      }
    }
    return;
  }
  const licenceKey = `WFM-LIC-${randomHex(3)}-${randomHex(3)}-${randomHex(3)}-${randomHex(3)}`;
  const tokenHash = await sha256(licenceKey);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { data: token, error: tokenError } = await supabase
    .from("wfilemanager_pro_activation_tokens")
    .insert({
      token_hash: tokenHash,
      status: "available",
      period_days: order.period_days,
      storage_quota_bytes: order.storage_quota_bytes,
      customer_email: order.buyer_email,
      order_reference: order.order_reference,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (tokenError) throw tokenError;
  await supabase
    .from("wfilemanager_pro_orders")
    .update({
      activation_token_id: token.id,
      license_key_plain: licenceKey,
      license_key_issued_at: now,
      status: "paid",
      paid_at: order.paid_at || now,
      token_email_error: null,
    })
    .eq("id", order.id);
  try {
    await sendLicenceEmail(config, {
      email: order.buyer_email,
      name: order.buyer_name,
      orderReference: order.order_reference,
      licenceKey,
    });
    await supabase
      .from("wfilemanager_pro_orders")
      .update({
        status: "activation_sent",
        token_email_sent_at: new Date().toISOString(),
        token_email_error: null,
      })
      .eq("id", order.id);
  } catch (error) {
    await supabase
      .from("wfilemanager_pro_orders")
      .update({
        status: "email_failed",
        token_email_error: error instanceof Error ? error.message : "Email failed",
      })
      .eq("id", order.id);
  }
}

async function applyRenewal(config: Config, order: Order) {
  if (order.renewal_applied_at) return;
  const instanceKey = clean(order.target_instance_key);
  if (!instanceKey) throw new Error("Renewal target instance is missing");
  const { data: instance, error } = await supabase
    .from("wfilemanager_instances")
    .select("id,instance_key,paid_until")
    .eq("instance_key", instanceKey)
    .maybeSingle();
  if (error) throw error;
  if (!instance) throw new Error("Renewal target instance was not found");
  const base =
    instance.paid_until && new Date(instance.paid_until).getTime() > Date.now()
      ? new Date(instance.paid_until)
      : new Date();
  const paidUntil = new Date(
    base.getTime() + Number(order.period_days || config.periodDays) * 24 * 60 * 60 * 1000,
  ).toISOString();
  await supabase
    .from("wfilemanager_instances")
    .update({
      paid_until: paidUntil,
      subscription_status: "active",
      data_status: "active",
      status: "active",
      past_due_at: null,
      suspended_at: null,
      delete_after_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", instance.id);
  try {
    await sendRenewalEmail(config, {
      email: order.buyer_email,
      name: order.buyer_name,
      orderReference: order.order_reference,
      instanceKey,
      paidUntil,
    });
    await supabase
      .from("wfilemanager_pro_orders")
      .update({
        status: "renewal_applied",
        renewal_applied_at: new Date().toISOString(),
        renewal_paid_until: paidUntil,
        token_email_sent_at: new Date().toISOString(),
        token_email_error: null,
      })
      .eq("id", order.id);
  } catch (error) {
    await supabase
      .from("wfilemanager_pro_orders")
      .update({
        status: "email_failed",
        renewal_applied_at: new Date().toISOString(),
        renewal_paid_until: paidUntil,
        token_email_error: error instanceof Error ? error.message : "Email failed",
      })
      .eq("id", order.id);
  }
}

async function instanceFor(order: Order, token: TokenRow | null) {
  const claimedId = token?.claimed_by_instance_id ? String(token.claimed_by_instance_id) : "";
  const instanceKey = clean(order.target_instance_key || token?.instance_key);
  if (claimedId) {
    const { data } = await supabase
      .from("wfilemanager_instances")
      .select("instance_key,paid_until,subscription_status,data_status,status")
      .eq("id", claimedId)
      .maybeSingle();
    if (data) return data;
  }
  if (instanceKey) {
    const { data } = await supabase
      .from("wfilemanager_instances")
      .select("instance_key,paid_until,subscription_status,data_status,status")
      .eq("instance_key", instanceKey)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}
async function publicOrder(order: Order) {
  const { data: fresh, error } = await supabase
    .from("wfilemanager_pro_orders")
    .select(
      "*, wfilemanager_pro_activation_tokens(status,claimed_at,expires_at,instance_key,claimed_by_instance_id)",
    )
    .eq("id", order.id)
    .single();
  if (error) throw error;
  const token = fresh.wfilemanager_pro_activation_tokens || null;
  const instance = await instanceFor(fresh, token);
  const isActivated = Boolean(token?.claimed_at || instance?.paid_until);
  return {
    orderReference: fresh.order_reference,
    orderType: fresh.order_type || "new_licence_key",
    status: fresh.status,
    amountUsd: fresh.amount_usd,
    amountXaf: fresh.amount_xaf,
    currency: fresh.currency,
    paymentUrl: fresh.provider_payment_url,
    paidAt: fresh.paid_at,
    emailSentAt: fresh.token_email_sent_at,
    emailError: Boolean(fresh.token_email_error),
    licenceKey: fresh.license_key_plain || null,
    activationKey: fresh.license_key_plain || null,
    licenseKey: fresh.license_key_plain || null,
    keyStatus: token?.status || null,
    keyActivated: isActivated,
    keyClaimedAt: token?.claimed_at || null,
    keyExpiresAt: token?.expires_at || null,
    keyInstanceKey:
      instance?.instance_key || token?.instance_key || fresh.target_instance_key || null,
    paidUntil: fresh.renewal_paid_until || instance?.paid_until || null,
    subscriptionStatus: instance?.subscription_status || null,
    dataStatus: instance?.data_status || null,
    createdAt: fresh.created_at,
    updatedAt: fresh.updated_at,
  };
}

async function orderStatus(config: Config, url: URL) {
  const reference = clean(url.searchParams.get("orderReference") || url.searchParams.get("order"));
  const email = clean(url.searchParams.get("email")).toLowerCase();
  if (!reference || !emailValid(email))
    return json({ error: "Order reference and billing email are required" }, 400);
  const { data: found, error } = await supabase
    .from("wfilemanager_pro_orders")
    .select("*")
    .eq("order_reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!found || String(found.buyer_email).toLowerCase() !== email)
    return json({ error: "Order not found" }, 404);
  let order = await refreshFromCamerPay(config, found);
  if (String(order.status) === "paid") {
    if (String(order.order_type || "new_licence_key") === "renewal")
      await applyRenewal(config, order);
    else await issueLicenceKeyOnce(config, order);
    const reload = await supabase
      .from("wfilemanager_pro_orders")
      .select("*")
      .eq("id", order.id)
      .single();
    if (reload.error) throw reload.error;
    order = reload.data;
  }
  return json(await publicOrder(order));
}
async function parseWebhook(request: Request, rawBody: string) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json"))
    return JSON.parse(rawBody || "{}") as Record<string, unknown>;
  return Object.fromEntries(new URLSearchParams(rawBody).entries()) as Record<string, unknown>;
}
async function webhook(_config: Config, request: Request, rawBody: string) {
  const payload = await parseWebhook(request, rawBody);
  const reference = invoiceFromPayload(payload);
  if (!reference)
    return json({ success: true, ignored: true, reason: "missing_invoice_reference" });
  const { data: order, error } = await supabase
    .from("wfilemanager_pro_orders")
    .select("*")
    .eq("order_reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!order) return json({ success: true, ignored: true, reason: "order_not_found" });
  await supabase
    .from("wfilemanager_pro_orders")
    .update({
      webhook_payload: payload,
      provider_reference: providerRefFrom(payload) || order.provider_reference,
    })
    .eq("id", order.id);
  return json({ success: true, webhookOnly: true, orderReference: reference });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "status";
    const config = await loadConfig();
    if (action === "checkout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return await checkout(
        config,
        (await request.json().catch(() => ({}))) as Record<string, unknown>,
      );
    }
    if (action === "order") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      return await orderStatus(config, url);
    }
    if (action === "webhook") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return await webhook(config, request, await request.text());
    }
    if (action === "status")
      return json({ ok: true, webhookRequired: false, licenceKeys: true, renewals: true });
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Subscription API failed" }, 500);
  }
});
