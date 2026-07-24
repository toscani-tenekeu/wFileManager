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
import { Download, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const UPDATE_CHECK_INTERVAL_MS = 1_800;
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
  if (starting) return "Starting update";
  if (!update) return "Preparing update";
  return update.state.status.replace(/-/g, " ");
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
    return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Loading wFileManager…</div>;
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
  const [promptOpen, setPromptOpen] = useState(false);
  const blocking = starting || isUpdateBlocking(update);

  const checkUpdates = useCallback(async (showError = false) => {
    if (!isAdmin) return;
    setChecking(true);
    try {
      const result = await localApi.updateInfo();
      setUpdate(result);
      if (result.updateAvailable && !isUpdateBlocking(result)) {
        setPromptOpen(true);
      }
    } catch (value) {
      if (showError) toast.error(value instanceof Error ? value.message : "Unable to check for updates");
    } finally {
      setChecking(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void checkUpdates(false);
  }, [checkUpdates]);

  useEffect(() => {
    if (!blocking) return;
    const timer = window.setInterval(() => void checkUpdates(false), UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [blocking, checkUpdates]);

  const installUpdate = async () => {
    setStarting(true);
    setPromptOpen(false);
    try {
      await localApi.installUpdate();
      toast.success("Update started. The interface is locked until the update finishes or rolls back.");
      await checkUpdates(false);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to start the update");
      setStarting(false);
    }
  };

  const progress = Math.min(100, Math.max(0, update?.state.progress ?? (starting ? 5 : 0)));
  const latestVersion = update?.latestVersion || "new stable version";

  return (
    <>
      <Dialog open={promptOpen && Boolean(update?.updateAvailable) && !blocking} onOpenChange={setPromptOpen}>
        <DialogContent className="overflow-hidden border-border bg-background p-0 shadow-xl sm:max-w-[520px]">
          <div className="border-b border-border bg-muted/30 px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                Stable update
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{update?.currentVersion} → {latestVersion}</span>
            </div>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                New wFileManager release available
              </DialogTitle>
              <DialogDescription>
                An administrator should review and install verified stable releases to keep the instance secure and current.
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
                During installation, the interface will be locked. The updater downloads, verifies, builds, switches releases, performs a health check and rolls back automatically if the new release is unhealthy.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2 border-t border-border bg-muted/20 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => setPromptOpen(false)}>
              Later
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.assign("/about")}>
              Review details
            </Button>
            <Button type="button" onClick={() => void installUpdate()} disabled={starting || checking}>
              {checking || starting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
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
              <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
                Interface locked
              </Badge>
              <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                wFileManager update in progress
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Do not use the file manager while the update is running. This prevents conflicting filesystem, session and terminal operations.
              </p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="capitalize text-muted-foreground">{formatUpdatePhase(update, starting)}</span>
                <span className="font-mono text-xs text-muted-foreground">{progress}%</span>
              </div>
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground">
                {update?.state.message || "The updater is preparing the verified release package."}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
