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

type Row = Record<string, any>;
type Config = {
  automationSecretHash: string;
  supportEmail: string;
  siteUrl: string;
  legalName: string;
  legalAddress: string;
  registrationNumber: string;
  taxNumber: string;
  footerNote: string;
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
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function bearer(request: Request) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
function pdfText(value: unknown, maximum = 95) {
  const text = clean(value).replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}
async function config(): Promise<Config> {
  const { data, error } = await db
    .from("wfilemanager_pro_subscription_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return {
    automationSecretHash: clean(data?.automation_secret_hash),
    supportEmail: clean(data?.support_email || "support@kmerhosting.com"),
    siteUrl: clean(data?.site_url || "https://wfilemanager.com"),
    legalName: clean(data?.invoice_legal_name || "KmerHosting LLC"),
    legalAddress: clean(data?.invoice_legal_address),
    registrationNumber: clean(data?.invoice_registration_number),
    taxNumber: clean(data?.invoice_tax_number),
    footerNote: clean(data?.invoice_footer_note),
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
    .select("id,customer_id,wfilemanager_customer_accounts(*)")
    .eq("token_hash", await sha256(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  const customer = data?.wfilemanager_customer_accounts as Row | undefined;
  if (!customer || customer.status !== "active") return null;
  return customer;
}
function invoiceNumber(type: string, reference: string) {
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const suffix = reference.replace(/[^A-Za-z0-9]/g, "").slice(-14).toUpperCase();
  const prefix =
    type === "topup" ? "RCT" : type === "renewal" ? "REN" : type === "storage" ? "STO" : "INV";
  return `WFM-${prefix}-${month}-${suffix}`;
}
function description(type: string) {
  return type === "renewal"
    ? "wFileManager Pro annual renewal"
    : type === "topup"
      ? "wFileManager customer account top-up"
      : type === "storage"
        ? "wFileManager Pro managed storage upgrade"
        : "wFileManager Pro licence — one instance, one year";
}

async function renderPdf(params: {
  invoiceNumber: string;
  type: string;
  customer: Row;
  amountUsd: number;
  reference: string;
  issuedAt: string;
  config: Config;
}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw = (text: string, x: number, y: number, size = 10, useBold = false, max = 95) =>
    page.drawText(pdfText(text, max), {
      x,
      y,
      size,
      font: useBold ? bold : regular,
      color: rgb(0.08, 0.1, 0.15),
    });

  draw("wFileManager", 48, 785, 22, true);
  draw(params.type === "topup" ? "RECEIPT" : "INVOICE", 445, 785, 14, true);
  page.drawLine({
    start: { x: 48, y: 760 },
    end: { x: 547, y: 760 },
    thickness: 1,
    color: rgb(0.82, 0.84, 0.88),
  });
  draw(params.invoiceNumber, 48, 730, 12, true);
  draw(`Issued: ${new Date(params.issuedAt).toUTCString()}`, 48, 710, 9);

  draw("Supplier", 48, 670, 10, true);
  draw(params.config.legalName, 48, 651, 10);
  let supplierY = 634;
  if (params.config.legalAddress) {
    draw(params.config.legalAddress, 48, supplierY, 9);
    supplierY -= 16;
  }
  if (params.config.registrationNumber) {
    draw(`Registration: ${params.config.registrationNumber}`, 48, supplierY, 9);
    supplierY -= 16;
  }
  if (params.config.taxNumber) draw(`Tax number: ${params.config.taxNumber}`, 48, supplierY, 9);

  draw("Bill to", 320, 670, 10, true);
  draw(params.customer.full_name || "Customer", 320, 651, 10);
  draw(params.customer.email, 320, 634, 9);
  draw(params.customer.company || "", 320, 617, 9);
  draw(params.customer.billing_address || "", 320, 600, 9);
  draw(
    [params.customer.billing_postal_code, params.customer.billing_city, params.customer.country]
      .filter(Boolean)
      .join(" "),
    320,
    583,
    9,
  );

  draw("Description", 48, 525, 10, true);
  draw("Amount", 460, 525, 10, true);
  page.drawLine({
    start: { x: 48, y: 514 },
    end: { x: 547, y: 514 },
    thickness: 1,
    color: rgb(0.82, 0.84, 0.88),
  });
  draw(description(params.type), 48, 486, 11, false, 68);
  draw(`$${params.amountUsd.toFixed(2)} USD`, 445, 486, 11, true);
  page.drawLine({
    start: { x: 48, y: 464 },
    end: { x: 547, y: 464 },
    thickness: 1,
    color: rgb(0.82, 0.84, 0.88),
  });
  draw("Total", 385, 430, 12, true);
  draw(`$${params.amountUsd.toFixed(2)} USD`, 445, 430, 12, true);
  draw(`Reference: ${params.reference}`, 48, 380, 9);
  draw("Currency: USD", 48, 362, 9);
  draw(`Support: ${params.config.supportEmail}`, 48, 96, 9);
  draw(params.config.siteUrl, 48, 79, 9);
  if (params.config.footerNote) draw(params.config.footerNote, 48, 62, 8, false, 115);
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

async function reserveInvoice(params: {
  customer: Row;
  type: "licence" | "renewal" | "topup" | "storage";
  amountUsd: number;
  reference: string;
  orderId?: string | null;
  topupId?: string | null;
  issuedAt?: string | null;
}) {
  const found = await existingInvoice(params.orderId, params.topupId);
  if (found) return found;
  const number = invoiceNumber(params.type, params.reference);
  const { data, error } = await db
    .from("wfilemanager_invoices")
    .insert({
      invoice_number: number,
      customer_id: params.customer.id,
      order_id: params.orderId || null,
      topup_id: params.topupId || null,
      invoice_type: params.type,
      status: "generating",
      currency: "USD",
      amount_usd: params.amountUsd,
      issued_at: params.issuedAt || new Date().toISOString(),
      pdf_storage_path: null,
      metadata: { reference: params.reference },
    })
    .select("*")
    .single();
  if (error) {
    if (String(error.code) === "23505") {
      const concurrent = await existingInvoice(params.orderId, params.topupId);
      if (concurrent) return concurrent;
    }
    throw error;
  }
  return data;
}

async function createInvoice(params: {
  customer: Row;
  type: "licence" | "renewal" | "topup" | "storage";
  amountUsd: number;
  reference: string;
  orderId?: string | null;
  topupId?: string | null;
  issuedAt?: string | null;
  config: Config;
}) {
  const invoice = await reserveInvoice(params);
  if (invoice.status === "paid" && invoice.pdf_storage_path) return invoice;
  const storagePath = `customers/${params.customer.id}/${invoice.invoice_number}.pdf`;
  try {
    const bytes = await renderPdf({
      invoiceNumber: invoice.invoice_number,
      type: params.type,
      customer: params.customer,
      amountUsd: params.amountUsd,
      reference: params.reference,
      issuedAt: invoice.issued_at,
      config: params.config,
    });
    const upload = await db.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });
    if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists"))
      throw upload.error;
    const { data, error } = await db
      .from("wfilemanager_invoices")
      .update({
        status: "paid",
        pdf_storage_path: storagePath,
        metadata: { ...(invoice.metadata || {}), reference: params.reference, generatedAt: new Date().toISOString() },
      })
      .eq("id", invoice.id)
      .select("*")
      .single();
    if (error) {
      await db.storage.from(BUCKET).remove([storagePath]);
      throw error;
    }
    return data;
  } catch (error) {
    await db
      .from("wfilemanager_invoices")
      .update({
        status: "failed",
        metadata: {
          ...(invoice.metadata || {}),
          reference: params.reference,
          generationError: error instanceof Error ? error.message : "Invoice generation failed",
          failedAt: new Date().toISOString(),
        },
      })
      .eq("id", invoice.id);
    throw error;
  }
}

async function generateForCustomer(customer: Row, settings: Config) {
  for (let from = 0; ; from += 200) {
    const { data: orders, error } = await db
      .from("wfilemanager_pro_orders")
      .select("id,order_reference,order_type,status,amount_usd,paid_at")
      .eq("customer_id", customer.id)
      .in("status", ["paid", "activation_sent", "renewal_applied", "upgrade_applied", "email_failed"])
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
        config: settings,
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
        config: settings,
      });
    if (!topups || topups.length < 200) break;
  }
}

async function listCustomerInvoices(customer: Row) {
  const { data, error } = await db
    .from("wfilemanager_invoices")
    .select("*")
    .eq("customer_id", customer.id)
    .eq("status", "paid")
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

async function generateAll(settings: Config) {
  const results: unknown[] = [];
  let checked = 0;
  for (let from = 0; ; from += 100) {
    const { data: customers, error } = await db
      .from("wfilemanager_customer_accounts")
      .select("*")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, from + 99);
    if (error) throw error;
    for (const customer of customers || []) {
      checked += 1;
      try {
        await generateForCustomer(customer, settings);
        results.push({ customer: customer.id, generated: true });
      } catch (error) {
        results.push({
          customer: customer.id,
          generated: false,
          error: error instanceof Error ? error.message : "Generation failed",
        });
      }
    }
    if (!customers || customers.length < 100) break;
  }
  return { checked, results };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const action = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "status";
    const settings = await config();
    if (action === "status")
      return json({ ok: true, privateDocuments: true, signedDownloads: true, orphanSafe: true });
    if (action === "invoices" && request.method === "GET") {
      const customer = await customerAuth(request);
      if (!customer) return json({ error: "Authentication required" }, 401);
      return json({ invoices: await listCustomerInvoices(customer) });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!(await automationAuthorized(request, settings.automationSecretHash)))
      return json({ error: "Unauthorized invoice automation" }, 401);
    if (action === "run" || action === "generate")
      return json({ ok: true, generation: await generateAll(settings) });
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Invoice service failed" }, 500);
  }
});
