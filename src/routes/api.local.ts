import path from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function runtime() {
  return import("@/lib/server/local-runtime");
}
async function authRuntime() {
  return import("@/lib/server/local-auth-runtime");
}
async function overviewRuntime() {
  return import("@/lib/server/file-manager-runtime");
}
async function archiveRuntime() {
  return import("@/lib/server/archive-runtime-v2");
}
async function safePathRuntime() {
  return import("@/lib/server/safe-path-runtime");
}
async function uploadRuntime() {
  return import("@/lib/server/upload-runtime");
}
async function archiveGuard() {
  return import("@/lib/server/archive-guard");
}
async function terminalRuntime() {
  return import("@/lib/server/terminal-runtime");
}
async function directoryRuntime() {
  return import("@/lib/server/directory-runtime");
}
async function atomicFileRuntime() {
  return import("@/lib/server/atomic-file-runtime");
}
async function operationRuntime() {
  return import("@/lib/server/operation-jobs-runtime");
}
async function downloadRuntime() {
  return import("@/lib/server/download-runtime");
}
async function hashRuntime() {
  return import("@/lib/server/file-hash-runtime");
}

function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function handleError(error: unknown) {
  const { LocalApiError } = await runtime();
  if (error instanceof LocalApiError) return json({ error: error.message }, error.status);
  const value = error as NodeJS.ErrnoException;
  const status =
    value?.code === "ENOENT"
      ? 404
      : value?.code === "EACCES" || value?.code === "EPERM"
        ? 403
        : value?.code === "EEXIST"
          ? 409
          : 500;
  console.error(error);
  return json({ error: value?.message || "Local server operation failed" }, status);
}

