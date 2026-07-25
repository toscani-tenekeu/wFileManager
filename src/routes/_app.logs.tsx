import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";
import { wfilemanagerApi, type AuditLog } from "@/lib/wfilemanager-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/_app/logs")({
  head: () => ({ meta: [{ title: "Audit logs — wFileManager" }] }),
  component: AuditLogs,
});

function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setLogs((await wfilemanagerApi.auditLogs()).logs);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((log) => JSON.stringify(log).toLowerCase().includes(needle));
  }, [logs, query]);

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <h1 className="text-xl font-semibold tracking-tight">Audit logs</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent authentication, account and administration events for this installation.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Security events</CardTitle>
              <CardDescription>
                {filtered.length} of {logs.length} events displayed
              </CardDescription>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search action, user, IP or target…"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>IP address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Loading audit logs…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No matching audit event.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString("en-US")}
                      </TableCell>
                      <TableCell>{log.username || "System"}</TableCell>
                      <TableCell className="font-mono text-xs">{log.action}</TableCell>
                      <TableCell
                        className="max-w-72 truncate text-xs text-muted-foreground"
                        title={log.target || ""}
                      >
                        {log.target || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.result === "success" ? "secondary" : "destructive"}>
                          {log.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.ip_address || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
