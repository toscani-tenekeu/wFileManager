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
const TIMEOUT_MS = 30_000;

type Row = Record<string, any>;
type Config = {
  subscriptionApi: string;
  priceUsd: number;
  priceXaf: number;
  periodDays: number;
  storageQuotaBytes: number;
  usdToXafRate: number;
  camerpayBaseUrl: string;
  camerpayToken: string;
  camerpayMethod: string;
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
function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function randomHex(length = 8) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return hex(bytes).toUpperCase();
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function bearer(request: Request) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
function pick(payload: Row, paths: string[]) {
  for (const item of paths) {
    let current: unknown = payload;
    for (const key of item.split(".")) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Row)[key];
    }
    if (current !== undefined && current !== null && clean(current)) return current;
  }
  return undefined;
}
function paymentStatus(payload: Row) {
  return clean(
    pick(payload, ["status", "payment_status", "paymentStatus", "data.status", "data.payment_status"]),
  ).toLowerCase();
}
function paymentAmount(payload: Row) {
  const value = Number(pick(payload, ["amount", "paid_amount", "data.amount", "data.paid_amount"]));
  return Number.isFinite(value) ? value : null;
}
function paymentCurrency(payload: Row) {
  return clean(
    pick(payload, ["currency", "paid_currency", "data.currency", "data.paid_currency"]),
  ).toUpperCase();
}
function paymentInvoice(payload: Row) {
  return clean(
    pick(payload, [
      "merchant_invoice_id",
      "merchantInvoiceId",
      "invoice_id",
      "invoiceId",
      "idempotency_key",
      "data.merchant_invoice_id",
      "data.merchantInvoiceId",
      "data.invoice_id",
      "data.idempotency_key",
    ]),
  );
}
function paymentReference(payload: Row) {
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
function paymentLink(payload: Row) {
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
function isPaid(value: string) {
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
  ].includes(value);
}
function operationKey(body: Row, action: string, customerId: string, suffix = "") {
  const supplied = clean(body.idempotencyKey);
  const clientKey = /^[A-Za-z0-9._:-]{16,128}$/.test(supplied)
    ? supplied
    : `window-${Math.floor(Date.now() / 300000)}-${action}-${suffix || "default"}`;
  return `${customerId}:${clientKey}`;
}
function reference(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomHex(8)}`;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => ({}))) as Row;
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function loadConfig(): Promise<Config> {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Billing configuration is missing");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return {
    subscriptionApi: clean(
      data.function_url || `${supabaseUrl}/functions/v1/wfilemanager-pro-subscription-api`,
    ).replace(/\/$/, ""),
    priceUsd: Number(data.price_usd || 50),
    priceXaf: Number(
      data.price_xaf ||
        Math.round(Number(data.price_usd || 50) * Number(data.usd_to_xaf_rate || 600)),
    ),
    periodDays: Number(data.period_days || 365),
    storageQuotaBytes: Number(data.storage_quota_bytes || 104857600),
    usdToXafRate: Number(data.usd_to_xaf_rate || 600),
    camerpayBaseUrl: clean(data.camerpay_api_base_url || "https://camerpay.biz").replace(/\/$/, ""),
    camerpayToken: clean(data.camerpay_api_token),
    camerpayMethod: clean(data.camerpay_payment_method || "auto"),
    siteUrl: clean(data.site_url || "https://wfilemanager.com").replace(/\/$/, ""),
  };
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
  const customer = data?.wfilemanager_customer_accounts as Row | undefined;
  if (!customer || customer.status !== "active") return null;
  await db
    .from("wfilemanager_customer_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return customer;
}
function requireVerified(customer: Row) {
  if (!customer.email_verified_at)
    throw Object.assign(new Error("Verify your email address before making financial changes"), {
      status: 403,
    });
}
async function ownsInstance(customerId: string, instanceKey: string) {
  const { data, error } = await db.rpc("wfilemanager_customer_owns_instance", {
    p_customer_id: customerId,
    p_instance_key: instanceKey,
  });
  if (error) throw error;
  return data === true;
}

async function initiatePayment(
  config: Config,
  customer: Row,
  invoiceReference: string,
  amountXaf: number,
) {
  if (!config.camerpayToken) throw new Error("CamerPay API token is not configured");
  const requestBody: Row = {
    amount: amountXaf,
    currency: "XAF",
    customer_phone: customer.phone,
    customer_name: customer.full_name,
    customer_email: customer.email,
    merchant_invoice_id: invoiceReference,
    merchant_callback_url: "https://kmerhosting.com/api/webhooks/camerpay",
    merchant_return_url: `${config.siteUrl}/account?payment=returned&reference=${encodeURIComponent(invoiceReference)}`,
    idempotency_key: invoiceReference,
    source: "api",
  };
  if (
    ["orange_money", "mtn_momo", "stripe", "paypal"].includes(
      config.camerpayMethod.toLowerCase(),
    )
  )
    requestBody.payment_method = config.camerpayMethod.toLowerCase();
  const { response, payload } = await fetchJson(`${config.camerpayBaseUrl}/api/payment/initiate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.camerpayToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok)
    throw new Error(
      clean(payload.error || payload.message) || `CamerPay failed (${response.status})`,
    );
  const url = paymentLink(payload);
  const providerReference = paymentReference(payload);
  if (!/^https:\/\//i.test(url)) throw new Error("CamerPay did not return a secure payment link");
  if (!providerReference) throw new Error("CamerPay did not return a transaction reference");
  return { url, providerReference, payload };
}

