import crypto from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { LocalApiError, type LocalUser } from "@/lib/server/local-runtime";

type PtyProcess = import("node-pty").IPty;
type PtyChunk = { sequence: number; data: string };
type PtySession = {
  id: string;
  ownerUserId: string;
  process: PtyProcess;
  chunks: PtyChunk[];
  nextSequence: number;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
  lastSeenAt: number;
};

type RuntimeState = typeof globalThis & {
  __wfilemanagerAdminPtySessions?: Map<string, PtySession>;
};

const runtime = globalThis as RuntimeState;
const sessions = runtime.__wfilemanagerAdminPtySessions ??= new Map<string, PtySession>();
const MAX_SESSIONS_PER_ADMIN = Math.max(1, Number(process.env.WFILEMANAGER_MAX_TERMINAL_SESSIONS || 5));
const MAX_OUTPUT_CHUNKS = Math.max(500, Number(process.env.WFILEMANAGER_TERMINAL_OUTPUT_CHUNKS || 4000));
const IDLE_TIMEOUT_MS = Math.max(5 * 60_000, Number(process.env.WFILEMANAGER_TERMINAL_IDLE_TIMEOUT_MS || 30 * 60_000));

function assertAdministrator(user: LocalUser) {
  if (!user.isAdmin) throw new LocalApiError(403, "Administrator access is required for the terminal");
}

function normalizeCwd(input: unknown) {
  const value = typeof input === "string" && input.trim() ? input.trim() : "/root";
  if (value.includes("\0")) throw new LocalApiError(400, "Invalid terminal working directory");
  return path.resolve("/", value.startsWith("/") ? value : `/${value}`);
}

function ownedSession(ownerUserId: string, idInput: unknown) {
  const id = String(idInput || "");
  const session = sessions.get(id);
  if (!session || session.ownerUserId !== ownerUserId) throw new LocalApiError(404, "Terminal session not found");
  session.lastSeenAt = Date.now();
  return session;
}

function processEnvironment(user: LocalUser) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return {
    ...environment,
    HOME: "/root",
    USER: "root",
    LOGNAME: "root",
    SHELL: "/bin/bash",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "C.UTF-8",
    WFILEMANAGER_USER: user.username,
  };
}

export function terminalIdentity(user: LocalUser) {
  assertAdministrator(user);
  return { linuxUsername: "root", home: "/root", uid: 0, gid: 0, sudo: true };
}

export async function createRootPtySession(user: LocalUser, cwdInput: unknown, colsInput: unknown, rowsInput: unknown) {
  assertAdministrator(user);
  const openSessions = [...sessions.values()].filter((session) => session.ownerUserId === user.id && !session.exited);
  if (openSessions.length >= MAX_SESSIONS_PER_ADMIN) {
    throw new LocalApiError(429, `A maximum of ${MAX_SESSIONS_PER_ADMIN} terminal sessions may be open at once`);
  }

  let cwd = normalizeCwd(cwdInput);
  const cwdInfo = await stat(cwd).catch(() => null);
  if (!cwdInfo?.isDirectory()) cwd = "/root";

  const cols = Math.max(20, Math.min(400, Number(colsInput) || 120));
  const rows = Math.max(5, Math.min(200, Number(rowsInput) || 32));
  const nodePty = await import("node-pty");
  const process = nodePty.spawn("/bin/bash", ["--login"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: processEnvironment(user),
  });

  const id = crypto.randomUUID();
  const session: PtySession = {
    id,
    ownerUserId: user.id,
    process,
    chunks: [],
    nextSequence: 1,
    exited: false,
    exitCode: null,
    signal: null,
    lastSeenAt: Date.now(),
  };

  process.onData((data) => {
    session.chunks.push({ sequence: session.nextSequence++, data });
    if (session.chunks.length > MAX_OUTPUT_CHUNKS) {
      session.chunks.splice(0, session.chunks.length - Math.floor(MAX_OUTPUT_CHUNKS * 0.75));
    }
  });
  process.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode;
    session.signal = signal ?? null;
    session.chunks.push({ sequence: session.nextSequence++, data: `\r\n[Process exited with code ${exitCode}]\r\n` });
  });
  sessions.set(id, session);
  return { sessionId: id, mode: "root" as const, linuxUsername: "root", home: "/root" };
}

export function writePty(ownerUserId: string, idInput: unknown, dataInput: unknown) {
  const session = ownedSession(ownerUserId, idInput);
  if (session.exited) throw new LocalApiError(409, "Terminal process has exited");
  if (typeof dataInput !== "string") throw new LocalApiError(400, "Terminal input must be text");
  if (Buffer.byteLength(dataInput, "utf8") > 64 * 1024) throw new LocalApiError(413, "Terminal input is too large");
  session.process.write(dataInput);
  return { success: true as const };
}

export function resizePty(ownerUserId: string, idInput: unknown, colsInput: unknown, rowsInput: unknown) {
  const session = ownedSession(ownerUserId, idInput);
  const cols = Math.max(20, Math.min(400, Number(colsInput) || 120));
  const rows = Math.max(5, Math.min(200, Number(rowsInput) || 32));
  if (!session.exited) session.process.resize(cols, rows);
  return { success: true as const };
}

export function readPtyOutput(ownerUserId: string, idInput: unknown, cursorInput: unknown) {
  const session = ownedSession(ownerUserId, idInput);
  const cursor = Math.max(0, Number(cursorInput) || 0);
  const chunks = session.chunks.filter((chunk) => chunk.sequence > cursor);
  return {
    cursor: chunks.at(-1)?.sequence || cursor,
    data: chunks.map((chunk) => chunk.data).join(""),
    exited: session.exited,
    exitCode: session.exitCode,
    signal: session.signal,
  };
}

export function closePty(ownerUserId: string, idInput: unknown) {
  const session = ownedSession(ownerUserId, idInput);
  if (!session.exited) session.process.kill();
  sessions.delete(session.id);
  return { success: true as const };
}

const cleanupTimer = setInterval(() => {
  const staleBefore = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeenAt >= staleBefore) continue;
    if (!session.exited) session.process.kill();
    sessions.delete(id);
  }
}, 60_000);
(cleanupTimer as unknown as { unref?: () => void }).unref?.();
