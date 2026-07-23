import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function runtime() {
  return import("@/lib/server/local-runtime");
}

async function systemRuntime() {
  return import("@/lib/server/system-runtime");
}

async function storageRuntime() {
  return import("@/lib/server/storage-runtime");
}

async function analysisRuntime() {
  return import("@/lib/server/storage-analysis");
}

async function archiveRuntime() {
  return import("@/lib/server/archive-runtime-v2");
}

async function handleError(error: unknown) {
  const { LocalApiError } = await runtime();
  if (error instanceof LocalApiError) return json({ error: error.message }, error.status);
  const value = error as NodeJS.ErrnoException;
  const status = value?.code === "ENOENT" ? 404 : value?.code === "EACCES" || value?.code === "EPERM" ? 403 : value?.code === "EEXIST" ? 409 : 500;
  console.error(error);
  return json({ error: value?.message || "Local server operation failed" }, status);
}

export const Route = createFileRoute("/api/local")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const api = await runtime();
          const url = new URL(request.url);
          const action = url.searchParams.get("action") || "list";
          const target = url.searchParams.get("path") || "/";

          if (action === "system") {
            await api.requireUser(request);
            const system = await systemRuntime();
            return json(await system.systemSummary());
          }
          if (action === "storage") {
            await api.requireUser(request);
            const storage = await storageRuntime();
            return json(await storage.storageSummary());
          }
          if (action === "storage-analysis") {
            const user = await api.requireUser(request);
            const analysis = await analysisRuntime();
            const force = user.isAdmin && url.searchParams.get("refresh") === "1";
            return json(await analysis.storageAnalysis(force));
          }
          if (action === "archive-inspect") {
            await api.requirePermission(request, "browse");
            const archive = await archiveRuntime();
            return json(await archive.inspectArchive(target));
          }
          if (action === "update-info") {
            await api.requireUser(request);
            return json(await api.updateSummary());
          }
          if (action === "update-status") {
            await api.requireUser(request);
            return json(await api.updateSummary());
          }
          if (action === "terminal-user") {
            const user = await api.requirePermission(request, "use_terminal");
            return json(await api.terminalIdentity(user));
          }
          if (action === "pty-output") {
            const user = await api.requirePermission(request, "use_terminal");
            return json(api.readPtyOutput(user.id, url.searchParams.get("id"), url.searchParams.get("cursor")));
          }
          if (action === "job") {
            const user = await api.requireUser(request);
            return json({ job: api.getOperationJob(user.id, url.searchParams.get("id")) });
          }
          if (action === "list") {
            await api.requirePermission(request, "browse");
            return json(await api.listDirectory(target));
          }
          if (action === "read") {
            await api.requirePermission(request, "read");
            return json(await api.readTextFile(target));
          }
          if (action === "download") {
            await api.requirePermission(request, "download");
            return api.downloadResponse(target);
          }
          if (action === "trash-list") {
            const user = await api.requireAnyPermission(request, ["delete", "restore", "permanently_delete"]);
            return json(await api.listTrash(user));
          }
          return json({ error: "Unknown action" }, 404);
        } catch (error) {
          return handleError(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const api = await runtime();
          const url = new URL(request.url);
          const action = url.searchParams.get("action") || "";

          if (action === "provision-self") {
            const user = await api.requireUser(request);
            const body = await request.json().catch(() => ({})) as Record<string, unknown>;
            return json(await api.provisionCurrentLinuxUser(request, user, body.password), 201);
          }

          if (["pty-create", "pty-input", "pty-resize", "pty-close"].includes(action)) {
            const user = await api.requirePermission(request, "use_terminal");
            const body = await request.json().catch(() => ({})) as Record<string, unknown>;
            if (action === "pty-create") {
              if (String(body.mode || "user") === "root") await api.provisionCurrentLinuxUser(request, user, body.password);
              return json(await api.createPtySession(user, body.cwd, body.cols, body.rows, body.mode), 201);
            }
            if (action === "pty-input") return json(api.writePty(user.id, body.sessionId, body.data));
            if (action === "pty-resize") return json(api.resizePty(user.id, body.sessionId, body.cols, body.rows));
            return json(api.closePty(user.id, body.sessionId));
          }

          if (action === "upload-raw") {
            await api.requirePermission(request, "upload");
            return json(await api.saveRawUpload(url.searchParams.get("path") || "/", url.searchParams.get("name"), request.body), 201);
          }
          if (action === "upload") {
            await api.requirePermission(request, "upload");
            const form = await request.formData();
            return json(await api.saveUploads(url.searchParams.get("path") || "/", form), 201);
          }

          const body = await request.json().catch(() => ({})) as Record<string, unknown>;
          if (action === "archive-create") {
            await api.requirePermission(request, "create_files");
            const archive = await archiveRuntime();
            return json(await archive.createArchive(body.path, body.format), 201);
          }
          if (action === "archive-extract") {
            await api.requirePermission(request, "create_files");
            const archive = await archiveRuntime();
            return json(await archive.extractArchive(body.path, body.mode, body.folderName, body.destination, body.conflictPolicy), 201);
          }
          if (action === "update-install") {
            await api.requireAdmin(request);
            return json(await api.installAvailableUpdate(), 202);
          }
          if (action === "update-rollback") {
            await api.requireAdmin(request);
            return json(await api.rollbackApplicationUpdate(), 202);
          }
          if (action === "provision-user") {
            await api.requirePermission(request, "manage_users");
            return json(await api.provisionManagedLinuxUser(body.user, body.password), 201);
          }
          if (action === "deprovision-user") {
            const actor = await api.requirePermission(request, "manage_users");
            return json(await api.deprovisionManagedLinuxUser(actor, body.user));
          }
          if (action === "sync-linux-password") {
            const user = await api.requireUser(request);
            return json(await api.syncCurrentLinuxPassword(user, body.password));
          }
          if (action === "create-file") {
            await api.requirePermission(request, "create_files");
            return json(await api.createFileAt(body.path, body.name, body.content), 201);
          }
          if (action === "create-directory") {
            await api.requirePermission(request, "create_directories");
            return json(await api.createDirectoryAt(body.path, body.name), 201);
          }
          if (action === "save") {
            await api.requirePermission(request, "edit");
            return json(await api.saveTextFile(body.path, body.content));
          }
          if (action === "rename") {
            await api.requirePermission(request, "rename");
            return json(await api.renameEntry(body.path, body.name));
          }
          if (action === "chmod") {
            await api.requirePermission(request, "change_permissions");
            return json(await api.changeMode(body.path, body.mode));
          }
          if (action === "trash-move") {
            const user = await api.requirePermission(request, "delete");
            return json(await api.moveToTrash(user, body.path), 201);
          }
          if (action === "trash-restore") {
            const user = await api.requirePermission(request, "restore");
            return json(await api.restoreTrashItem(user, body.id));
          }
          if (action === "trash-delete") {
            const user = await api.requirePermission(request, "permanently_delete");
            return json(await api.permanentlyDeleteTrashItem(user, body.id));
          }
          if (action === "trash-empty") {
            const user = await api.requirePermission(request, "permanently_delete");
            return json(await api.emptyTrash(user));
          }
          if (action === "job-start") {
            const operation = String(body.operation || "");
            const permission = operation === "copy" ? "copy" : operation === "move" ? "move" : "permanently_delete";
            const user = await api.requirePermission(request, permission);
            return json({ job: api.startOperationJob(user.id, body.operation, body.source, body.destination) }, 202);
          }
          return json({ error: "Unknown action" }, 404);
        } catch (error) {
          return handleError(error);
        }
      },
    },
  },
});
