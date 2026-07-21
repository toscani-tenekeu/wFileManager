import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  File as FileIcon,
  Folder,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatBytes, formatRelative } from "@/lib/format";
import { localApi, type TrashItem } from "@/lib/local-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/trash")({
  head: () => ({ meta: [{ title: "Trash — wFileManager" }] }),
  component: Trash,
});

function Trash() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] = useState<TrashItem | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await localApi.trash.list();
      setItems(result.items);
      setTotalSize(result.totalSize);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to load trash");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.originalPath.toLowerCase().includes(needle));
  }, [items, q]);

  const restore = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      await localApi.trash.restore(item.id);
      toast.success(`${item.name} restored to ${item.originalPath}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const permanentlyDelete = async (item: TrashItem) => {
    setBusyId(item.id);
    try {
      await localApi.trash.delete(item.id);
      toast.success(`${item.name} permanently deleted`);
      setDeleteItem(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Permanent deletion failed");
    } finally {
      setBusyId(null);
    }
  };

  const emptyTrash = async () => {
    setBusyId("__all__");
    try {
      const result = await localApi.trash.empty();
      toast.success(`${result.deletedItems} item(s) permanently deleted`);
      setEmptyOpen(false);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to empty trash");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-surface/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Trash</h1>
            <p className="text-xs text-muted-foreground">
              {items.length} item(s) · {formatBytes(totalSize)} · items remain here until you restore or permanently delete them
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search trash" className="pl-8" />
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || Boolean(busyId)}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />Refresh
            </Button>
            <Button variant="destructive" size="sm" disabled={!items.length || Boolean(busyId)} onClick={() => setEmptyOpen(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" />Empty trash
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="grid h-56 place-items-center text-sm text-muted-foreground">
            <div className="text-center"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />Loading trash…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/10 text-center">
            <div>
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl border border-border bg-surface shadow-sm">
                <Trash2 className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="font-medium">{items.length ? "No matching items" : "Trash is empty"}</p>
              <p className="mt-1 text-sm text-muted-foreground">Deleted files and folders will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            {filtered.map((item) => {
              const Icon = item.kind === "directory" ? Folder : FileIcon;
              const busy = busyId === item.id;
              return (
                <article key={item.id} className="group relative flex min-h-56 flex-col overflow-hidden rounded-xl border border-border bg-card p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-muted/25 hover:shadow-lg hover:shadow-black/10">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <Badge variant="outline" className="font-normal">{item.kind === "directory" ? "Folder" : "File"}</Badge>
                    <span className="text-[11px] text-muted-foreground">{formatRelative(item.deletedAt)}</span>
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <div className={cn(
                      "mb-3 grid h-20 w-20 place-items-center rounded-2xl border shadow-inner",
                      item.kind === "directory" ? "border-primary/20 bg-primary/10" : "border-border bg-muted/40",
                    )}>
                      <Icon className={cn("h-12 w-12", item.kind === "directory" ? "fill-primary/15 text-primary" : "text-muted-foreground")} />
                    </div>
                    <h2 className="w-full truncate text-sm font-semibold" title={item.name}>{item.name}</h2>
                    <p className="mt-1 line-clamp-2 break-all font-mono text-[11px] text-muted-foreground" title={item.originalPath}>{item.originalPath}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3">
                    <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-8" disabled={busy || Boolean(busyId && !busy)} onClick={() => void restore(item)}>
                        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}Restore
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={Boolean(busyId)} onClick={() => setDeleteItem(item)} aria-label={`Permanently delete ${item.name}`}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={Boolean(deleteItem)} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{deleteItem?.name}</span> will be removed permanently. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={!deleteItem || Boolean(busyId)} onClick={() => deleteItem && void permanentlyDelete(deleteItem)}>
              Permanently delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyOpen} onOpenChange={setEmptyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the entire trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {items.length} item(s), totaling {formatBytes(totalSize)}, will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={Boolean(busyId)} onClick={() => void emptyTrash()}>
              Permanently delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