async function verifyPayment(
  config: Config,
  row: Row,
  referenceField: "order_reference" | "topup_reference",
) {
  if (!row.provider_reference) return { paid: false as const };
  const { response, payload } = await fetchJson(
    `${config.camerpayBaseUrl}/api/payment/${encodeURIComponent(row.provider_reference)}/status`,
    { headers: { Authorization: `Bearer ${config.camerpayToken}`, Accept: "application/json" } },
  );
  if (!response.ok)
    throw new Error(
      clean(payload.error || payload.message) || `CamerPay status failed (${response.status})`,
    );
  const status = paymentStatus(payload);
  if (!isPaid(status)) return { paid: false as const, payload, status };
  const amount = paymentAmount(payload);
  const currency = paymentCurrency(payload);
  const invoice = paymentInvoice(payload);
  const providerReference = paymentReference(payload);
  if (amount === null || Math.abs(amount - Number(row.amount_xaf || 0)) > 0.01)
    throw new Error("CamerPay amount does not exactly match the expected XAF amount");
  if (currency !== "XAF") throw new Error("CamerPay currency does not match XAF");
  if (!invoice || invoice !== clean(row[referenceField]))
    throw new Error("CamerPay merchant invoice reference does not match");
  if (providerReference && providerReference !== clean(row.provider_reference))
    throw new Error("CamerPay transaction reference does not match");
  return { paid: true as const, payload, amount, currency, invoice };
}

