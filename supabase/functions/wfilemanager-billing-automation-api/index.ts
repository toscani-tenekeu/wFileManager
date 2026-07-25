import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-wfilemanager-automation-secret",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const encoder = new TextEncoder();

type Customer = { id: string; email: string; name: string; balanceUsd: number };
type Config = {
  subscriptionApi: string;
  camerpayBaseUrl: string;
  camerpayToken: string;
  mailtrapToken: string;
  mailtrapUrl: string;
  fromEmail: string;
  fromName: string;
  supportEmail: string;
  siteUrl: string;
  priceUsd: number;
  periodDays: number;
  automationSecretHash: string;
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
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
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
  const amount = Number(
    pick(payload, ["amount", "paid_amount", "data.amount", "data.paid_amount"]),
  );
  return Number.isFinite(amount) ? amount : null;
}
function paidStatus(status: string) {
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
function backoffMinutes(attempts: number) {
  return Math.min(360, Math.max(5, 5 * 2 ** Math.min(6, Math.max(0, attempts - 1))));
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
    subscriptionApi: String(
      data.function_url || `${supabaseUrl}/functions/v1/wfilemanager-pro-subscription-api`,
    ).replace(/\/$/, ""),
    camerpayBaseUrl: String(data.camerpay_api_base_url || "https://camerpay.biz").replace(
      /\/$/,
      "",
    ),
    camerpayToken: String(data.camerpay_api_token || ""),
    mailtrapToken: String(data.mailtrap_api_token || ""),
    mailtrapUrl: String(data.mailtrap_api_url || "https://send.api.mailtrap.io/api/send"),
    fromEmail: String(data.mailtrap_from_email || "support@kmerhosting.com"),
    fromName: String(data.mailtrap_from_name || "KmerHosting"),
    supportEmail: String(data.support_email || "support@kmerhosting.com"),
    siteUrl: String(data.site_url || "https://wfilemanager.com").replace(/\/$/, ""),
    priceUsd: Number(data.price_usd || 50),
    periodDays: Number(data.period_days || 365),
    automationSecretHash: String(data.automation_secret_hash || ""),
  };
}
async function authorized(request: Request, config: Config) {
  const secret = clean(request.headers.get("x-wfilemanager-automation-secret"));
  if (!secret || !config.automationSecretHash) return false;
  return safeEqual(await sha256(secret), config.automationSecretHash);
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
  const result = await response.text();
  if (!response.ok)
    throw new Error(`Mailtrap failed (${response.status}): ${result.slice(0, 300)}`);
}
async function customerById(id: string): Promise<Customer | null> {
  const { data, error } = await db
    .from("wfilemanager_customer_accounts")
    .select("id,email,full_name,balance_usd,status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") return null;
  return {
    id: data.id,
    email: data.email,
    name: data.full_name || "Customer",
    balanceUsd: money(data.balance_usd),
  };
}
async function customerForInstance(instance: Record<string, unknown>): Promise<Customer | null> {
  if (instance.billing_customer_id) return customerById(String(instance.billing_customer_id));
  const { data: token } = await db
    .from("wfilemanager_pro_activation_tokens")
    .select("customer_id,customer_email,order_reference")
    .eq("claimed_by_instance_id", instance.id)
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (token?.customer_id) return customerById(String(token.customer_id));
  if (token?.order_reference) {
    const { data: order } = await db
      .from("wfilemanager_pro_orders")
      .select("customer_id")
      .eq("order_reference", token.order_reference)
      .maybeSingle();
    if (order?.customer_id) return customerById(String(order.customer_id));
  }
  return null;
}

