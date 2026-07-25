import { readFile } from "node:fs/promises";
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const PROJECT_URL = (
  process.env.WFILEMANAGER_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://igihzeyfgwhnuiflamvn.supabase.co"
).replace(/\/$/, "");
const DATABASE_MODE = process.env.WFILEMANAGER_DATABASE_MODE === "sqlite" ? "sqlite" : "supabase";
const INSTANCE_KEY =
  process.env.WFILEMANAGER_INSTANCE_KEY ||
  process.env.VITE_WFILEMANAGER_INSTANCE_KEY ||
  "kmerhosting-main";
const COOKIE_NAME = "wfm_session";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_JSON_BODY_BYTES = Math.max(
  16 * 1024,
  Number(process.env.WFILEMANAGER_GATEWAY_MAX_BODY_BYTES || 1024 * 1024),
);

const endpoints = {
  auth: `${PROJECT_URL}/functions/v1/wfilemanager-api`,
  login: `${PROJECT_URL}/functions/v1/wfilemanager-login-api`,
  setup: `${PROJECT_URL}/functions/v1/wfilemanager-setup-api`,
  roles: `${PROJECT_URL}/functions/v1/wfilemanager-roles-api`,
  account: `${PROJECT_URL}/functions/v1/wfilemanager-account-api`,
  users: `${PROJECT_URL}/functions/v1/wfilemanager-users-admin-api`,
  presence: `${PROJECT_URL}/functions/v1/wfilemanager-presence-api`,
  notifications: `${PROJECT_URL}/functions/v1/wfilemanager-notifications-api`,
} as const;

type Scope = keyof typeof allowedActions;

const allowedActions = {
  auth: new Set(["status", "me", "logout", "logs"]),
  login: new Set(["login"]),
  setup: new Set(["setup"]),
  roles: new Set(["permissions", "roles"]),
  account: new Set(["profile", "password", "sessions"]),
  users: new Set(["users"]),
  presence: new Set(["presence"]),
  notifications: new Set(["notifications"]),
} as const;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

function secureRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

function sessionCookie(request: Request, token: string, expiresAt?: unknown) {
  const expiry = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : NaN;
  const maxAge = Number.isFinite(expiry)
    ? Math.max(60, Math.min(30 * 24 * 60 * 60, Math.floor((expiry - Date.now()) / 1000)))
    : 12 * 60 * 60;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureRequest(request) ? "; Secure" : ""}`;
}

function clearCookie(request: Request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureRequest(request) ? "; Secure" : ""}`;
}

function sameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function validScope(value: string): value is Scope {
  return Object.prototype.hasOwnProperty.call(allowedActions, value);
}

function upstreamFor(request: Request, scope: Scope, action: string) {
  if (DATABASE_MODE === "sqlite") {
    const url = new URL("/api/sqlite", request.url);
    url.searchParams.set(
      "scope",
      scope === "login" || scope === "setup" ? "auth" : scope === "users" ? "auth" : scope,
    );
    url.searchParams.set("action", action);
    return url;
  }
  if (scope === "login") return new URL(endpoints.login);
  if (scope === "setup") return new URL(endpoints.setup);
  return new URL(`${endpoints[scope]}/${action}`);
}

async function sqliteSetupSecret() {
  const secretFile =
    process.env.WFILEMANAGER_SETUP_SECRET_FILE || "/etc/wfilemanager/setup-secret.key";
  return (await readFile(secretFile, "utf8").catch(() => "")).trim();
}

async function requestBody(request: Request, scope: Scope) {
  if (["GET", "HEAD"].includes(request.method)) return undefined;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BODY_BYTES)
    throw Object.assign(new Error("The request body is too large"), { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_JSON_BODY_BYTES)
    throw Object.assign(new Error("The request body is too large"), { status: 413 });
  if (scope !== "setup") return bytes;

  const text = new TextDecoder().decode(bytes);
  const payload = (JSON.parse(text || "{}") || {}) as Record<string, unknown>;
  if (DATABASE_MODE === "sqlite") {
    return JSON.stringify({ ...payload, setupSecret: await sqliteSetupSecret() });
  }
  const publicUrl =
    process.env.WFILEMANAGER_PUBLIC_BASE_URL ||
    `${secureRequest(request) ? "https" : "http"}://${request.headers.get("host") || new URL(request.url).host}`;
  return JSON.stringify({
    ...payload,
    rootResetTokenHash:
      process.env.WFILEMANAGER_ROOT_RESET_TOKEN_HASH ||
      process.env.VITE_WFILEMANAGER_ROOT_RESET_TOKEN_HASH ||
      "",
    instanceSecretHash:
      process.env.WFILEMANAGER_INSTANCE_SECRET_HASH ||
      process.env.VITE_WFILEMANAGER_INSTANCE_SECRET_HASH ||
      "",
    hostname:
      process.env.WFILEMANAGER_DOMAIN ||
      request.headers.get("host")?.split(":")[0] ||
      new URL(request.url).hostname,
    baseUrl: publicUrl.replace(/\/$/, ""),
  });
}

async function proxy(request: Request) {
  try {
    const url = new URL(request.url);
    const scopeValue = url.searchParams.get("scope") || "auth";
    const action = url.searchParams.get("action") || "status";
    if (!validScope(scopeValue) || !allowedActions[scopeValue].has(action))
      return json({ error: "Unsupported gateway action" }, 404);
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request))
      return json({ error: "Cross-origin request rejected" }, 403);

    const upstreamUrl = upstreamFor(request, scopeValue, action);
    for (const [key, value] of url.searchParams) {
      if (key !== "scope" && key !== "action") upstreamUrl.searchParams.append(key, value);
    }

    const headers = new Headers({
      Accept: "application/json",
      "x-wfilemanager-instance": INSTANCE_KEY,
    });
    const sessionToken = cookieValue(request, COOKIE_NAME);
    if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
    if (!["GET", "HEAD"].includes(request.method)) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: await requestBody(request, scopeValue),
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return json({ error: "The backend request timed out" }, 504);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
    });

    if (scopeValue === "login" && upstream.ok && typeof payload.token === "string") {
      responseHeaders.append("Set-Cookie", sessionCookie(request, payload.token, payload.expiresAt));
      delete payload.token;
    }
    if (action === "logout" || upstream.status === 401 || payload.currentRevoked === true)
      responseHeaders.append("Set-Cookie", clearCookie(request));

    return new Response(JSON.stringify(payload), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 500);
    return json(
      { error: error instanceof Error ? error.message : "Gateway request failed" },
      status,
    );
  }
}

export const Route = createFileRoute("/api/gateway")({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
      PATCH: ({ request }) => proxy(request),
      DELETE: ({ request }) => proxy(request),
    },
  },
});
