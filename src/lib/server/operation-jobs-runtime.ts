import crypto from "node:crypto";
import path from "node:path";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { LocalApiError } from "@/lib/server/local-runtime";

const STATE_ROOT = path.resolve(process.env.WFILEMANAGER_STATE_ROOT || "/var/lib/wfilemanager");
const JOBS_FILE = path.join(STATE_ROOT, "operation-jobs.json");
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TREE_ENTRIES = Math.max(
  1_000,
  Number(process.env.WFILEMANAGER_JOB_MAX_ENTRIES || 200_000),
);
const MAX_TREE_DEPTH = Math.max(16, Number(process.env.WFILEMANAGER_JOB_MAX_DEPTH || 128));
const MAX_ACTIVE_PER_USER = Math.max(
  1,
  Number(process.env.WFILEMANAGER_JOB_MAX_ACTIVE_PER_USER || 2),
);
const MAX_ACTIVE_GLOBAL = Math.max(
  MAX_ACTIVE_PER_USER,
  Number(process.env.WFILEMANAGER_JOB_MAX_ACTIVE_GLOBAL || 8),
);

type OperationName = "copy" | "move" | "delete";
type OperationStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted";
type OperationPhase = "queued" | "scanning" | "copying" | "source_cleanup" | "deleting" | "done";

type TreeItem = {
  source: string;
  relative: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: number;
  linkTarget?: string;
};

