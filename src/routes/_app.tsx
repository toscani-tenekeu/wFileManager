import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-shell/sidebar";
import { ConnectionBanner, Topbar } from "@/components/app-shell/topbar";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { NotificationProvider } from "@/lib/notifications";
import { localApi, type UpdateInfo } from "@/lib/local-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const UPDATE_CHECK_INTERVAL_MS = 1_800;
const UPDATE_START_GRACE_MS = 6_000;
const UPDATE_BLOCKING_PHASES = new Set([
  "downloading",
  "verifying",
  "extracting",
  "installing",
  "building",
  "switching",
  "restarting",
  "health-check",
  "rolling-back",
]);

function isUpdateBlocking(update: UpdateInfo | null) {
  return Boolean(update && UPDATE_BLOCKING_PHASES.has(update.state.status));
}

function formatUpdatePhase(update: UpdateInfo | null, starting: boolean) {
  if (isUpdateBlocking(update)) return update!.state.status.replace(/-/g, " ");
  if (starting) return "starting update";
  if (!update) return "preparing update";
  return update.state.status.replace(/-/g, " ");
}

function formatUpdateMessage(update: UpdateInfo | null, starting: boolean) {
  if (isUpdateBlocking(update)) return update?.state.message || "The updater is running.";
  if (update?.state.status === "failed")
    return update.state.error || update.state.message || "Update failed.";
  if (starting) return "Waiting for the updater to report progress…";
  return update?.state.message || "The updater is preparing the verified release package.";
}

function AppLayout() {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.loading && !auth.user) {
      navigate({ to: auth.configured === false ? "/setup" : "/login" });
    }
  }, [auth.loading, auth.user, auth.configured, navigate]);

  if (auth.loading || !auth.user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Loading wFileManager…
      </div>
    );
  }

  return (
    <NotificationProvider>
      <UpdateGate isAdmin={auth.user.isAdmin} />
      <div className="flex min-h-screen bg-background text-foreground">
        <div className="hidden lg:flex">
          <AppSidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <ConnectionBanner />
          <main className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}

function UpdateGate({ isAdmin }: { isAdmin: boolean }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startingSince, setStartingSince] = useState<number | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const activeUpdate = isUpdateBlocking(update);
  const blocking = starting || activeUpdate;

  const checkUpdates = useCallback(
    async (showError = false, allowPrompt = true) => {
      if (!isAdmin) return null;
      setChecking(true);
      try {
        const result = await localApi.updateInfo();
        setUpdate(result);
        if (allowPrompt && result.updateAvailable && !isUpdateBlocking(result)) {
          setPromptOpen(true);
        }
        return result;
      } catch (value) {
        if (showError)
          toast.error(value instanceof Error ? value.message : "Unable to check for updates");
        return null;
      } finally {
        setChecking(false);
      }
    },
    [isAdmin],
  );

  useEffect(() => {
    void checkUpdates(false, true);
  }, [checkUpdates]);

  useEffect(() => {
    if (!blocking) return;
    const timer = window.setInterval(
      () => void checkUpdates(false, false),
      UPDATE_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [blocking, checkUpdates]);

  useEffect(() => {
    if (!starting || activeUpdate || !update) return;

    if (update.state.status === "completed") {
      setStarting(false);
      setStartingSince(null);
      setPromptOpen(false);
      toast.success("Update completed.");
      return;
    }

    if (update.state.status === "failed") {
      setStarting(false);
      setStartingSince(null);
      toast.error(update.state.error || update.state.message || "Update failed.");
      return;
    }

    if (startingSince && Date.now() - startingSince > UPDATE_START_GRACE_MS) {
      setStarting(false);
      setStartingSince(null);
      toast.error(
        update.state.message && update.state.message !== "No update is running"
          ? update.state.message
          : "No update is running.",
      );
    }
  }, [activeUpdate, starting, startingSince, update]);

  const installUpdate = async () => {
    setStarting(true);
    setStartingSince(Date.now());
    setPromptOpen(false);
    try {
      await localApi.installUpdate();
      toast.success(
        "Update started. The interface is locked until the update finishes or rolls back.",
      );
      await checkUpdates(false, false);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to start the update");
      setStarting(false);
      setStartingSince(null);
    }
  };

  const progress = Math.min(
    100,
    Math.max(
      0,
      activeUpdate
        ? (update?.state.progress ?? 0)
        : starting
          ? update?.state.progress || 5
          : (update?.state.progress ?? 0),
    ),
  );
  const latestVersion = update?.latestVersion || "new stable version";

  return (
    <>
      <Dialog
        open={promptOpen && Boolean(update?.updateAvailable) && !blocking}
        onOpenChange={setPromptOpen}
      >
        <DialogContent className="overflow-hidden border-border bg-background p-0 shadow-xl sm:max-w-[520px]">
          <div className="border-b border-border bg-muted/30 px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3 pr-9">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                Stable update
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {update?.currentVersion} → {latestVersion}
              </span>
            </div>
            <DialogHeader>
              <DialogTitle className="text-base">New wFileManager release available</DialogTitle>
              <DialogDescription>
                An administrator should install verified stable releases to keep the instance secure
                and current.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Latest stable</span>
                <span className="font-mono font-medium">{latestVersion}</span>
              </div>
              {update?.publishedAt && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Published</span>
                  <span>{new Date(update.publishedAt).toLocaleString()}</span>
                </div>
              )}
              {update?.size != null && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Archive size</span>
                  <span>{Math.round(update.size / 1024)} KB</span>
                </div>
              )}
            </div>

            <Alert className="border-amber-500/40 bg-amber-500/5">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-sm">
                During installation, the interface will be locked. The updater downloads, verifies,
                builds, switches releases, performs a health check and rolls back automatically if
                the new release is unhealthy.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2 border-t border-border bg-muted/20 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => setPromptOpen(false)}>
              Later
            </Button>
            <Button
              type="button"
              onClick={() => void installUpdate()}
              disabled={starting || checking}
            >
              {checking || starting ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Install update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {blocking && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="wFileManager update in progress"
          className="fixed inset-0 z-[100] grid place-items-center bg-background/90 px-4 text-foreground backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
            <div className="border-b border-border bg-muted/30 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                wFileManager update in progress
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Do not use the file manager while the update is running. This prevents conflicting
                filesystem, session and terminal operations.
              </p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="capitalize text-muted-foreground">
                  {formatUpdatePhase(update, starting)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{progress}%</span>
              </div>
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">
                {formatUpdateMessage(update, starting)}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
