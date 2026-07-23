import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CircleCheck,
  FolderTree,
  HardDrive,
  MemoryStick,
  RefreshCw,
  TerminalSquare,
  Trash2,
  Users,
} from "lucide-react";
import { localApi } from "@/lib/local-api";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Overview — wFileManager" }] }),
  component: Overview,
});

type SystemInfo = Awaited<ReturnType<typeof localApi.system>>;
type OverviewDisk = NonNullable<SystemInfo["disk"]> & {
  capacityReliable?: boolean;
  measurement?: "configured" | "quota" | "filesystem" | "server-usage";
};

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="min-h-0">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-3 pb-1 pt-3">
        <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function Overview() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [trash, setTrash] = useState({ items: 0, size: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [systemResult, trashResult] = await Promise.all([
        localApi.system(),
        localApi.trash.list().catch(() => ({ items: [], totalSize: 0 })),
      ]);
      setSystem(systemResult);
      setTrash({ items: trashResult.items.length, size: trashResult.totalSize });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect to the local wFileManager engine");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const disk = system?.disk as OverviewDisk | null | undefined;
  const hasDiskCapacity = Boolean(disk && disk.total > 0 && disk.capacityReliable !== false);
  const diskPercent = hasDiskCapacity ? disk?.percent || 0 : 0;
  const memoryUsed = system ? system.memory.total - system.memory.free : 0;
  const memoryPercent = system?.memory.total ? Math.round((memoryUsed / system.memory.total) * 100) : 0;

  const storageValue = disk ? `${formatBytes(disk.used)} used` : "—";
  const storageDescription = disk
    ? hasDiskCapacity
      ? `${formatBytes(disk.available)} free`
      : "Free space is not reported"
    : "Storage information unavailable";

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Storage and filesystem access for this wFileManager installation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={error ? "border-destructive/40 text-destructive" : "border-primary/40 bg-primary/10 text-primary"}>
            <span className={error ? "mr-1.5 h-1.5 w-1.5 rounded-full bg-destructive" : "mr-1.5 h-1.5 w-1.5 rounded-full bg-primary"} />
            {loading ? "Connecting" : error ? "Local engine unavailable" : "Local engine connected"}
          </Badge>
          <Button size="icon" variant="outline" onClick={() => void load()}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
        </div>
      </div>

      {error && <Card className="mb-4 border-destructive/40"><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
        <Stat label="Storage state" value={storageValue} sub={storageDescription} icon={HardDrive} />
        <Stat label="Memory used" value={system ? `${memoryPercent}%` : "—"} sub={system ? `${formatBytes(memoryUsed)} of ${formatBytes(system.memory.total)}` : "Memory information unavailable"} icon={MemoryStick} />
        <Stat label="Server users" value={system ? system.loginUsers.toLocaleString() : "—"} sub={system ? "Linux accounts with login access" : "User information unavailable"} icon={Users} />
        <Stat label="Trash" value={loading ? "—" : String(trash.items)} sub={trash.items ? `${formatBytes(trash.size)} waiting for restore or deletion` : "Trash is empty"} icon={Trash2} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Storage and filesystem access</CardTitle><CardDescription>Information useful while managing files on this installation.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Hostname</p><p className="mt-1 font-mono">{system?.hostname || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">OS release</p><p className="mt-1 font-mono">{system?.os.prettyName || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Kernel / architecture</p><p className="mt-1 font-mono">{system ? `${system.release} · ${system.architecture}` : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Service port</p><p className="mt-1 font-mono">127.0.0.1:1973</p></div>
            </div>
            <div>
              <div className="mb-1.5 flex justify-between gap-4 text-xs">
                <span className="text-muted-foreground">Storage usage</span>
                <span className="text-right font-mono">
                  {disk ? `${formatBytes(disk.used)} used · ${hasDiskCapacity ? `${formatBytes(disk.available)} free` : "free —"}` : "—"}
                </span>
              </div>
              <Progress value={diskPercent} className="h-2" />
              {disk && hasDiskCapacity && <div className="mt-1 text-right text-[10px] text-muted-foreground">{formatBytes(disk.total)} total</div>}
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">Memory usage</span><span className="font-mono">{system ? `${formatBytes(system.memory.free)} free` : "—"}</span></div>
              <Progress value={memoryPercent} className="h-2" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CircleCheck className="h-4 w-4 text-primary" />Filesystem and command endpoints require a valid wFileManager administrator session.</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Quick access</CardTitle><CardDescription>Open real server locations and tools.</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {["/", "/root", "/etc", "/var/www", "/opt"].map((path) => (
              <Button key={path} asChild variant="outline" className="justify-start"><Link to="/explorer" search={{ path }}><FolderTree className="mr-2 h-4 w-4" />Open <span className="ml-1 font-mono">{path}</span></Link></Button>
            ))}
            <Button asChild className="justify-start"><Link to="/terminal"><TerminalSquare className="mr-2 h-4 w-4" />Open terminal</Link></Button>
            <Button asChild variant="outline" className="justify-start"><Link to="/users"><Users className="mr-2 h-4 w-4" />Manage users</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
