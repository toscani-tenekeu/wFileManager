import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HardDrive, AlertTriangle, CircleCheck, RefreshCw, Database, FolderOpen, Files, FolderTree, Users, Link2 } from "lucide-react";
import { formatBytes, formatRelative } from "@/lib/format";
import { localApi, type StorageMount } from "@/lib/local-api";
import { storageAnalysisApi, type StorageAnalysis } from "@/lib/storage-analysis-api";

export const Route = createFileRoute("/_app/storage")({
  head: () => ({ meta: [{ title: "Storage — wFileManager" }] }),
  component: Storage,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type ScopedStorageMount = StorageMount & {
  scope?: "server" | "filesystem";
  capacitySource?: "configured" | "quota" | "filesystem" | "server-usage";
  capacityReliable?: boolean;
  inodesReliable?: boolean;
};

function Storage() {
  const [mounts, setMounts] = useState<StorageMount[]>([]);
  const [primary, setPrimary] = useState<StorageMount | null>(null);
  const [volumeCount, setVolumeCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<StorageAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (refreshAnalysis = false) => {
    setLoading(true);
    setError(null);
    setAnalysisError(null);
    try {
      const [result, analysisResult] = await Promise.all([
        localApi.storage(),
        storageAnalysisApi.get(refreshAnalysis).catch((value) => {
          setAnalysisError(value instanceof Error ? value.message : "Unable to analyze filesystem contents");
          return null;
        }),
      ]);
      setMounts(result.mounts);
      setPrimary(result.primary);
      setVolumeCount(result.volumeCount);
      setGeneratedAt(result.generatedAt);
      setAnalysis(analysisResult);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to read storage information");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const chartData = useMemo(() => analysis?.categories.filter((item) => item.count > 0) || [], [analysis]);
  const totalHomeBytes = useMemo(() => analysis?.homeUsage.reduce((sum, item) => sum + item.bytes, 0) || 0, [analysis]);

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5" />
          <div><h1 className="text-xl font-semibold tracking-tight">Storage</h1><p className="text-sm text-muted-foreground">Server capacity, inode usage, filesystem item distribution and real Linux home-directory usage.</p></div>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load(true)} disabled={loading}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>

      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {analysisError && <Alert className="mb-4 border-warning/40 bg-warning/5"><AlertTriangle className="h-4 w-4 text-warning" /><AlertDescription>{analysisError}</AlertDescription></Alert>}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-3"><div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Storage volumes</span><Database className="h-3.5 w-3.5" /></div><div className="mt-0.5 text-xl font-semibold">{volumeCount.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Files</span><Files className="h-3.5 w-3.5" /></div><div className="mt-0.5 text-xl font-semibold">{analysis ? analysis.totalFiles.toLocaleString() : "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Folders</span><FolderTree className="h-3.5 w-3.5" /></div><div className="mt-0.5 text-xl font-semibold">{analysis ? analysis.totalDirectories.toLocaleString() : "—"}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Available storage</span><HardDrive className="h-3.5 w-3.5" /></div><div className="mt-0.5 text-xl font-semibold">{primary && primary.total > 0 ? formatBytes(primary.available) : "—"}</div></CardContent></Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Item distribution by type</CardTitle>
            <CardDescription>Recursive scan of the root filesystem. Other mounted filesystems are not crossed.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading && !analysis ? (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">Analyzing filesystem items…</div>
            ) : chartData.length === 0 ? (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">No file distribution is available.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="h-[250px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chartData} dataKey="count" nameKey="category" innerRadius={58} outerRadius={92} paddingAngle={2}>
                        {chartData.map((item, index) => <Cell key={item.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 self-center">
                  {chartData.map((item, index) => (
                    <div key={item.category} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span className="truncate text-muted-foreground">{item.category}</span></div>
                      <span className="font-mono">{item.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {analysis && <div className="mt-3 grid gap-2 border-t border-border pt-3 text-xs sm:grid-cols-3"><div><span className="text-muted-foreground">Regular files</span><div className="mt-0.5 font-mono">{analysis.totalFiles.toLocaleString()}</div></div><div><span className="text-muted-foreground">Symbolic links</span><div className="mt-0.5 flex items-center gap-1 font-mono"><Link2 className="h-3 w-3" />{analysis.totalSymlinks.toLocaleString()}</div></div><div><span className="text-muted-foreground">Logical file size</span><div className="mt-0.5 font-mono">{formatBytes(analysis.totalFileBytes)}</div></div></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linux home-directory usage</CardTitle>
            <CardDescription>Disk blocks occupied by real users whose home directory is under <span className="font-mono">/home</span>.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading && !analysis ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Reading Linux user homes…</div>
            ) : !analysis?.homeUsage.length ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No real Linux user home directory was detected under /home.</div>
            ) : (
              <div className="space-y-4">
                {analysis.homeUsage.map((home) => {
                  const percent = totalHomeBytes ? Math.round((home.bytes / totalHomeBytes) * 100) : 0;
                  return (
                    <div key={`${home.uid}:${home.path}`}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0"><div className="flex items-center gap-1.5 font-medium"><Users className="h-3.5 w-3.5 text-primary" />{home.username}</div><div className="truncate font-mono text-[10px] text-muted-foreground">{home.path} · UID {home.uid}</div></div>
                        <span className="shrink-0 font-mono">{formatBytes(home.bytes)}</span>
                      </div>
                      <Progress value={percent} className="h-1.5" />
                    </div>
                  );
                })}
                <div className="flex items-center justify-between border-t border-border pt-3 text-xs"><span className="text-muted-foreground">Combined /home usage</span><span className="font-mono">{formatBytes(totalHomeBytes)}</span></div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">All detected file types</CardTitle>
          <CardDescription>Every file extension found on the root filesystem, with its file count and logical size.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !analysis ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Building file-type inventory…</div>
          ) : !analysis?.fileTypes.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No regular file type was detected.</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
              <div className="sticky top-0 grid grid-cols-[minmax(0,1fr)_120px_140px] gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>File type</span><span className="text-right">Files</span><span className="text-right">Size</span>
              </div>
              {analysis.fileTypes.map((item) => (
                <div key={item.type} className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-3 border-b border-border/70 px-3 py-2 text-xs last:border-b-0">
                  <span className="truncate font-mono">{item.type}</span>
                  <span className="text-right font-mono">{item.count.toLocaleString()}</span>
                  <span className="text-right font-mono text-muted-foreground">{formatBytes(item.bytes)}</span>
                </div>
              ))}
            </div>
          )}
          {analysis?.generatedAt && <div className="mt-2 text-right text-[10px] text-muted-foreground">Filesystem analysis updated {formatRelative(analysis.generatedAt)} · cached for five minutes</div>}
        </CardContent>
      </Card>

      {generatedAt && <div className="mb-2 text-right text-[11px] text-muted-foreground">Storage information updated {formatRelative(generatedAt)}</div>}

      <div className="grid gap-3">
        {loading && mounts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Reading storage volumes…</CardContent></Card>
        ) : mounts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No usable storage volume was detected.</CardContent></Card>
        ) : mounts.map((mount) => {
          const scopedMount = mount as ScopedStorageMount;
          const warning = mount.health !== "healthy";
          const serverRoot = scopedMount.scope === "server";
          return (
            <Card key={`${mount.device}:${mount.mountpoint}`}>
              <CardHeader className="px-4 pb-2 pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 font-mono text-sm"><Database className="h-3.5 w-3.5 text-primary" /> {mount.mountpoint}</CardTitle>
                    <CardDescription className="mt-1 break-all text-xs">{serverRoot ? `Server root storage · ${mount.fstype}` : `${mount.device} · ${mount.fstype} · ${mount.options}`}</CardDescription>
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
                  <div className="mb-1 flex items-center justify-between gap-4 text-[11px]"><span className="text-muted-foreground">Storage usage</span><span className="font-mono">{formatBytes(mount.used)} / {mount.total > 0 ? formatBytes(mount.total) : "—"}{mount.total > 0 ? ` · ${mount.percent}%` : ""}</span></div>
                  <Progress value={mount.total > 0 ? mount.percent : 0} className="h-1.5" />
                  <div className="mt-1 text-right text-[10px] text-muted-foreground">{mount.total > 0 ? `${formatBytes(mount.available)} free` : `${formatBytes(mount.used)} used`}</div>
                </div>
                {mount.inodesTotal > 0 ? (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-4 text-[11px]"><span className="text-muted-foreground">Inodes</span><span className="font-mono">{mount.inodesUsed.toLocaleString()} / {mount.inodesTotal.toLocaleString()} · {mount.inodePercent}%</span></div>
                    <Progress value={mount.inodePercent} className="h-1.5" />
                    <div className="mt-1 text-right text-[10px] text-muted-foreground">{mount.inodesAvailable.toLocaleString()} free</div>
                  </div>
                ) : mount.inodesUsed > 0 ? (
                  <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-2 text-[11px]">
                    <span className="text-muted-foreground">Inodes used</span>
                    <span className="font-mono">{mount.inodesUsed.toLocaleString()}</span>
                  </div>
                ) : null}
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