export interface PersistentOperationJob {
  id: string;
  ownerUserId: string;
  operation: OperationName;
  source: string;
  destinationDirectory?: string;
  status: OperationStatus;
  phase: OperationPhase;
  progress: number;
  processedBytes: number;
  totalBytes: number;
  processedItems: number;
  totalItems: number;
  currentItem?: string;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, PersistentOperationJob>();
const cancellation = new Set<string>();
let initialized: Promise<void> | null = null;
let persistQueue = Promise.resolve();

function publicJob(job: PersistentOperationJob) {
  const {
    ownerUserId: _ownerUserId,
    source: _source,
    destinationDirectory: _destinationDirectory,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...value
  } = job;
  return { ...value, cancellable: !["source_cleanup", "done"].includes(job.phase) };
}

function updateProgress(job: PersistentOperationJob, patch: Partial<PersistentOperationJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const numerator = job.totalBytes > 0 ? job.processedBytes : job.processedItems;
  const denominator = job.totalBytes > 0 ? job.totalBytes : job.totalItems;
  if (!["completed", "cancelled"].includes(job.status))
    job.progress =
      denominator > 0 ? Math.max(0, Math.min(99, Math.round((numerator / denominator) * 100))) : 0;
}

async function persistNow() {
  await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
  const temporary = `${JOBS_FILE}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify([...jobs.values()], null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, JOBS_FILE);
}
function persist() {
  persistQueue = persistQueue.then(persistNow, persistNow);
  return persistQueue;
}

async function initialize() {
  if (initialized) return initialized;
  initialized = (async () => {
    await mkdir(STATE_ROOT, { recursive: true, mode: 0o700 });
    const stored = await readFile(JOBS_FILE, "utf8")
      .then((value) => JSON.parse(value) as PersistentOperationJob[])
      .catch(() => []);
    const now = Date.now();
    for (const job of stored) {
      job.phase ||= "queued";
      if (["queued", "running", "cancelling"].includes(job.status)) {
        job.status = "interrupted";
        job.error =
          job.phase === "source_cleanup"
            ? "The application restarted while finalizing a move. The destination was preserved; inspect both paths before retrying."
            : "The application restarted before this operation completed";
        job.updatedAt = now;
      }
      if (
        now - job.updatedAt <= TERMINAL_RETENTION_MS ||
        !["completed", "failed", "cancelled", "interrupted"].includes(job.status)
      )
        jobs.set(job.id, job);
    }
    await persist();
  })();
  return initialized;
}

function kind(info: Awaited<ReturnType<typeof lstat>>): TreeItem["kind"] {
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  if (info.isSymbolicLink()) return "symlink";
  return "other";
}

async function scanTree(root: string, job?: PersistentOperationJob) {
  const entries: TreeItem[] = [];
  async function visit(target: string, relative: string, depth: number) {
    if (depth > MAX_TREE_DEPTH)
      throw new LocalApiError(413, `The filesystem tree exceeds the depth limit of ${MAX_TREE_DEPTH}`);
    if (entries.length >= MAX_TREE_ENTRIES)
      throw new LocalApiError(
        413,
        `The filesystem tree exceeds the limit of ${MAX_TREE_ENTRIES.toLocaleString()} entries`,
      );
    if (job) throwIfCancelled(job);
    const info = await lstat(target);
    const itemKind = kind(info);
    const item: TreeItem = {
      source: target,
      relative,
      kind: itemKind,
      size: info.isFile() ? info.size : 0,
      mode: info.mode & 0o7777,
    };
    if (itemKind === "symlink") item.linkTarget = await readlink(target);
    entries.push(item);
    if (itemKind === "directory") {
      for (const name of await readdir(target))
        await visit(path.join(target, name), path.join(relative, name), depth + 1);
    }
  }
  await visit(root, "", 0);
  return entries;
}

function throwIfCancelled(job: PersistentOperationJob) {
  if (job.phase === "source_cleanup" || !cancellation.has(job.id)) return;
  updateProgress(job, {
    status: "cancelled",
    error: "Operation cancelled",
    currentItem: undefined,
    progress: 100,
  });
  throw new LocalApiError(499, "Operation cancelled");
}

async function copyTree(source: string, destination: string, job: PersistentOperationJob) {
  updateProgress(job, { phase: "scanning" });
  const items = await scanTree(source, job);
  job.totalItems = items.length;
  job.totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  updateProgress(job, { phase: "copying" });
  await persist();
  let checkpoint = 0;
  for (const item of items) {
    throwIfCancelled(job);
    const target = item.relative ? path.join(destination, item.relative) : destination;
    job.currentItem = item.source;
    if (item.kind === "directory") await mkdir(target, { recursive: false, mode: item.mode });
    else if (item.kind === "file") {
      await copyFile(item.source, target, fsConstants.COPYFILE_EXCL);
      await chmod(target, item.mode).catch(() => undefined);
    } else if (item.kind === "symlink") await symlink(item.linkTarget || "", target);
    else throw new LocalApiError(415, `Unsupported filesystem entry: ${item.source}`);
    updateProgress(job, {
      processedItems: job.processedItems + 1,
      processedBytes: job.processedBytes + item.size,
    });
    if (++checkpoint >= 20) {
      checkpoint = 0;
      await persist();
    }
  }
  await persist();
}

async function deleteTree(
  target: string,
  job: PersistentOperationJob,
  countProgress = true,
  cancellable = true,
) {
  if (countProgress) updateProgress(job, { phase: "scanning" });
  const items = await scanTree(target, cancellable ? job : undefined);
  if (countProgress) {
    job.totalItems = items.length;
    job.totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    updateProgress(job, { phase: "deleting" });
    await persist();
  }
  let checkpoint = 0;
  for (const item of [...items].reverse()) {
    if (cancellable) throwIfCancelled(job);
    job.currentItem = item.source;
    if (item.kind === "directory") await rmdir(item.source);
    else await unlink(item.source);
    if (countProgress)
      updateProgress(job, {
        processedItems: job.processedItems + 1,
        processedBytes: job.processedBytes + item.size,
      });
    if (++checkpoint >= 20) {
      checkpoint = 0;
      await persist();
    }
  }
}

async function perform(job: PersistentOperationJob) {
  updateProgress(job, { status: "running" });
  await persist();
  let partialDestination: string | null = null;
  let preservedDestination: string | null = null;
  try {
    if (job.operation === "delete") {
      await deleteTree(job.source, job);
      updateProgress(job, {
        status: "completed",
        phase: "done",
        progress: 100,
        result: { deleted: job.source },
        currentItem: undefined,
      });
      await persist();
      return;
    }

    if (!job.destinationDirectory)
      throw new LocalApiError(400, "A destination directory is required");
    const destination = path.join(job.destinationDirectory, path.basename(job.source));
    if (destination === job.source || destination.startsWith(`${job.source}${path.sep}`))
      throw new LocalApiError(400, "The destination cannot be inside the source");
    if (await lstat(destination).then(() => true).catch(() => false))
      throw new LocalApiError(409, `Destination already exists: ${destination}`);

    if (job.operation === "move") {
      try {
        updateProgress(job, { phase: "scanning" });
        const items = await scanTree(job.source, job);
        job.totalItems = items.length;
        job.totalBytes = items.reduce((sum, item) => sum + item.size, 0);
        job.currentItem = job.source;
        await rename(job.source, destination);
        updateProgress(job, {
          status: "completed",
          phase: "done",
          processedItems: job.totalItems,
          processedBytes: job.totalBytes,
          progress: 100,
          result: { source: job.source, destination },
          currentItem: undefined,
        });
        await persist();
        return;
      } catch (error) {
        const value = error as NodeJS.ErrnoException;
        if (value.code !== "EXDEV") throw error;
      }
    }

    partialDestination = destination;
    await copyTree(job.source, destination, job);
    throwIfCancelled(job);
    if (job.operation === "move") {
      preservedDestination = destination;
      partialDestination = null;
      cancellation.delete(job.id);
      updateProgress(job, {
        phase: "source_cleanup",
        result: { destination, destinationComplete: true, sourceCleanupPending: true },
      });
      await persist();
      await deleteTree(job.source, job, false, false);
    }
    partialDestination = null;
    updateProgress(job, {
      status: "completed",
      phase: "done",
      progress: 100,
      result: { source: job.source, destination },
      currentItem: undefined,
    });
    await persist();
  } catch (error) {
    if (partialDestination)
      await rm(partialDestination, { recursive: true, force: true }).catch(() => undefined);
    if (job.status !== "cancelled")
      updateProgress(job, {
        status: "failed",
        phase: "done",
        error: error instanceof Error ? error.message : "Operation failed",
        result: preservedDestination
          ? {
              destination: preservedDestination,
              destinationComplete: true,
              sourceMayBePartiallyPresent: true,
            }
          : job.result,
        currentItem: undefined,
      });
    await persist();
  } finally {
    cancellation.delete(job.id);
  }
}

function activeJobs(ownerUserId?: string) {
  return [...jobs.values()].filter(
    (job) =>
      (!ownerUserId || job.ownerUserId === ownerUserId) &&
      ["queued", "running", "cancelling"].includes(job.status),
  );
}

export async function startOperationJob(
  ownerUserId: string,
  operationInput: unknown,
  source: string,
  destinationDirectory?: string,
) {
  await initialize();
  const operation = String(operationInput || "") as OperationName;
  if (!["copy", "move", "delete"].includes(operation))
    throw new LocalApiError(400, "Unsupported operation");
  if (activeJobs(ownerUserId).length >= MAX_ACTIVE_PER_USER)
    throw new LocalApiError(429, "Too many filesystem operations are already running for this account");
  if (activeJobs().length >= MAX_ACTIVE_GLOBAL)
    throw new LocalApiError(503, "The filesystem operation queue is currently full");
  const conflicts = activeJobs().some(
    (job) =>
      job.source === source ||
      job.source.startsWith(`${source}${path.sep}`) ||
      source.startsWith(`${job.source}${path.sep}`),
  );
  if (conflicts)
    throw new LocalApiError(409, "Another filesystem operation already uses this path");

  const job: PersistentOperationJob = {
    id: crypto.randomUUID(),
    ownerUserId,
    operation,
    source,
    destinationDirectory,
    status: "queued",
    phase: "queued",
    progress: 0,
    processedBytes: 0,
    totalBytes: 0,
    processedItems: 0,
    totalItems: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  await persist();
  void perform(job);
  return publicJob(job);
}

export async function getOperationJob(ownerUserId: string, idInput: unknown) {
  await initialize();
  const job = jobs.get(String(idInput || ""));
  if (!job || job.ownerUserId !== ownerUserId) throw new LocalApiError(404, "Operation not found");
  return publicJob(job);
}

export async function cancelOperationJob(ownerUserId: string, idInput: unknown) {
  await initialize();
  const job = jobs.get(String(idInput || ""));
  if (!job || job.ownerUserId !== ownerUserId) throw new LocalApiError(404, "Operation not found");
  if (["completed", "failed", "cancelled", "interrupted"].includes(job.status))
    return publicJob(job);
  if (job.phase === "source_cleanup")
    throw new LocalApiError(
      409,
      "This move has completed its destination copy and is finalizing the source; it can no longer be cancelled safely",
    );
  cancellation.add(job.id);
  updateProgress(job, { status: "cancelling" });
  await persist();
  return publicJob(job);
}
