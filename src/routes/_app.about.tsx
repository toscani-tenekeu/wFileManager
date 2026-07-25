import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Info,
  Github,
  BookOpen,
  Bug,
  RefreshCw,
  Download,
  RotateCcw,
  ShieldAlert,
  Mail,
  CreditCard,
  Database,
} from "lucide-react";
import { SERVER_INFO } from "@/lib/demo/data";
import { localApi, type UpdateInfo } from "@/lib/local-api";
import { formatBytes, formatRelative } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { wfilemanagerApi, type ProPlanDetails } from "@/lib/wfilemanager-api";

export const Route = createFileRoute("/_app/about")({
  head: () => ({ meta: [{ title: "About & updates — wFileManager" }] }),
  component: About,
});

const ACTIVE_PHASES = new Set([
  "checking",
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
const SUPPORT_EMAIL = "support@kmerhosting.com";
const DATA_BACKEND = String(
  import.meta.env.VITE_WFILEMANAGER_DATABASE_MODE || "sqlite",
).toLowerCase();
const IS_PRO = DATA_BACKEND === "supabase";

const edition = IS_PRO
  ? {
      name: "Pro",
      badge: "Managed",
      backend: "KmerHosting Cloud",
      price: "$50/year",
      storage: "100 MB included",
      backup: "App data backup + recovery",
      excludes: "Server files and databases",
    }
  : {
      name: "Community",
      badge: "Local",
      backend: "SQLite on this server",
      price: "Free",
      storage: "/var/lib/wfilemanager/wfilemanager.db",
      backup: "You manage backups",
      excludes: "Server files and databases",
    };

function formatPlanDate(value?: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function planDaysRemaining(plan: ProPlanDetails | null) {
  if (!plan) return "Not available";
  if (typeof plan.daysRemaining === "number")
    return `${plan.daysRemaining} day${plan.daysRemaining === 1 ? "" : "s"}`;
  if (!plan.paidUntil) return "Not available";
  const days = Math.max(
    0,
    Math.ceil((new Date(plan.paidUntil).getTime() - Date.now()) / 86_400_000),
  );
  return `${days} day${days === 1 ? "" : "s"}`;
}

function About() {
  const { user } = useAuth();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [plan, setPlan] = useState<ProPlanDetails | null>(null);
  const [planLoaded, setPlanLoaded] = useState(false);
  const active = Boolean(update && ACTIVE_PHASES.has(update.state.status));

  const checkUpdates = async (notify = true) => {
    setChecking(true);
    try {
      const result = await localApi.updateInfo();
      setUpdate(result);
      if (notify)
        toast.success(
          result.updateAvailable
            ? `Version ${result.latestVersion} is available`
            : "Update check completed",
        );
    } catch (value) {
      if (notify)
        toast.error(value instanceof Error ? value.message : "Unable to check for updates");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void checkUpdates(false);
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void checkUpdates(false), 1800);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!IS_PRO || !user) return;
    let mounted = true;
    setPlanLoaded(false);
    void wfilemanagerApi
      .me()
      .then((result) => {
        if (mounted) setPlan(result.instance.plan || null);
      })
      .catch(() => {
        if (mounted) setPlan(null);
      })
      .finally(() => {
        if (mounted) setPlanLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const install = async () => {
    setStarting(true);
    try {
      await localApi.installUpdate();
      toast.success("Update started. The application may reconnect while the service restarts.");
      await checkUpdates(false);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to start the update");
    } finally {
      setStarting(false);
    }
  };

  const rollback = async () => {
    setStarting(true);
    try {
      await localApi.rollbackUpdate();
      toast.success("Rollback started.");
      await checkUpdates(false);
    } catch (value) {
      toast.error(value instanceof Error ? value.message : "Unable to start rollback");
    } finally {
      setStarting(false);
    }
  };

  const storagePercent = Math.min(100, Math.max(0, plan?.storagePercent ?? 0));
  const storageFull = Boolean(
    plan && plan.storageQuotaBytes > 0 && plan.storageUsedBytes >= plan.storageQuotaBytes,
  );

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Info className="h-5 w-5" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">About & updates</h1>
          <p className="text-sm text-muted-foreground">wFileManager — KmerHosting LLC</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application</CardTitle>
          <CardDescription>Web file manager for Linux servers.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="col-span-2 font-mono">
              {update?.currentVersion || SERVER_INFO.wfmVersion}
            </dd>
            <dt className="text-muted-foreground">Edition</dt>
            <dd className="col-span-2">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                {edition.name}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">License</dt>
            <dd className="col-span-2">MIT</dd>
            <dt className="text-muted-foreground">OS</dt>
            <dd className="col-span-2">Ubuntu 20.04+</dd>
            <dt className="text-muted-foreground">Publisher</dt>
            <dd className="col-span-2">KmerHosting LLC</dd>
            <dt className="text-muted-foreground">Support</dt>
            <dd className="col-span-2">
              <a
                className="font-medium text-primary hover:underline"
                href={`mailto:${SUPPORT_EMAIL}`}
              >
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Edition
            <Badge variant="outline">{edition.badge}</Badge>
          </CardTitle>
          <CardDescription>Plan and data storage.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm md:grid-cols-3">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="md:col-span-2 font-medium">{edition.name}</dd>
            <dt className="text-muted-foreground">Data</dt>
            <dd className="md:col-span-2">{edition.backend}</dd>
            <dt className="text-muted-foreground">Price</dt>
            <dd className="md:col-span-2">{edition.price}</dd>
            <dt className="text-muted-foreground">Storage</dt>
            <dd className="md:col-span-2 font-mono text-xs">{edition.storage}</dd>
            <dt className="text-muted-foreground">Backup</dt>
            <dd className="md:col-span-2">{edition.backup}</dd>
            <dt className="text-muted-foreground">Not included</dt>
            <dd className="md:col-span-2">{edition.excludes}</dd>
          </dl>
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Community and Pro have the same file-manager features. Only app-data hosting changes.
          </div>
        </CardContent>
      </Card>

      {IS_PRO && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-primary" />
              Pro plan
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                Managed
              </Badge>
            </CardTitle>
            <CardDescription>Billing and managed storage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!planLoaded && <p className="text-sm text-muted-foreground">Loading plan…</p>}
            {planLoaded && !plan && (
              <p className="text-sm text-muted-foreground">Plan details unavailable.</p>
            )}
            {plan && (
              <>
                {storageFull && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Managed storage is full. Access may be blocked. Contact
                      support@kmerhosting.com to increase your Pro quota.
                    </AlertDescription>
                  </Alert>
                )}
                <dl className="grid gap-3 text-sm md:grid-cols-3">
                  <dt className="text-muted-foreground">Subscription</dt>
                  <dd className="md:col-span-2 capitalize">
                    {plan.subscriptionStatus || "Not available"}
                  </dd>
                  <dt className="text-muted-foreground">Days left</dt>
                  <dd className="md:col-span-2 font-medium">{planDaysRemaining(plan)}</dd>
                  <dt className="text-muted-foreground">Next payment</dt>
                  <dd className="md:col-span-2">
                    {formatPlanDate(plan.nextPaymentAt || plan.paidUntil)}
                  </dd>
                  <dt className="text-muted-foreground">Order ref</dt>
                  <dd className="md:col-span-2 font-mono text-xs">
                    {plan.orderReference || "Not available"}
                  </dd>
                  <dt className="text-muted-foreground">Data status</dt>
                  <dd className="md:col-span-2 capitalize">{plan.dataStatus || "Not available"}</dd>
                </dl>

                <div className="rounded-md border border-border bg-muted/20 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <Database className="h-4 w-4 text-primary" />
                      Managed storage
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {storagePercent}%
                    </span>
                  </div>
                  <Progress value={storagePercent} />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatBytes(plan.storageUsedBytes || 0)} used</span>
                    <span>{formatBytes(plan.storageQuotaBytes || 0)} quota</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Updates</CardTitle>
              <CardDescription>
                Verified releases with automatic rollback after a failed health check.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void checkUpdates()}
              disabled={checking || active}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} /> Check
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-y-2 text-sm">
            <span className="text-muted-foreground">Installed</span>
            <span className="col-span-2 font-mono">
              {update?.currentVersion || SERVER_INFO.wfmVersion}
            </span>
            <span className="text-muted-foreground">Latest stable</span>
            <span className="col-span-2 font-mono">{update?.latestVersion || "Not checked"}</span>
            {update?.publishedAt && (
              <>
                <span className="text-muted-foreground">Published</span>
                <span className="col-span-2">{formatRelative(update.publishedAt)}</span>
              </>
            )}
            {update?.size != null && (
              <>
                <span className="text-muted-foreground">Download size</span>
                <span className="col-span-2">{formatBytes(update.size)}</span>
              </>
            )}
            {update?.checkedAt && (
              <>
                <span className="text-muted-foreground">Last check</span>
                <span className="col-span-2">{formatRelative(update.checkedAt)}</span>
              </>
            )}
          </div>

          {(active ||
            update?.state.status === "failed" ||
            update?.state.status === "completed") && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium capitalize">
                  {update?.state.status.replace(/-/g, " ")}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {update?.state.progress || 0}%
                </span>
              </div>
              <Progress value={update?.state.progress || 0} />
              <p className="mt-2 text-xs text-muted-foreground">
                {update?.state.error || update?.state.message}
              </p>
            </div>
          )}

          {update?.updateAvailable && !active && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>Version {update.latestVersion} is ready to install.</span>
                {user?.isAdmin ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={starting}>
                        <Download className="mr-2 h-4 w-4" /> Install update
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Install wFileManager {update.latestVersion}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          The package will be downloaded, verified, built and activated. The service
                          will restart briefly. If the health check fails, the updater automatically
                          restores the previous release.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void install()}>
                          Install update
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    An administrator must install this update.
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {user?.isAdmin && update?.rollbackAvailable && !active && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={starting}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Roll back
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Roll back to the previous release?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The current release will be replaced by the previous verified release and the
                    service will restart.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void rollback()}>
                    Start rollback
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Links</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          {[
            { icon: BookOpen, label: "Documentation", href: "/docs" },
            {
              icon: Github,
              label: "Source code",
              href: "https://github.com/toscani-tenekeu/wFileManager",
            },
            {
              icon: Bug,
              label: "Issue tracker",
              href: "https://github.com/toscani-tenekeu/wFileManager/issues",
            },
            { icon: Mail, label: "Support", href: `mailto:${SUPPORT_EMAIL}` },
          ].map((link) => {
            const Icon = link.icon;
            return (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {link.label}
              </a>
            );
          })}
        </CardContent>
      </Card>

      <Alert className="mt-4 border-amber-500/40 bg-amber-500/5">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <AlertDescription className="space-y-1 text-sm">
          <p className="font-medium text-foreground">Safety notice</p>
          <p>
            wFileManager can operate with elevated privileges. Verify paths and terminal commands
            before confirmation.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
