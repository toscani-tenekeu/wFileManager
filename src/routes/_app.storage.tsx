import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HardDrive, AlertTriangle, CircleCheck, RefreshCw, Database, FolderOpen } from "lucide-react";
import { formatBytes, formatRelative } from "@/lib/format";
import { localApi, type StorageMount } from "@/lib/local-api";

export const Route = createFileRoute("/_app/storage")({
  head: () => ({ meta: [{ title: "Storage — wFileManager" }] }),
  component: Storage,
});

function Storage() {
  const [mounts, setMounts] = useState<StorageMount[]>([]);
  const [primary, setPrimary] = useState<StorageMount | null>(null);
  const [volumeCount, setVolumeCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await localApi.storage();
      setMounts(result.mounts);
      setPrimary(result.primary);
      setVolumeCount(result.volumeCount);
      setGeneratedAt(result.generatedAt);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to read storage information");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5" />
          <div><h1 className="text-xl font-semibold tracking-tight">Storage</h1><p className="text-sm text-muted-foreground">Unique storage volumes, capacity, inodes and access state.</p></div>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Storage volumes</div><div className="mt-0.5 text-xl font-semibold">{volumeCount}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Primary capacity</div><div className="mt-0.5 text-xl font-semibold">{primary ? formatBytes(primary.total) : "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-[11px] text-muted-foreground">Available storage</div><div className="mt-0.5 text-xl font-semibold">{primary ? formatBytes(primary.available) : "—"}</div></CardContent></Card>
      </div>

      {generatedAt && <div className="mb-2 text-right text-[11px] text-muted-foreground">Updated {formatRelative(generatedAt)}</div>}

      <div className="grid gap-3">
        {loading && mounts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Reading storage volumes…</CardContent></Card>
        ) : mounts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No usable storage volume was detected.</CardContent></Card>
        ) : mounts.map((mount) => {
          const warning = mount.health !== "healthy";
          return (
            <Card key={`${mount.device}:${mount.mountpoint}`}>
              <CardHeader className="px-4 pb-2 pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 font-mono text-sm"><Database className="h-3.5 w-3.5 text-primary" /> {mount.mountpoint}</CardTitle>
                    <CardDescription className="mt-1 break-all text-xs">{mount.device} · {mount.fstype} · {mount.options}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {mount.readonly && <Badge variant="outline" className="h-5 text-[10px]">read-only</Badge>}
                    <Badge variant="outline" className={`h-5 text-[10px] ${mount.health === "healthy" ? "border-primary/40 bg-primary/10 text-primary" : mount.health === "critical" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning"}`}>
                      {mount.health === "healthy" ? <><CircleCheck className="mr-1 h-3 w-3" /> Healthy</> : <><AlertTriangle className="mr-1 h-3 w-3" /> {mount.health}</>}
                    </Badge>
                    <Button asChild size="sm" variant="outline" className="h-7"><Link to="/explorer" search={{ path: mount.mountpoint }}><FolderOpen className="mr-1.5 h-3.5 w-3.5" /> Open</Link></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-4 text-[11px]"><span className="text-muted-foreground">Disk usage</span><span className="font-mono">{formatBytes(mount.used)} / {formatBytes(mount.total)} · {mount.percent}%</span></div>
                  <Progress value={mount.percent} className="h-1.5" />
                  <div className="mt-1 text-right text-[10px] text-muted-foreground">{formatBytes(mount.available)} available</div>
                </div>
                {mount.inodesTotal > 0 && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-4 text-[11px]"><span className="text-muted-foreground">Inodes</span><span className="font-mono">{mount.inodesUsed.toLocaleString()} / {mount.inodesTotal.toLocaleString()} · {mount.inodePercent}%</span></div>
                    <Progress value={mount.inodePercent} className="h-1.5" />
                    <div className="mt-1 text-right text-[10px] text-muted-foreground">{mount.inodesAvailable.toLocaleString()} available</div>
                  </div>
                )}
                {warning && (
                  <div className={mount.health === "critical" ? "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px]" : "flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px]"}>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{mount.readonly ? "This filesystem is mounted read-only. File modifications are unavailable." : "Storage or inode usage is high. Free space before file operations begin failing."}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