async function reconcileOrders(config: Config) {
  const now = new Date().toISOString();
  const { data: orders, error } = await db
    .from("wfilemanager_pro_orders")
    .select("id,order_reference,buyer_email,status,reconciliation_attempts,created_at")
    .in("status", ["pending", "payment_pending", "paid", "email_failed"])
    .lte("next_reconcile_at", now)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const results: unknown[] = [];
  for (const order of orders || []) {
    const attempts = Number(order.reconciliation_attempts || 0) + 1;
    try {
      if (
        ["pending", "payment_pending"].includes(order.status) &&
        new Date(order.created_at).getTime() < Date.now() - 48 * 3600000
      ) {
        await db
          .from("wfilemanager_pro_orders")
          .update({
            status: "cancelled",
            reconciliation_attempts: attempts,
            last_reconciled_at: now,
            next_reconcile_at: new Date(Date.now() + 365 * 86400000).toISOString(),
            reconciliation_error: null,
          })
          .eq("id", order.id);
        results.push({ reference: order.order_reference, status: "cancelled" });
        continue;
      }
      const response = await fetch(
        `${config.subscriptionApi}/order?${new URLSearchParams({
          orderReference: order.order_reference,
          email: order.buyer_email,
        })}`,
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(clean(payload.error) || `Order reconciliation failed (${response.status})`);
      const terminal = [
        "activation_sent",
        "renewal_applied",
        "upgrade_applied",
        "failed",
        "cancelled",
      ].includes(clean(payload.status));
      await db
        .from("wfilemanager_pro_orders")
        .update({
          reconciliation_attempts: attempts,
          last_reconciled_at: new Date().toISOString(),
          next_reconcile_at: new Date(
            Date.now() + (terminal ? 365 * 86400000 : 5 * 60000),
          ).toISOString(),
          reconciliation_error: null,
        })
        .eq("id", order.id);
      results.push({ reference: order.order_reference, status: payload.status || order.status });
    } catch (value) {
      const message = value instanceof Error ? value.message : "Order reconciliation failed";
      await db
        .from("wfilemanager_pro_orders")
        .update({
          reconciliation_attempts: attempts,
          last_reconciled_at: new Date().toISOString(),
          next_reconcile_at: new Date(Date.now() + backoffMinutes(attempts) * 60000).toISOString(),
          reconciliation_error: message,
        })
        .eq("id", order.id);
      results.push({ reference: order.order_reference, error: message });
    }
  }
  return { checked: orders?.length || 0, results };
}

async function checkPayment(config: Config, reference: string) {
  const response = await fetch(`${config.camerpayBaseUrl}/api/payment/${reference}/status`, {
    headers: { Authorization: `Bearer ${config.camerpayToken}`, Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      clean(payload.error || payload.message) || `CamerPay status failed (${response.status})`,
    );
  return payload;
}
async function sendTopupConfirmation(
  config: Config,
  customer: Customer,
  topup: Record<string, unknown>,
  balance: number,
) {
  const amount = money(topup.amount_usd);
  const reference = clean(topup.topup_reference);
  await sendMail(config, {
    email: customer.email,
    name: customer.name,
    subject: "Your wFileManager account top-up is confirmed",
    text: `Hello ${customer.name},\n\nYour account top-up is confirmed.\n\nAmount added: $${amount.toFixed(2)} USD\nNew balance: $${balance.toFixed(2)} USD\nReference: ${reference}\n\nTechnical support: ${config.supportEmail}.`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>Account top-up confirmed</h2><p>Hello ${customer.name},</p><p><strong>Amount added:</strong> $${amount.toFixed(2)} USD</p><p><strong>New balance:</strong> $${balance.toFixed(2)} USD</p><p><strong>Reference:</strong> ${reference}</p></body></html>`,
    category: "wfilemanager-wallet-topup",
  });
}
async function reconcileTopups(config: Config) {
  const { data: topups, error } = await db
    .from("wfilemanager_wallet_topups")
    .select("*")
    .in("status", ["pending", "payment_pending", "paid", "credited"])
    .lte("next_reconcile_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const results: unknown[] = [];
  for (let topup of topups || []) {
    if (topup.status === "credited" && !topup.email_error) continue;
    const attempts = Number(topup.reconciliation_attempts || 0) + 1;
    try {
      const customer = await customerById(topup.customer_id);
      if (!customer) throw new Error("Customer account is unavailable");
      if (
        ["pending", "payment_pending"].includes(topup.status) &&
        new Date(topup.created_at).getTime() < Date.now() - 48 * 3600000
      ) {
        await db
          .from("wfilemanager_wallet_topups")
          .update({ status: "cancelled" })
          .eq("id", topup.id);
        topup = { ...topup, status: "cancelled" };
      } else if (
        ["pending", "payment_pending"].includes(topup.status) &&
        topup.provider_reference
      ) {
        const payload = await checkPayment(config, topup.provider_reference);
        const amount = providerAmount(payload);
        if (
          paidStatus(providerStatus(payload)) &&
          (amount === null || amount >= Number(topup.amount_xaf || 0))
        ) {
          const paidAt = topup.paid_at || new Date().toISOString();
          await db
            .from("wfilemanager_wallet_topups")
            .update({ status: "paid", paid_at: paidAt, status_payload: payload })
            .eq("id", topup.id);
          topup = { ...topup, status: "paid", paid_at: paidAt };
        }
      }
      if (topup.status === "paid" && !topup.credited_at) {
        const { data: credit, error: creditError } = await db.rpc("wfilemanager_wallet_credit", {
          p_customer_id: topup.customer_id,
          p_amount_usd: topup.amount_usd,
          p_transaction_type: "topup_credit",
          p_reference: topup.topup_reference,
          p_idempotency_key: `topup:${topup.id}`,
          p_metadata: { provider: "camerpay", provider_reference: topup.provider_reference },
        });
        if (creditError) throw creditError;
        const applied = credit?.[0];
        const creditedAt = new Date().toISOString();
        await db
          .from("wfilemanager_wallet_topups")
          .update({
            status: "credited",
            credited_at: creditedAt,
            wallet_transaction_id: applied.transaction_id,
          })
          .eq("id", topup.id);
        topup = {
          ...topup,
          status: "credited",
          credited_at: creditedAt,
          wallet_transaction_id: applied.transaction_id,
        };
      }
      if (topup.status === "credited" && (!topup.email_sent_at || topup.email_error)) {
        const refreshed = await customerById(topup.customer_id);
        if (!refreshed) throw new Error("Customer account is unavailable");
        await sendTopupConfirmation(config, refreshed, topup, refreshed.balanceUsd);
        await db
          .from("wfilemanager_wallet_topups")
          .update({ email_sent_at: new Date().toISOString(), email_error: null })
          .eq("id", topup.id);
      }
      const terminal = ["credited", "failed", "cancelled"].includes(topup.status);
      await db
        .from("wfilemanager_wallet_topups")
        .update({
          reconciliation_attempts: attempts,
          last_reconciled_at: new Date().toISOString(),
          next_reconcile_at: new Date(
            Date.now() + (terminal ? 365 * 86400000 : 5 * 60000),
          ).toISOString(),
          reconciliation_error: null,
        })
        .eq("id", topup.id);
      results.push({ reference: topup.topup_reference, status: topup.status });
    } catch (value) {
      const message = value instanceof Error ? value.message : "Top-up reconciliation failed";
      await db
        .from("wfilemanager_wallet_topups")
        .update({
          reconciliation_attempts: attempts,
          last_reconciled_at: new Date().toISOString(),
          next_reconcile_at: new Date(Date.now() + backoffMinutes(attempts) * 60000).toISOString(),
          reconciliation_error: message,
        })
        .eq("id", topup.id);
      results.push({ reference: topup.topup_reference, error: message });
    }
  }
  return { checked: topups?.length || 0, results };
}

async function reserveReminder(
  instanceKey: string,
  customer: Customer,
  kind: string,
  paidUntil: string | null,
) {
  const { data, error } = await db
    .from("wfilemanager_billing_reminders")
    .insert({
      instance_key: instanceKey,
      customer_email: customer.email,
      reminder_kind: kind,
      paid_until: paidUntil,
    })
    .select("id")
    .single();
  if (error) {
    if (String(error.code) === "23505") return null;
    throw error;
  }
  return data.id as string;
}
async function reminderMail(
  config: Config,
  instance: Record<string, unknown>,
  customer: Customer,
  kind: string,
) {
  const labels: Record<string, string> = {
    renewal_14d: "Your wFileManager Pro licence expires in about 14 days",
    renewal_7d: "Your wFileManager Pro licence expires in about 7 days",
    renewal_1d: "Your wFileManager Pro licence expires soon",
    past_due: "Your wFileManager Pro licence is past due",
    suspended: "Your wFileManager Pro licence is suspended",
    deletion_7d: "Your wFileManager Pro managed account will be deleted in about 7 days",
    deletion_1d: "Your wFileManager Pro managed account will be deleted soon",
  };
  const subject = labels[kind] || "wFileManager Pro licence reminder";
  const account = `${config.siteUrl}/account`;
  const paidUntil = instance.paid_until
    ? new Date(String(instance.paid_until)).toUTCString()
    : "not set";
  await sendMail(config, {
    email: customer.email,
    name: customer.name,
    subject,
    text: `Hello ${customer.name},\n\n${subject}.\n\nInstance: ${instance.instance_key}\nPaid until: ${paidUntil}\nAccount balance: $${customer.balanceUsd.toFixed(2)} USD\n\nAdd funds, renew from balance, or pay directly: ${account}\n\nTechnical support: ${config.supportEmail}.`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827"><h2>${subject}</h2><p>Hello ${customer.name},</p><p><strong>Instance:</strong> ${instance.instance_key}</p><p><strong>Paid until:</strong> ${paidUntil}</p><p><strong>Account balance:</strong> $${customer.balanceUsd.toFixed(2)} USD</p><p><a href="${account}">Open customer account</a></p></body></html>`,
    category: `wfilemanager-${kind}`,
  });
}
function reminderKind(instance: Record<string, unknown>) {
  const paid = instance.paid_until ? new Date(String(instance.paid_until)).getTime() : 0;
  const days = (paid - Date.now()) / 86400000;
  const deleteAfter = instance.delete_after_at
    ? (new Date(String(instance.delete_after_at)).getTime() - Date.now()) / 86400000
    : null;
  if (deleteAfter !== null && deleteAfter <= 1 && deleteAfter > 0) return "deletion_1d";
  if (deleteAfter !== null && deleteAfter <= 7 && deleteAfter > 1) return "deletion_7d";
  if (instance.subscription_status === "suspended" || instance.data_status === "suspended")
    return "suspended";
  if (days < 0) return "past_due";
  if (instance.auto_renew) return days <= 14 && days > 7 ? "renewal_14d" : "";
  if (days <= 1) return "renewal_1d";
  if (days <= 7) return "renewal_7d";
  if (days <= 14) return "renewal_14d";
  return "";
}
async function runReminders(config: Config) {
  const horizon = new Date(Date.now() + 14 * 86400000).toISOString();
  const { data: instances, error } = await db
    .from("wfilemanager_instances")
    .select("*")
    .eq("service_plan", "pro")
    .or(`paid_until.lte.${horizon},delete_after_at.lte.${horizon}`)
    .neq("data_status", "deleted")
    .limit(500);
  if (error) throw error;
  const results: unknown[] = [];
  for (const instance of instances || []) {
    const kind = reminderKind(instance);
    if (!kind) continue;
    const customer = await customerForInstance(instance);
    if (!customer) continue;
    const id = await reserveReminder(instance.instance_key, customer, kind, instance.paid_until);
    if (!id) continue;
    try {
      await reminderMail(config, instance, customer, kind);
      results.push({ instance: instance.instance_key, kind, sent: true });
    } catch (value) {
      const message = value instanceof Error ? value.message : "Email failed";
      await db
        .from("wfilemanager_billing_reminders")
        .update({
          email_error: message,
          next_attempt_at: new Date(Date.now() + 15 * 60000).toISOString(),
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", id);
      results.push({ instance: instance.instance_key, kind, sent: false });
    }
  }
  return { checked: instances?.length || 0, results };
}

async function runAutoRenew(config: Config) {
  const horizon = new Date(Date.now() + 7 * 86400000).toISOString();
  const { data: instances, error } = await db
    .from("wfilemanager_instances")
    .select("*")
    .eq("service_plan", "pro")
    .eq("auto_renew", true)
    .not("billing_customer_id", "is", null)
    .not("paid_until", "is", null)
    .lte("paid_until", horizon)
    .neq("data_status", "deleted")
    .limit(500);
  if (error) throw error;
  const results: unknown[] = [];
  for (const instance of instances || []) {
    const customer = await customerForInstance(instance);
    if (!customer) continue;
    const oldPaidUntil = String(instance.paid_until);
    const { data, error: renewalError } = await db.rpc("wfilemanager_wallet_renew_instance", {
      p_customer_id: customer.id,
      p_instance_key: instance.instance_key,
      p_amount_usd: config.priceUsd,
      p_period_days: config.periodDays,
      p_transaction_type: "auto_renewal_debit",
      p_reference: `AUTO-${instance.instance_key}`,
      p_idempotency_key: `auto-renew:${instance.instance_key}:${oldPaidUntil}`,
      p_metadata: { automatic: true, previous_paid_until: oldPaidUntil },
    });
    if (renewalError) {
      const message = String(renewalError.message || renewalError);
      await db
        .from("wfilemanager_instances")
        .update({
          auto_renew_last_attempt_at: new Date().toISOString(),
          auto_renew_last_error: message,
        })
        .eq("id", instance.id);
      if (message.includes("insufficient_balance")) {
        const id = await reserveReminder(
          instance.instance_key,
          customer,
          "auto_renew_insufficient",
          oldPaidUntil,
        );
        if (id) {
          try {
            const missing = Math.max(0, config.priceUsd - customer.balanceUsd);
            await sendMail(config, {
              email: customer.email,
              name: customer.name,
              subject: "Your wFileManager Pro auto-renewal needs more account balance",
              text: `Hello ${customer.name},\n\nWe could not renew ${instance.instance_key} because the account balance is insufficient.\n\nRequired: $${config.priceUsd.toFixed(2)} USD\nAvailable: $${customer.balanceUsd.toFixed(2)} USD\nMissing: $${missing.toFixed(2)} USD\n\nAdd funds or pay directly: ${config.siteUrl}/account`,
              html: `<!doctype html><html><body><h2>More account balance is required</h2><p>Instance: <strong>${instance.instance_key}</strong></p><p>Missing: <strong>$${missing.toFixed(2)} USD</strong></p><p><a href="${config.siteUrl}/account">Add funds or renew directly</a></p></body></html>`,
              category: "wfilemanager-auto-renew-insufficient",
            });
          } catch (mailError) {
            await db
              .from("wfilemanager_billing_reminders")
              .update({
                email_error: mailError instanceof Error ? mailError.message : "Email failed",
              })
              .eq("id", id);
          }
        }
      }
      results.push({ instance: instance.instance_key, renewed: false, reason: message });
      continue;
    }
    const result = data?.[0];
    const updatedCustomer = (await customerById(customer.id)) || customer;
    const id = await reserveReminder(
      instance.instance_key,
      updatedCustomer,
      "auto_renew_success",
      oldPaidUntil,
    );
    if (id) {
      try {
        await sendMail(config, {
          email: updatedCustomer.email,
          name: updatedCustomer.name,
          subject: "Your wFileManager Pro licence was renewed automatically",
          text: `Hello ${updatedCustomer.name},\n\nYour licence was renewed automatically from your USD account balance.\n\nInstance: ${instance.instance_key}\nAmount charged: $${config.priceUsd.toFixed(2)} USD\nNew expiry: ${new Date(result.paid_until).toUTCString()}\nRemaining balance: $${money(result.balance_usd).toFixed(2)} USD`,
          html: `<!doctype html><html><body><h2>Automatic renewal confirmed</h2><p>Instance: <strong>${instance.instance_key}</strong></p><p>New expiry: <strong>${new Date(result.paid_until).toUTCString()}</strong></p><p>Remaining balance: <strong>$${money(result.balance_usd).toFixed(2)} USD</strong></p></body></html>`,
          category: "wfilemanager-auto-renew-success",
        });
      } catch (mailError) {
        await db
          .from("wfilemanager_billing_reminders")
          .update({ email_error: mailError instanceof Error ? mailError.message : "Email failed" })
          .eq("id", id);
      }
    }
    results.push({ instance: instance.instance_key, renewed: true, paidUntil: result.paid_until });
  }
  return { checked: instances?.length || 0, results };
}

async function processLifecycle(config: Config) {
  const { data: events, error } = await db
    .from("wfilemanager_lifecycle_events")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  const results: unknown[] = [];
  for (const event of events || []) {
    const attempts = Number(event.attempt_count || 0) + 1;
    try {
      await db
        .from("wfilemanager_lifecycle_events")
        .update({ status: "processing", attempt_count: attempts })
        .eq("id", event.id);
      const { data: snapshots } = await db
        .from("wfilemanager_backup_snapshots")
        .select("storage_path")
        .eq("instance_id", event.instance_id);
      const paths = (snapshots || []).map((row) => row.storage_path).filter(Boolean);
      if (paths.length) {
        const removal = await db.storage.from("wfilemanager-backups").remove(paths);
        if (removal.error) throw removal.error;
      }
      const { error: deletionError } = await db.rpc("wfilemanager_delete_instance", {
        p_instance_id: event.instance_id,
      });
      if (deletionError) throw deletionError;
      if (event.customer_email) {
        await sendMail(config, {
          email: event.customer_email,
          name: event.customer_name || "Customer",
          subject: "Your wFileManager Pro managed account was deleted",
          text: `Hello ${event.customer_name || "Customer"},\n\nThe managed application data for ${event.instance_key} was deleted after more than 30 days without payment.\n\nA new installation now requires a new licence key.\nTechnical support: ${config.supportEmail}.`,
          html: `<!doctype html><html><body><h2>Managed account deleted</h2><p>The managed application data for <strong>${event.instance_key}</strong> was deleted after more than 30 days without payment.</p><p>A new installation now requires a new licence key.</p></body></html>`,
          category: "wfilemanager-instance-deleted",
        });
      }
      await db
        .from("wfilemanager_lifecycle_events")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", event.id);
      results.push({ instance: event.instance_key, completed: true });
    } catch (value) {
      const message = value instanceof Error ? value.message : "Lifecycle processing failed";
      await db
        .from("wfilemanager_lifecycle_events")
        .update({
          status: "failed",
          attempt_count: attempts,
          next_attempt_at: new Date(Date.now() + backoffMinutes(attempts) * 60000).toISOString(),
          last_error: message,
        })
        .eq("id", event.id);
      results.push({ instance: event.instance_key, completed: false, error: message });
    }
  }
  return { checked: events?.length || 0, results };
}

async function runFast(config: Config) {
  const [orders, topups, lifecycle] = await Promise.all([
    reconcileOrders(config),
    reconcileTopups(config),
    processLifecycle(config),
  ]);
  return { ok: true, orders, topups, lifecycle };
}
async function runDaily(config: Config) {
  return {
    ok: true,
    fast: await runFast(config),
    autoRenewals: await runAutoRenew(config),
    reminders: await runReminders(config),
    operationalCleanup: (await db.rpc("wfilemanager_cleanup_operational_data")).data,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "status";
    if (action === "status")
      return json({
        ok: true,
        protectedAutomation: true,
        paymentReconciliation: true,
        walletAutoRenew: true,
        reminders: true,
        queuedDeletion: true,
        currency: "USD",
      });
    const config = await loadConfig();
    if (!(await authorized(request, config)))
      return json({ error: "Unauthorized automation request" }, 401);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (action === "run-fast" || action === "reconcile") return json(await runFast(config));
    if (["run-daily", "run-reminders", "run"].includes(action)) return json(await runDaily(config));
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Automation failed" }, 500);
  }
});