async function findOrder(customerId: string, key: string) {
  const { data, error } = await db
    .from("wfilemanager_pro_orders")
    .select("*")
    .eq("customer_id", customerId)
    .eq("client_idempotency_key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function directOrder(
  config: Config,
  customer: Row,
  orderType: "new_licence_key" | "renewal",
  instanceKey: string | null,
  key: string,
) {
  let order = await findOrder(customer.id, key);
  if (order?.provider_payment_url && !["failed", "cancelled"].includes(order.status))
    return json({
      orderReference: order.order_reference,
      orderType: order.order_type,
      targetInstanceKey: order.target_instance_key,
      paymentUrl: order.provider_payment_url,
      amountUsd: money(order.amount_usd),
      amountXaf: Number(order.amount_xaf),
      currency: "USD",
      status: order.status,
      idempotentReplay: true,
    });

  if (!order) {
    const { data, error } = await db
      .from("wfilemanager_pro_orders")
      .insert({
        order_reference: reference(orderType === "renewal" ? "WFM-REN" : "WFM-LIC"),
        order_type: orderType,
        target_instance_key: instanceKey,
        status: "pending",
        customer_id: customer.id,
        client_idempotency_key: key,
        buyer_name: customer.full_name,
        buyer_email: customer.email,
        buyer_phone: customer.phone || "",
        buyer_company: customer.company,
        buyer_country: customer.country || "",
        billing_address: customer.billing_address || "",
        billing_city: customer.billing_city,
        billing_postal_code: customer.billing_postal_code,
        amount_usd: config.priceUsd,
        amount_xaf: config.priceXaf,
        currency: "USD",
        provider_currency: "XAF",
        period_days: config.periodDays,
        storage_quota_bytes: config.storageQuotaBytes,
        provider: "camerpay",
        payment_source: "camerpay",
      })
      .select("*")
      .single();
    if (error) {
      if (String(error.code) !== "23505") throw error;
      order = await findOrder(customer.id, key);
      if (!order) throw error;
    } else order = data;
  } else {
    const { data, error } = await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "pending",
        provider_reference: null,
        provider_payment_url: null,
        reconciliation_error: null,
      })
      .eq("id", order.id)
      .select("*")
      .single();
    if (error) throw error;
    order = data;
  }

  try {
    const payment = await initiatePayment(
      config,
      customer,
      order.order_reference,
      Number(order.amount_xaf),
    );
    const { data, error } = await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "payment_pending",
        provider_reference: payment.providerReference,
        provider_payment_url: payment.url,
        provider_payload: payment.payload,
        next_reconcile_at: new Date(Date.now() + 5 * 60000).toISOString(),
        reconciliation_error: null,
      })
      .eq("id", order.id)
      .select("*")
      .single();
    if (error) throw error;
    return json({
      orderReference: data.order_reference,
      orderType: data.order_type,
      targetInstanceKey: data.target_instance_key,
      paymentUrl: data.provider_payment_url,
      amountUsd: money(data.amount_usd),
      amountXaf: Number(data.amount_xaf),
      currency: "USD",
      status: data.status,
    });
  } catch (error) {
    await db
      .from("wfilemanager_pro_orders")
      .update({
        status: "failed",
        reconciliation_error: error instanceof Error ? error.message : "Payment initiation failed",
      })
      .eq("id", order.id);
    throw error;
  }
}

async function walletBuy(config: Config, customer: Row, key: string) {
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
    p_idempotency_key: `wallet-buy:${key}`,
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
  if (!result) throw new Error("Wallet purchase did not return a result");
  return json({
    success: true,
    paymentMethod: "balance",
    orderReference: result.order_reference,
    licenceKey: result.licence_key,
    balanceUsd: money(result.balance_usd),
    idempotentReplay: Boolean(result.already_applied),
  });
}

