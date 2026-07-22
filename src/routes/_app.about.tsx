import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Info, Github, BookOpen, Bug, RefreshCw, Download, RotateCcw, ShieldAlert } from "lucide-react";
import { SERVER_INFO } from "@/lib/demo/data";
import { localApi, type UpdateInfo } from "@/lib/local-api";
import { formatBytes, formatRelative } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/about")({
  head: () => ({ meta: [{ title: "About & updates — wFileManager" }] }),
  component: About,
});

const ACTIVE_PHASES = new Set(["checking", "downloading", "verifying", "extracting", "installing", "building", "switching", "restarting", "health-check", "rolling-back"]);

function About() {
  const { user } = useAuth();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const active = Boolean(update && ACTIVE_PHASES.has(update.state.status));

  const checkUpdates = async (notify = true) => {
    setChecking(true);
    try {
      const result = await localApi.updateInfo();
      setUpdate(result);
      if (notify) toast.success(result.updateAvailable ? `Version ${result.latestVersion} is available` : "Update check completed");
    } catch (value) {
      if (notify) toast.error(value instanceof Error ? value.message : "Unable to check for updates");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { void checkUpdates(false); }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void checkUpdates(false), 1800);
    return () => window.clearInterval(timer);
  }, [active]);

  const install = async () => {
    setStarting(true);
    try {
      await localApi.installUpdate();
      toast.success("Update started. The application may reconnect while the service restarts.");
      await checkUpdates(false);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to start the update");
    } finally { setStarting(false); }
  };

  const rollback = async () => {
    setStarting(true);
    try {
      await localApi.rollbackUpdate();
      toast.success("Rollback started.");
      await checkUpdates(false);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to start rollback");
    } finally { setStarting(false); }
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Info className="h-5 w-5" />
        <div><h1 className="text-xl font-semibold tracking-tight">About & updates</h1><p className="text-sm text-muted-foreground">wFileManager — A project from KmerHosting LLC</p></div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Application</CardTitle><CardDescription>A modern web-based file manager for Linux servers.</CardDescription></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt><dd className="col-span-2 font-mono">{update?.currentVersion || SERVER_INFO.wfmVersion}</dd>
            <dt className="text-muted-foreground">License</dt><dd className="col-span-2">MIT</dd>
            <dt className="text-muted-foreground">Supported OS</dt><dd className="col-span-2">Ubuntu 20.04 LTS and newer</dd>
            <dt className="text-muted-foreground">Recommended</dt><dd className="col-span-2"><Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">Ubuntu 24.04 LTS</Badge></dd>
            <dt className="text-muted-foreground">Publisher</dt><dd className="col-span-2">KmerHosting LLC</dd>
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div><CardTitle className="text-base">Updates</CardTitle><CardDescription>Verified releases with automatic rollback after a failed health check.</CardDescription></div>
            <Button size="sm" variant="outline" onClick={() => void checkUpdates()} disabled={checking || active}><RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Check</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-y-2 text-sm">
            <span className="text-muted-foreground">Installed</span><span className="col-span-2 font-mono">{update?.currentVersion || SERVER_INFO.wfmVersion}</span>
            <span className="text-muted-foreground">Latest stable</span><span className="col-span-2 font-mono">{update?.latestVersion || "Not checked"}</span>
            {update?.publishedAt && <><span className="text-muted-foreground">Published</span><span className="col-span-2">{formatRelative(update.publishedAt)}</span></>}
            {update?.size != null && <><span className="text-muted-foreground">Download size</span><span className="col-span-2">{formatBytes(update.size)}</span></>}
            {update?.checkedAt && <><span className="text-muted-foreground">Last check</span><span className="col-span-2">{formatRelative(update.checkedAt)}</span></>}
          </div>

          {(active || update?.state.status === "failed" || update?.state.status === "completed") && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-medium capitalize">{update?.state.status.replace(/-/g, " ")}</span><span className="font-mono text-xs text-muted-foreground">{update?.state.progress || 0}%</span></div>
              <Progress value={update?.state.progress || 0} />
              <p className="mt-2 text-xs text-muted-foreground">{update?.state.error || update?.state.message}</p>
            </div>
          )}

          {update?.updateAvailable && !active && (
            <Alert><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Version {update.latestVersion} is ready to install.</span>{user?.isAdmin ? (
              <AlertDialog><AlertDialogTrigger asChild><Button size="sm" disabled={starting}><Download className="mr-2 h-4 w-4" /> Install update</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Install wFileManager {update.latestVersion}?</AlertDialogTitle><AlertDialogDescription>The package will be downloaded, verified, built and activated. The service will restart briefly. If the health check fails, the updater automatically restores the previous release.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void install()}>Install update</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            ) : <span className="text-xs text-muted-foreground">An administrator must install this update.</span>}</AlertDescription></Alert>
          )}

          {user?.isAdmin && update?.rollbackAvailable && !active && (
            <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={starting}><RotateCcw className="mr-2 h-4 w-4" /> Roll back</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Roll back to the previous release?</AlertDialogTitle><AlertDialogDescription>The current release will be replaced by the previous verified release and the service will restart.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void rollback()}>Start rollback</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Links</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          {[
            { icon: BookOpen, label: "Documentation", href: "/docs" },
            { icon: Github, label: "Source code", href: "https://github.com/toscani-tenekeu/wFileManager" },
            { icon: Bug, label: "Issue tracker", href: "https://github.com/toscani-tenekeu/wFileManager/issues" },
          ].map((link) => { const Icon = link.icon; return <a key={link.label} href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><Icon className="h-4 w-4 text-muted-foreground" />{link.label}</a>; })}
        </CardContent>
      </Card>

      <Alert className="mt-4 border-amber-500/40 bg-amber-500/5"><ShieldAlert className="h-4 w-4 text-amber-500" /><AlertDescription className="space-y-1 text-sm"><p className="font-medium text-foreground">Safety notice</p><p>wFileManager can operate with elevated privileges. Verify every path, permission and terminal command before confirmation. Incorrect operations can cause permanent data loss, service interruption or full system compromise.</p></AlertDescription></Alert>
    </div>
  );
}
