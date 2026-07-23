import { SqliteAuthError } from "@/lib/server/sqlite-store";

type Attempt = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
};

type Runtime = typeof globalThis & { __wfmLoginAttempts?: Map<string, Attempt> };
const runtime = globalThis as Runtime;
const attempts = runtime.__wfmLoginAttempts ??= new Map<string, Attempt>();

const WINDOW_MS = Math.max(60_000, Number(process.env.WFILEMANAGER_LOGIN_WINDOW_MS || 15 * 60 * 1000));
const BASE_BLOCK_MS = Math.max(30_000, Number(process.env.WFILEMANAGER_LOGIN_BLOCK_MS || 5 * 60 * 1000));
const MAX_FAILURES = Math.max(3, Number(process.env.WFILEMANAGER_LOGIN_MAX_FAILURES || 5));

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function key(request: Request, loginInput: unknown) {
  const login = String(loginInput || "").trim().toLowerCase().slice(0, 128);
  return `${requestIp(request)}\u0000${login}`;
}

function current(request: Request, loginInput: unknown) {
  const id = key(request, loginInput);
  const now = Date.now();
  let value = attempts.get(id);
  if (!value || now - value.windowStartedAt > WINDOW_MS) {
    value = { failures: 0, windowStartedAt: now, blockedUntil: 0, lastSeenAt: now };
    attempts.set(id, value);
  }
  value.lastSeenAt = now;
  return { id, value, now };
}

export function assertLoginAllowed(request: Request, loginInput: unknown) {
  const { value, now } = current(request, loginInput);
  if (value.blockedUntil > now) {
    const seconds = Math.max(1, Math.ceil((value.blockedUntil - now) / 1000));
    throw new SqliteAuthError(429, `Too many failed sign-in attempts. Try again in ${seconds} seconds.`);
  }
}

export function recordLoginFailure(request: Request, loginInput: unknown) {
  const { value, now } = current(request, loginInput);
  value.failures += 1;
  if (value.failures >= MAX_FAILURES) {
    const multiplier = Math.min(6, value.failures - MAX_FAILURES + 1);
    value.blockedUntil = now + BASE_BLOCK_MS * multiplier;
  }
}

export function recordLoginSuccess(request: Request, loginInput: unknown) {
  attempts.delete(key(request, loginInput));
}

const cleanup = setInterval(() => {
  const staleBefore = Date.now() - Math.max(WINDOW_MS * 2, 60 * 60 * 1000);
  for (const [id, attempt] of attempts) {
    if (attempt.lastSeenAt < staleBefore && attempt.blockedUntil < Date.now()) attempts.delete(id);
  }
}, 10 * 60 * 1000);
(cleanup as unknown as { unref?: () => void }).unref?.();
