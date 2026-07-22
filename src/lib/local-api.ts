import { wfilemanagerApi, type AuthUser } from "./wfilemanager-api";

export interface LocalFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mode: string;
  uid: number;
  gid: number;
  modifiedAt: string;
  createdAt: string;
  accessedAt: string;
  hidden: boolean;
  linkTarget?: string;
  mime: string;
  readable: boolean;
  writable: boolean;
}

export interface DirectoryResult {
  path: string;
  realPath: string;
  entries: LocalFileEntry[];
}

export interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  deletedAt: string;
  deletedBy: string;
  size: number;
  kind: LocalFileEntry["kind"];
}

export interface TrashResult {
  items: TrashItem[];
  totalSize: number;
}

export interface ProgressState {
  loaded: number;
  total: number;
  percent: number;
  detail?: string;
}

export interface OperationJob {
  id: string;
  operation: "copy" | "move" | "delete";
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  processedBytes: number;
  totalBytes: number;
  processedItems: number;
  totalItems: number;
  currentItem?: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface PtyOutput {
  cursor: number;
  data: string;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
}

export interface TerminalIdentity {
  linuxUsername: string;
  home: string;
  uid: number;
  gid: number;
  sudo: boolean;
}

export interface StorageMount {
  device: string;
  mountpoint: string;
  fstype: string;
  options: string;
  total: number;
  used: number;
  available: number;
  percent: number;
  inodesTotal: number;
  inodesUsed: number;
  inodesAvailable: number;
  inodePercent: number;
  readonly: boolean;
  health: "healthy" | "warning" | "critical" | "read-only";
}

export type UpdatePhase =
  | "idle" | "checking" | "downloading" | "verifying" | "extracting"
  | "installing" | "building" | "switching" | "restarting"
  | "health-check" | "completed" | "failed" | "rolling-back";

export interface UpdateState {
  status: UpdatePhase;
  progress: number;
  message: string;
  currentVersion?: string | null;
  targetVersion?: string | null;
  previousVersion?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  sourceConfigured: boolean;
  downloadUrl?: string | null;
  notes?: string | null;
  publishedAt?: string | null;
  size?: number | null;
  sha256?: string | null;
  channel?: string | null;
  checkedAt: string;
  state: UpdateState;
  rollbackAvailable: boolean;
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Local API request failed (${response.status})`);
  return payload as T;
}

function headers(json = true): HeadersInit {
  const token = wfilemanagerApi.getToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get<T>(action: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams({ action, ...params });
  return parse<T>(await fetch(`/api/local?${query}`, { headers: headers(false), cache: "no-store" }));
}

async function post<T>(action: string, body: Record<string, unknown>) {
  return parse<T>(await fetch(`/api/local?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(body),
  }));
}

function abortError(message: string) {
  return new DOMException(message, "AbortError");
}

function notifySilently(data: { title: string; message?: string; tone?: "info" | "success" | "warning" | "error"; link?: string; source?: string }) {
  void wfilemanagerApi.createNotification(data).catch(() => undefined);
}

function uploadSingleFile(
  path: string,
  file: File,
  onProgress?: (loaded: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<LocalFileEntry>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(`Upload cancelled for ${file.name}`));
      return;
    }
    const query = new URLSearchParams({ action: "upload-raw", path, name: file.name });
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    xhr.open("POST", `/api/local?${query}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    const token = wfilemanagerApi.getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => onProgress?.(event.loaded);
    xhr.onerror = () => {
      cleanup();
      reject(new Error(`Upload connection failed for ${file.name}`));
    };
    xhr.onabort = () => {
      cleanup();
      reject(abortError(`Upload cancelled for ${file.name}`));
    };
    xhr.onload = () => {
      cleanup();
      let payload: any = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch { /* ignore invalid error payload */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(payload.error || `Upload failed for ${file.name} (${xhr.status})`));
        return;
      }
      onProgress?.(file.size);
      resolve(payload as LocalFileEntry);
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}

async function uploadWithProgress(
  path: string,
  files: FileList | File[],
  onProgress?: (progress: ProgressState) => void,
  signal?: AbortSignal,
) {
  const values = Array.from(files);
  const total = values.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  const uploaded: LocalFileEntry[] = [];
  onProgress?.({ loaded: 0, total, percent: 0 });

  for (const file of values) {
    if (signal?.aborted) throw abortError("Upload cancelled");
    const entry = await uploadSingleFile(path, file, (currentFileLoaded) => {
      const loaded = Math.min(total, completed + currentFileLoaded);
      onProgress?.({
        loaded,
        total,
        percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 100,
        detail: file.name,
      });
    }, signal);
    completed += file.size;
    uploaded.push(entry);
  }

  onProgress?.({ loaded: total, total, percent: 100 });
  notifySilently({
    title: "Upload completed",
    message: `${values.length} file(s) uploaded to ${path}.`,
    tone: "success",
    link: `/explorer?path=${encodeURIComponent(path)}`,
    source: "upload",
  });
  return { uploaded };
}

async function runJob(
  operation: "copy" | "move" | "delete",
  source: string,
  destination: string | undefined,
  onProgress?: (job: OperationJob) => void,
) {
  const started = await post<{ job: OperationJob }>("job-start", { operation, source, destination });
  onProgress?.(started.job);

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const current = await get<{ job: OperationJob }>("job", { id: started.job.id });
    onProgress?.(current.job);
    if (current.job.status === "completed") {
      notifySilently({
        title: `${operation[0].toUpperCase()}${operation.slice(1)} completed`,
        message: destination ? `${source} → ${destination}` : source,
        tone: "success",
        link: destination ? `/explorer?path=${encodeURIComponent(destination)}` : "/trash",
        source: "file-operation",
      });
      return current.job;
    }
    if (current.job.status === "failed") throw new Error(current.job.error || `${operation} failed`);
  }
}

async function downloadWithProgress(
  path: string,
  filename: string,
  onProgress?: (progress: ProgressState) => void,
  signal?: AbortSignal,
) {
  const token = wfilemanagerApi.getToken();
  const response = await fetch(`/api/local?action=download&path=${encodeURIComponent(path)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Download failed");
  }

  const total = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress?.({ loaded, total, percent: 0, detail: filename });

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw abortError("Download cancelled");
      }
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.({
          loaded,
          total,
          percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
          detail: filename,
        });
      }
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    chunks.push(buffer);
    loaded = buffer.byteLength;
  }

  const blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  onProgress?.({ loaded: total || loaded, total: total || loaded, percent: 100, detail: filename });
  notifySilently({ title: "Download completed", message: `${filename} was downloaded.`, tone: "success", source: "download" });
  return { downloaded: path, size: loaded };
}

