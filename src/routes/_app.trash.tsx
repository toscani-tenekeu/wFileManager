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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    return items.filter(
      (item) =>
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        item.originalPath.toLowerCase().includes(needle),
    );
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
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="contents">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Trash</h1>
            <p className="text-xs text-muted-foreground">
              {items.length} item(s) · {formatBytes(totalSize)} · items remain here until you
              restore or permanently delete them
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full min-w-0 sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search trash"
                className="pl-8"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void load()}
              disabled={loading || Boolean(busyId)}
              aria-label="Refresh trash"
              title="Refresh trash"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!items.length || Boolean(busyId)}
              onClick={() => setEmptyOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Empty trash
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="grid h-56 place-items-center text-sm text-muted-foreground">
            <div className="text-center">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
              Loading trash…
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-md border border-dashed border-border bg-muted/10 text-center">
            <div>
              <Trash2 className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
              <p className="font-medium">{items.length ? "No matching items" : "Trash is empty"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Deleted files and folders will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Original path</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Deleted</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => {
                  const Icon = item.kind === "directory" ? Folder : FileIcon;
                  const busy = busyId === item.id;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex min-w-48 items-center gap-2">
                          <div
                            className={cn(
                              "grid h-8 w-8 shrink-0 place-items-center rounded-md border",
                              item.kind === "directory"
                                ? "border-primary/20 bg-primary/10"
                                : "border-border bg-muted/40",
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-4 w-4",
                                item.kind === "directory"
                                  ? "fill-primary/15 text-primary"
                                  : "text-muted-foreground",
                              )}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium" title={item.name}>
                              {item.name}
                            </div>
                            <Badge variant="outline" className="mt-1 font-normal">
                              {item.kind === "directory" ? "Folder" : "File"}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        className="max-w-[24rem] truncate font-mono text-xs text-muted-foreground"
                        title={item.originalPath}
                      >
                        {item.originalPath}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatBytes(item.size)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatRelative(item.deletedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={busy || Boolean(busyId && !busy)}
                            onClick={() => void restore(item)}
                            aria-label={`Restore ${item.name}`}
                            title={`Restore ${item.name}`}
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={Boolean(busyId)}
                            onClick={() => setDeleteItem(item)}
                            aria-label={`Permanently delete ${item.name}`}
                            title={`Permanently delete ${item.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog open={Boolean(deleteItem)} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{deleteItem?.name}</span> will be removed permanently.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteItem || Boolean(busyId)}
              onClick={() => deleteItem && void permanentlyDelete(deleteItem)}
            >
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
              {items.length} item(s), totaling {formatBytes(totalSize)}, will be permanently
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(busyId)}
              onClick={() => void emptyTrash()}
            >
              Permanently delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