async function walletRenew(config: Config, customer: Row, instanceKey: string, key: string) {
  let order = await findOrder(customer.id, key);
  if (order?.status === "renewal_applied")
    return json({
      success: true,
      paymentMethod: "balance",
      status: order.status,
      orderReference: order.order_reference,
      paidUntil: order.renewal_paid_until,
      idempotentReplay: true,
    });
  if (!order) {
    const { data, error } = await db
      .from("wfilemanager_pro_orders")
      .insert({
        order_reference: reference("WFM-REN-WAL"),
        order_type: "renewal",
        target_instance_key: instanceKey,
        status: "pending",
        customer_id: customer.id,
        client_idempotency_key: key,
        buyer_name: customer.full_name,
        buyer_email: customer.email,
        buyer_phone: customer.phone || "",
        buyer_company: customer.company,
        buyer_country: customer.country || "",
        billing_address: customer.billing_address || "",
        billing_city: customer.billing_city,
        billing_postal_code: customer.billing_postal_code,
        amount_usd: config.priceUsd,
        amount_xaf: config.priceXaf,
        currency: "USD",
        provider_currency: "XAF",
        period_days: config.periodDays,
        storage_quota_bytes: config.storageQuotaBytes,
        provider: "wallet",
        payment_source: "wallet",
      })
      .select("*")
      .single();
    if (error) throw error;
    order = data;
  }
  const { data, error } = await db.rpc("wfilemanager_wallet_renew_instance", {
    p_customer_id: customer.id,
    p_instance_key: instanceKey,
    p_amount_usd: config.priceUsd,
    p_period_days: config.periodDays,
    p_transaction_type: "renewal_debit",
    p_reference: order.order_reference,
    p_idempotency_key: `wallet-renew:${key}`,
    p_metadata: { order_reference: order.order_reference, payment_method: "wallet" },
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
  await db
    .from("wfilemanager_pro_orders")
    .update({
      status: "renewal_applied",
      paid_at: new Date().toISOString(),
      renewal_applied_at: new Date().toISOString(),
      renewal_paid_until: result.paid_until,
    })
    .eq("id", order.id);
  return json({
    success: true,
    paymentMethod: "balance",
    status: "renewal_applied",
    orderReference: order.order_reference,
    paidUntil: result.paid_until,
    balanceUsd: money(result.balance_usd),
    idempotentReplay: Boolean(result.already_applied),
  });
}

async function topup(config: Config, customer: Row, body: Row, key: string) {
  const amountUsd = money(body.amountUsd);
  if (amountUsd < 5 || amountUsd > 5000)
    return json({ error: "Top-up amount must be between $5.00 and $5,000.00 USD" }, 400);
  const { data: existing, error: existingError } = await db
    .from("wfilemanager_wallet_topups")
    .select("*")
    .eq("customer_id", customer.id)
    .eq("client_idempotency_key", key)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.provider_payment_url && !["failed", "cancelled"].includes(existing.status))
    return json({
      reference: existing.topup_reference,
      status: existing.status,
      amountUsd: money(existing.amount_usd),
      paymentUrl: existing.provider_payment_url,
      idempotentReplay: true,
    });
  let row = existing;
  if (!row) {
    const { data, error } = await db
      .from("wfilemanager_wallet_topups")
      .insert({
        customer_id: customer.id,
        client_idempotency_key: key,
        topup_reference: reference("WFM-TOPUP"),
        status: "pending",
        amount_usd: amountUsd,
        amount_xaf: Math.max(1, Math.round(amountUsd * config.usdToXafRate)),
        currency: "USD",
        provider_currency: "XAF",
        exchange_rate: config.usdToXafRate,
      })
      .select("*")
      .single();
    if (error) throw error;
    row = data;
  } else {
    const { data, error } = await db
      .from("wfilemanager_wallet_topups")
      .update({
        status: "pending",
        provider_reference: null,
        provider_payment_url: null,
        reconciliation_error: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw error;
    row = data;
  }
  try {
    const payment = await initiatePayment(
      config,
      customer,
      row.topup_reference,
      Number(row.amount_xaf),
    );
    const { data, error } = await db
      .from("wfilemanager_wallet_topups")
      .update({
        status: "payment_pending",
        provider_reference: payment.providerReference,
        provider_payment_url: payment.url,
        provider_payload: payment.payload,
        next_reconcile_at: new Date(Date.now() + 5 * 60000).toISOString(),
        reconciliation_error: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw error;
    return json({
      reference: data.topup_reference,
      status: data.status,
      amountUsd,
      paymentUrl: data.provider_payment_url,
    });
  } catch (error) {
    await db
      .from("wfilemanager_wallet_topups")
      .update({
        status: "failed",
        reconciliation_error: error instanceof Error ? error.message : "Payment failed",
      })
      .eq("id", row.id);
    throw error;
  }
}

async function topupStatus(config: Config, customer: Row, url: URL) {
  const reference = clean(url.searchParams.get("reference"));
  const { data: found, error } = await db
    .from("wfilemanager_wallet_topups")
    .select("*")
    .eq("customer_id", customer.id)
    .eq("topup_reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!found) return json({ error: "Top-up not found" }, 404);
  let row = found;
  if (!["credited", "failed", "cancelled"].includes(row.status)) {
    const verification = await verifyPayment(config, row, "topup_reference");
    if (verification.paid) {
      const paidAt = row.paid_at || new Date().toISOString();
      await db
        .from("wfilemanager_wallet_topups")
        .update({
          status: "paid",
          paid_at: paidAt,
          status_payload: verification.payload,
          reconciliation_error: null,
        })
        .eq("id", row.id);
      row = { ...row, status: "paid", paid_at: paidAt };
    }
  }
  if (row.status === "paid" && !row.credited_at) {
    const { data: credit, error: creditError } = await db.rpc("wfilemanager_wallet_credit", {
      p_customer_id: customer.id,
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
    return json({
      reference: row.topup_reference,
      status: "credited",
      amountUsd: money(row.amount_usd),
      balanceUsd: money(result.balance_usd),
    });
  }
  const { data: account } = await db
    .from("wfilemanager_customer_accounts")
    .select("balance_usd")
    .eq("id", customer.id)
    .single();
  return json({
    reference: row.topup_reference,
    status: row.status,
    amountUsd: money(row.amount_usd),
    paymentUrl: row.provider_payment_url,
    balanceUsd: money(account?.balance_usd),
  });
}

async function orderStatus(config: Config, customer: Row, url: URL) {
  const orderReference = clean(
    url.searchParams.get("orderReference") || url.searchParams.get("order"),
  );
  const { data: order, error } = await db
    .from("wfilemanager_pro_orders")
    .select("*")
    .eq("customer_id", customer.id)
    .eq("order_reference", orderReference)
    .maybeSingle();
  if (error) throw error;
  if (!order) return json({ error: "Order not found" }, 404);
  if (["pending", "payment_pending"].includes(order.status)) {
    const verification = await verifyPayment(config, order, "order_reference");
    if (verification.paid)
      await db
        .from("wfilemanager_pro_orders")
        .update({
          status: "paid",
          paid_at: order.paid_at || new Date().toISOString(),
          provider_amount: verification.amount,
          provider_payload: {
            ...(order.provider_payload || {}),
            verified_status: verification.payload,
          },
          reconciliation_error: null,
        })
        .eq("id", order.id);
  }
  const { response, payload } = await fetchJson(
    `${config.subscriptionApi}/order?${new URLSearchParams({
      orderReference,
      email: customer.email,
    })}`,
  );
  return json(payload, response.status);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).pop() || "status";
    if (action === "status")
      return json({
        ok: true,
        strictPaymentVerification: true,
        idempotency: true,
        immutableOwnership: true,
        emailVerificationRequired: true,
      });
    const customer = await authenticate(request);
    if (!customer) return json({ error: "Authentication required" }, 401);
    requireVerified(customer);
    const config = await loadConfig();
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Row) : {};

    if (action === "checkout" && request.method === "POST") {
      const key = operationKey(body, "checkout", customer.id, clean(body.paymentMode));
      return clean(body.paymentMode) === "balance"
        ? walletBuy(config, customer, key)
        : directOrder(config, customer, "new_licence_key", null, key);
    }
    if (action === "renew" && request.method === "POST") {
      const instanceKey = clean(body.targetInstanceKey || body.instanceKey);
      if (!instanceKey) return json({ error: "Instance key is required" }, 400);
      if (!(await ownsInstance(customer.id, instanceKey)))
        return json({ error: "This instance is not linked to your account" }, 403);
      const key = operationKey(
        body,
        "renew",
        customer.id,
        `${instanceKey}:${clean(body.paymentMode)}`,
      );
      return clean(body.paymentMode) === "balance"
        ? walletRenew(config, customer, instanceKey, key)
        : directOrder(config, customer, "renewal", instanceKey, key);
    }
    if (action === "auto-renew" && request.method === "POST") {
      const instanceKey = clean(body.instanceKey || body.targetInstanceKey);
      if (!instanceKey || !(await ownsInstance(customer.id, instanceKey)))
        return json({ error: "This instance is not linked to your account" }, 403);
      const { error } = await db
        .from("wfilemanager_instances")
        .update({
          billing_customer_id: customer.id,
          auto_renew: body.enabled === true,
          auto_renew_last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("instance_key", instanceKey);
      if (error) throw error;
      return json({ success: true, instanceKey, autoRenew: body.enabled === true });
    }
    if (action === "topup" && request.method === "POST") {
      const key = operationKey(body, "topup", customer.id, String(money(body.amountUsd)));
      return topup(config, customer, body, key);
    }
    if (action === "topup-status" && request.method === "GET")
      return topupStatus(config, customer, url);
    if (action === "order" && request.method === "GET")
      return orderStatus(config, customer, url);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Financial request failed" },
      Number((error as { status?: number }).status || 500),
    );
  }
});