export const localApi = {
  list: (path: string) => get<DirectoryResult>("list", { path }),
  read: (path: string) => get<{ path: string; content: string; size: number; mime: string; modifiedAt: string; mode: string }>("read", { path }),
  createFile: async (path: string, name: string) => {
    const result = await post<LocalFileEntry>("create-file", { path, name });
    notifySilently({ title: "File created", message: result.path, tone: "success", link: `/explorer?path=${encodeURIComponent(path)}`, source: "file-operation" });
    return result;
  },
  createDirectory: async (path: string, name: string) => {
    const result = await post<LocalFileEntry>("create-directory", { path, name });
    notifySilently({ title: "Folder created", message: result.path, tone: "success", link: `/explorer?path=${encodeURIComponent(path)}`, source: "file-operation" });
    return result;
  },
  save: (path: string, content: string) => post("save", { path, content }),
  rename: (path: string, name: string) => post("rename", { path, name }),
  delete: (path: string, onProgress?: (job: OperationJob) => void) => runJob("delete", path, undefined, onProgress),
  copy: (source: string, destination: string, onProgress?: (job: OperationJob) => void) => runJob("copy", source, destination, onProgress),
  move: (source: string, destination: string, onProgress?: (job: OperationJob) => void) => runJob("move", source, destination, onProgress),
  chmod: (path: string, mode: string) => post("chmod", { path, mode }),
  trash: {
    list: () => get<TrashResult>("trash-list"),
    move: async (path: string) => {
      const result = await post<TrashItem>("trash-move", { path });
      notifySilently({ title: "Moved to trash", message: result.originalPath, tone: "info", link: "/trash", source: "trash" });
      return result;
    },
    restore: async (id: string) => {
      const result = await post<{ restored: string; item: TrashItem }>("trash-restore", { id });
      const restoredParent = result.restored.split("/").slice(0, -1).join("/") || "/";
      notifySilently({ title: "Item restored", message: result.restored, tone: "success", link: `/explorer?path=${encodeURIComponent(restoredParent)}`, source: "trash" });
      return result;
    },
    delete: async (id: string) => {
      const result = await post<{ deleted: string; item: TrashItem }>("trash-delete", { id });
      notifySilently({ title: "Item permanently deleted", message: result.item.originalPath, tone: "warning", source: "trash" });
      return result;
    },
    empty: async () => {
      const result = await post<{ deletedItems: number; deletedBytes: number }>("trash-empty", {});
      notifySilently({ title: "Trash emptied", message: `${result.deletedItems} item(s) permanently deleted.`, tone: "warning", source: "trash" });
      return result;
    },
  },
  system: () => get<{
    loginUsers: number;
    hostname: string;
    platform: string;
    release: string;
    architecture: string;
    uptime: number;
    memory: { total: number; free: number };
    disk: { total: number; used: number; available: number; percent: number } | null;
    node: string;
    os: { id: string; name: string; versionId: string; versionCodename: string; prettyName: string };
  }>("system"),
  storage: () => get<{ mounts: StorageMount[]; primary: StorageMount | null; volumeCount: number; generatedAt: string }>("storage"),
  updateInfo: () => get<UpdateInfo>("update-info"),
  installUpdate: () => post<{ success: true; state: UpdateState }>("update-install", {}),
  rollbackUpdate: () => post<{ success: true; state: UpdateState }>("update-rollback", {}),
  upload: uploadWithProgress,
  download: downloadWithProgress,
  terminalIdentity: () => get<TerminalIdentity>("terminal-user"),
  provisionSelf: (password: string) => post<TerminalIdentity>("provision-self", { password }),
  provisionUser: (user: AuthUser, password: string) => post<TerminalIdentity>("provision-user", { user, password }),
  deprovisionUser: (user: AuthUser) => post<{ success: true; linuxUsername: string; removed: boolean }>("deprovision-user", { user }),
  syncLinuxPassword: (password: string) => post<TerminalIdentity>("sync-linux-password", { password }),
  ptyCreate: (cwd: string | undefined, cols = 120, rows = 32, mode: "user" | "root" = "user", password?: string) =>
    post<{ sessionId: string; mode: "user" | "root"; linuxUsername: string; home: string }>("pty-create", { cwd, cols, rows, mode, password }),
  ptyInput: (sessionId: string, data: string) => post<{ success: true }>("pty-input", { sessionId, data }),
  ptyResize: (sessionId: string, cols: number, rows: number) => post<{ success: true }>("pty-resize", { sessionId, cols, rows }),
  ptyOutput: (sessionId: string, cursor: number) => get<PtyOutput>("pty-output", { id: sessionId, cursor: String(cursor) }),
  ptyClose: (sessionId: string) => post<{ success: true }>("pty-close", { sessionId }),
};
