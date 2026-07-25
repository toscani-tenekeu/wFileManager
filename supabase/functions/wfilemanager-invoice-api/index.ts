import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

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
const BUCKET = "wfilemanager-documents";

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
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function bearer(request: Request) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
function pdfText(value: unknown, maximum = 90) {
  const text = clean(value).replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

async function config() {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select("automation_secret_hash,support_email,site_url")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return {
    automationSecretHash: String(data?.automation_secret_hash || ""),
    supportEmail: String(data?.support_email || "support@kmerhosting.com"),
    siteUrl: String(data?.site_url || "https://wfilemanager.com"),
  };
}
async function automationAuthorized(request: Request, expectedHash: string) {
  const secret = clean(request.headers.get("x-wfilemanager-automation-secret"));
  return Boolean(secret && expectedHash && safeEqual(await sha256(secret), expectedHash));
}
async function customerAuth(request: Request) {
  const token = bearer(request);
  if (!token) return null;
  const { data, error } = await db
    .from("wfilemanager_customer_sessions")
    .select("id,customer_id,wfilemanager_customer_accounts(id,email,full_name,status)")
    .eq("token_hash", await sha256(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  const customer = data?.wfilemanager_customer_accounts as any;
  if (!customer || customer.status !== "active") return null;
  return customer;
}
function invoiceNumber(type: string, reference: string) {
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const suffix = reference
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-14)
    .toUpperCase();
  const prefix =
    type === "topup" ? "RCT" : type === "renewal" ? "REN" : type === "storage" ? "STO" : "INV";
  return `WFM-${prefix}-${month}-${suffix}`;
}

async function renderPdf(params: {
  invoiceNumber: string;
  type: string;
  customerName: string;
  customerEmail: string;
  amountUsd: number;
  reference: string;
  issuedAt: string;
  description: string;
  supportEmail: string;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw = (text: string, x: number, y: number, size = 11, useBold = false) =>
    page.drawText(pdfText(text), {
      x,
      y,
      size,
      font: useBold ? bold : regular,
      color: rgb(0.08, 0.1, 0.15),
    });
  draw("wFileManager", 48, 785, 22, true);
  draw(params.type === "topup" ? "RECEIPT" : "INVOICE", 455, 785, 14, true);
  page.drawLine({
    start: { x: 48, y: 760 },
    end: { x: 547, y: 760 },
    thickness: 1,
    color: rgb(0.82, 0.84, 0.88),
  });
  draw(params.invoiceNumber, 48, 728, 12, true);
  draw(`Issued: ${new Date(params.issuedAt).toUTCString()}`, 48, 707, 10);
  draw("Bill to", 48, 660, 11, true);
  draw(params.customerName || "Customer", 48, 640, 11);
  draw(params.customerEmail, 48, 621, 10);
  draw("Description", 48, 550, 10, true);
  draw("Amount", 465, 550, 10, true);
  page.drawLine({
    start: { x: 48, y: 539 },
    end: { x: 547, y: 539 },
    thickness: 1,
    color: rgb(0.82, 0.84, 0.88),
  });
  draw(params.description, 48, 512, 11);
  draw(`$${params.amountUsd.toFixed(2)} USD`, 455, 512, 11, true);
  page.drawLine({
    start: { x: 48, y: 490 },
    end: { x: 547, y: 490 },
    thickness: 1,
    color: rgb(0.82, 0.84, 0.88),
  });
  draw("Total", 390, 455, 12, true);
  draw(`$${params.amountUsd.toFixed(2)} USD`, 455, 455, 12, true);
  draw(`Reference: ${params.reference}`, 48, 405, 9);
  draw("Currency: USD", 48, 387, 9);
  draw("KmerHosting LLC · wFileManager", 48, 95, 9, true);
  draw(`Technical support: ${params.supportEmail}`, 48, 78, 9);
  return new Uint8Array(await pdf.save());
}

async function existingInvoice(orderId?: string | null, topupId?: string | null) {
  let query = db.from("wfilemanager_invoices").select("*");
  if (orderId) query = query.eq("order_id", orderId);
  else if (topupId) query = query.eq("topup_id", topupId);
  else return null;
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function createInvoice(params: {
  customer: any;
  type: "licence" | "renewal" | "topup" | "storage";
  amountUsd: number;
  reference: string;
  orderId?: string | null;
  topupId?: string | null;
  issuedAt?: string | null;
  supportEmail: string;
}) {
  const found = await existingInvoice(params.orderId, params.topupId);
  if (found) return found;
  const number = invoiceNumber(params.type, params.reference);
  const issuedAt = params.issuedAt || new Date().toISOString();
  const descriptions = {
    licence: "wFileManager Pro licence — one instance, one year",
    renewal: "wFileManager Pro annual renewal",
    topup: "wFileManager customer account top-up",
    storage: "wFileManager Pro managed storage upgrade",
  };
  const bytes = await renderPdf({
    invoiceNumber: number,
    type: params.type,
    customerName: params.customer.full_name || "Customer",
    customerEmail: params.customer.email,
    amountUsd: params.amountUsd,
    reference: params.reference,
    issuedAt,
    description: descriptions[params.type],
    supportEmail: params.supportEmail,
  });
  const path = `customers/${params.customer.id}/${number}.pdf`;
  const upload = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", cacheControl: "3600", upsert: false });
  if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists"))
    throw upload.error;
  const { data, error } = await db
    .from("wfilemanager_invoices")
    .insert({
      invoice_number: number,
      customer_id: params.customer.id,
      order_id: params.orderId || null,
      topup_id: params.topupId || null,
      invoice_type: params.type,
      status: "paid",
      currency: "USD",
      amount_usd: params.amountUsd,
      issued_at: issuedAt,
      pdf_storage_path: path,
      metadata: { reference: params.reference },
    })
    .select("*")
    .single();
  if (error) {
    if (String(error.code) === "23505") return existingInvoice(params.orderId, params.topupId);
    throw error;
  }
  return data;
}

async function generateForCustomer(customer: any, supportEmail: string) {
  for (let from = 0; ; from += 200) {
    const { data: orders, error } = await db
      .from("wfilemanager_pro_orders")
      .select("id,order_reference,order_type,status,amount_usd,paid_at")
      .eq("customer_id", customer.id)
      .in("status", [
        "paid",
        "activation_sent",
        "renewal_applied",
        "upgrade_applied",
        "email_failed",
      ])
      .order("created_at", { ascending: true })
      .range(from, from + 199);
    if (error) throw error;
    for (const order of orders || []) {
      const type =
        order.order_type === "renewal"
          ? "renewal"
          : order.order_type === "storage_upgrade"
            ? "storage"
            : "licence";
      await createInvoice({
        customer,
        type,
        amountUsd: money(order.amount_usd),
        reference: order.order_reference,
        orderId: order.id,
        issuedAt: order.paid_at,
        supportEmail,
      });
    }
    if (!orders || orders.length < 200) break;
  }
  for (let from = 0; ; from += 200) {
    const { data: topups, error } = await db
      .from("wfilemanager_wallet_topups")
      .select("id,topup_reference,amount_usd,credited_at")
      .eq("customer_id", customer.id)
      .eq("status", "credited")
      .order("created_at", { ascending: true })
      .range(from, from + 199);
    if (error) throw error;
    for (const topup of topups || [])
      await createInvoice({
        customer,
        type: "topup",
        amountUsd: money(topup.amount_usd),
        reference: topup.topup_reference,
        topupId: topup.id,
        issuedAt: topup.credited_at,
        supportEmail,
      });
    if (!topups || topups.length < 200) break;
  }
}

async function listCustomerInvoices(customer: any) {
  const { data, error } = await db
    .from("wfilemanager_invoices")
    .select("*")
    .eq("customer_id", customer.id)
    .order("issued_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const invoices = [];
  for (const invoice of data || []) {
    let downloadUrl: string | null = null;
    if (invoice.pdf_storage_path) {
      const signed = await db.storage.from(BUCKET).createSignedUrl(invoice.pdf_storage_path, 300, {
        download: `${invoice.invoice_number}.pdf`,
      });
      if (!signed.error) downloadUrl = signed.data.signedUrl;
    }
    invoices.push({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      type: invoice.invoice_type,
      status: invoice.status,
      currency: invoice.currency,
      amountUsd: money(invoice.amount_usd),
      issuedAt: invoice.issued_at,
      downloadUrl,
    });
  }
  return invoices;
}

async function generateAll(supportEmail: string) {
  const results: unknown[] = [];
  let checked = 0;
  for (let from = 0; ; from += 200) {
    const { data: customers, error } = await db
      .from("wfilemanager_customer_accounts")
      .select("id,email,full_name,status")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + 199);
    if (error) throw error;
    for (const customer of customers || []) {
      checked += 1;
      try {
        await generateForCustomer(customer, supportEmail);
        results.push({ customerId: customer.id, success: true });
      } catch (value) {
        results.push({
          customerId: customer.id,
          success: false,
          error: value instanceof Error ? value.message : "Invoice generation failed",
        });
      }
    }
    if (!customers || customers.length < 200) break;
  }
  return { checked, results };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "status";
    const settings = await config();
    if (action === "status")
      return json({
        ok: true,
        pdfInvoices: true,
        privateDownloads: true,
        generationMode: "automation",
        currency: "USD",
      });
    if (action === "invoices" && request.method === "GET") {
      const customer = await customerAuth(request);
      if (!customer) return json({ error: "Authentication required" }, 401);
      return json({ invoices: await listCustomerInvoices(customer) });
    }
    if (action === "run" && request.method === "POST") {
      if (!(await automationAuthorized(request, settings.automationSecretHash)))
        return json({ error: "Unauthorized automation request" }, 401);
      return json({ ok: true, invoices: await generateAll(settings.supportEmail) });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Invoice service failed" }, 500);
  }
});