export const Route = createFileRoute("/api/local")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const api = await runtime();
          const auth = await authRuntime();
          const url = new URL(request.url);
          const action = url.searchParams.get("action") || "list";
          const target = url.searchParams.get("path") || "/";

          if (action === "overview") {
            await auth.requireUser(request);
            const overview = await overviewRuntime();
            return json(await overview.fileManagerSummary());
          }
          if (action === "archive-inspect") {
            await auth.requirePermission(request, "browse");
            const archive = await archiveRuntime();
            const guard = await archiveGuard();
            const [inspection, safety] = await Promise.all([
              archive.inspectArchive(target),
              guard.inspectArchiveSafety(target),
            ]);
            return json({ ...inspection, safety });
          }
          if (action === "update-info" || action === "update-status") {
            await auth.requireUser(request);
            return json(await api.updateSummary());
          }
          if (action === "terminal-user") {
            const user = await auth.requireAdmin(request);
            const terminal = await terminalRuntime();
            return json(terminal.terminalIdentity(user));
          }
          if (action === "pty-output") {
            const user = await auth.requireAdmin(request);
            const terminal = await terminalRuntime();
            return json(
              terminal.readPtyOutput(
                user.id,
                url.searchParams.get("id"),
                url.searchParams.get("cursor"),
              ),
            );
          }
          if (action === "job") {
            const user = await auth.requireUser(request);
            const operations = await operationRuntime();
            return json({
              job: await operations.getOperationJob(user.id, url.searchParams.get("id")),
            });
          }
          if (action === "list") {
            await auth.requirePermission(request, "browse");
            const directory = await directoryRuntime();
            return json(
              await directory.listDirectoryPage(target, {
                cursor: url.searchParams.get("cursor"),
                query: url.searchParams.get("q"),
                limit: url.searchParams.get("limit"),
              }),
            );
          }
          if (action === "read") {
            await auth.requirePermission(request, "read");
            return json(await api.readTextFile(target));
          }
          if (action === "download") {
            await auth.requirePermission(request, "download");
            const download = await downloadRuntime();
            return download.streamedDownloadResponse(request, target);
          }
          if (action === "trash-list") {
            const user = await auth.requireAnyPermission(request, [
              "delete",
              "restore",
              "permanently_delete",
            ]);
            return json(await api.listTrash(user));
          }
          return json({ error: "Unknown action" }, 404);
        } catch (error) {
          return handleError(error);
        }
      },
      POST: async ({ request }) => {
        try {
          if (!sameOrigin(request)) return json({ error: "Cross-origin request rejected" }, 403);
          const api = await runtime();
          const auth = await authRuntime();
          const safe = await safePathRuntime();
          const url = new URL(request.url);
          const action = url.searchParams.get("action") || "";

          if (["pty-create", "pty-input", "pty-resize", "pty-close"].includes(action)) {
            const user = await auth.requireAdmin(request);
            const terminal = await terminalRuntime();
            const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
            if (action === "pty-create") {
              await auth.verifyCurrentPassword(request, body.password);
              return json(
                await terminal.createRootPtySession(user, body.cwd, body.cols, body.rows),
                201,
              );
            }
            if (action === "pty-input")
              return json(terminal.writePty(user.id, body.sessionId, body.data));
            if (action === "pty-resize")
              return json(terminal.resizePty(user.id, body.sessionId, body.cols, body.rows));
            return json(terminal.closePty(user.id, body.sessionId));
          }

          if (action === "upload-raw") {
            await auth.requirePermission(request, "upload");
            const upload = await uploadRuntime();
            return json(
              await upload.saveRawUpload(
                url.searchParams.get("path") || "/",
                url.searchParams.get("name"),
                request.body,
              ),
              201,
            );
          }
          if (action === "upload") {
            await auth.requirePermission(request, "upload");
            const upload = await uploadRuntime();
            const form = await request.formData();
            return json(await upload.saveUploads(url.searchParams.get("path") || "/", form), 201);
          }

          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          if (action === "archive-create") {
            await auth.requirePermission(request, "create_files");
            await safe.assertSafeExistingMutation(body.path);
            const archive = await archiveRuntime();
            return json(await archive.createArchive(body.path, body.format), 201);
          }
          if (action === "archive-extract") {
            await auth.requirePermission(request, "create_files");
            const archivePath = await safe.assertSafeExistingMutation(body.path);
            const parent = path.dirname(archivePath);
            let destination = parent;
            if (body.mode === "custom")
              destination = await safe.assertSafeDirectory(body.destination);
            else if (body.mode === "folder")
              destination = await safe.assertSafeDestination(
                path.join(parent, String(body.folderName || "extracted")),
              );
            else await safe.assertSafeDirectory(parent);
            const guard = await archiveGuard();
            await guard.inspectArchiveSafety(archivePath, destination);
            const archive = await archiveRuntime();
            return json(
              await archive.extractArchive(
                archivePath,
                body.mode,
                body.folderName,
                destination,
                body.conflictPolicy,
              ),
              201,
            );
          }
          if (action === "update-install") {
            await auth.requireAdmin(request);
            return json(await api.installAvailableUpdate(), 202);
          }
          if (action === "update-rollback") {
            await auth.requireAdmin(request);
            return json(await api.rollbackApplicationUpdate(), 202);
          }
          if (action === "create-file") {
            await auth.requirePermission(request, "create_files");
            await safe.assertDestinationAbsent(
              path.join(String(body.path || "/"), String(body.name || "")),
            );
            return json(await api.createFileAt(body.path, body.name, body.content), 201);
          }
          if (action === "create-directory") {
            await auth.requirePermission(request, "create_directories");
            await safe.assertDestinationAbsent(
              path.join(String(body.path || "/"), String(body.name || "")),
            );
            return json(await api.createDirectoryAt(body.path, body.name), 201);
          }
          if (action === "save") {
            await auth.requirePermission(request, "edit");
            const atomic = await atomicFileRuntime();
            return json(
              await atomic.saveTextFileAtomic(body.path, body.content, body.expectedModifiedAt),
            );
          }
          if (action === "rename") {
            await auth.requirePermission(request, "rename");
            const source = await safe.assertSafeExistingMutation(body.path);
            await safe.assertDestinationAbsent(
              path.join(path.dirname(source), String(body.name || "")),
            );
            return json(await api.renameEntry(source, body.name));
          }
          if (action === "chmod") {
            await auth.requirePermission(request, "change_permissions");
            const target = await safe.assertSafeExistingMutation(body.path);
            return json(await api.changeMode(target, body.mode));
          }
          if (action === "checksum") {
            await auth.requirePermission(request, "calculate_checksums");
            const hashes = await hashRuntime();
            return json(await hashes.fileIntegrityHash(body.path, body.algorithm));
          }
          if (action === "trash-move") {
            const user = await auth.requirePermission(request, "delete");
            const target = await safe.assertSafeExistingMutation(body.path);
            return json(await api.moveToTrash(user, target), 201);
          }
          if (action === "trash-restore") {
            const user = await auth.requirePermission(request, "restore");
            const trash = await api.listTrash(user);
            const item = trash.items.find((candidate) => candidate.id === String(body.id || ""));
            if (!item) return json({ error: "Trash item not found" }, 404);
            await safe.assertSafeDestination(item.originalPath);
            return json(await api.restoreTrashItem(user, body.id));
          }
          if (action === "trash-delete") {
            const user = await auth.requirePermission(request, "permanently_delete");
            return json(await api.permanentlyDeleteTrashItem(user, body.id));
          }
          if (action === "trash-empty") {
            const user = await auth.requirePermission(request, "permanently_delete");
            return json(await api.emptyTrash(user));
          }
          if (action === "job-start") {
            const operation = String(body.operation || "");
            const permission =
              operation === "copy" ? "copy" : operation === "move" ? "move" : "permanently_delete";
            const user = await auth.requirePermission(request, permission);
            const source = await safe.assertSafeExistingMutation(body.source);
            const destination =
              operation === "delete" ? undefined : await safe.assertSafeDirectory(body.destination);
            const operations = await operationRuntime();
            return json(
              { job: await operations.startOperationJob(user.id, operation, source, destination) },
              202,
            );
          }
          if (action === "job-cancel") {
            const user = await auth.requireUser(request);
            const operations = await operationRuntime();
            return json({ job: await operations.cancelOperationJob(user.id, body.id) });
          }
          return json({ error: "Unknown action" }, 404);
        } catch (error) {
          return handleError(error);
        }
      },
    },
  },
});
