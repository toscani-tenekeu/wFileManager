import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Download,
  CircleX,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FilePlus2,
  Folder,
  FolderInput,
  FolderPlus,
  HardDriveUpload,
  Home,
  Info,
  Grid2X2,
  Link2,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { localApi, type LocalFileEntry, type OperationJob, type ProgressState } from "@/lib/local-api";
import { archiveApi, type ArchiveFormat, type ArchiveInspection } from "@/lib/archive-api";
import { formatBytes, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  path: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/_app/explorer")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "File Explorer — wFileManager" }] }),
  component: Explorer,
});

type CreateKind = "file" | "directory";
type TransferKind = "copy" | "move";
type LayoutMode = "list" | "grid";

type ExtractPlan = {
  entry: LocalFileEntry;
  inspection: ArchiveInspection;
};

function normalizePath(value: string) {
  const parts = value.split("/").filter(Boolean);
  const safe: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") safe.pop();
    else safe.push(part);
  }
  return `/${safe.join("/")}` || "/";
}

function parentPath(value: string) {
  const parts = normalizePath(value).split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}` || "/";
}

function isArchiveEntry(entry: LocalFileEntry) {
  if (entry.kind !== "file") return false;
  const name = entry.name.toLowerCase();
  return name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz");
}

function entryVisual(entry: LocalFileEntry) {
  if (entry.kind === "directory") {
    return { Icon: Folder, tone: "border-primary/20 bg-primary/10 text-primary", icon: "fill-primary/15 text-primary" };
  }
  if (entry.kind === "symlink") {
    return { Icon: Link2, tone: "border-sky-500/20 bg-sky-500/10 text-sky-400", icon: "text-sky-400" };
  }
  const extension = entry.name.split(".").pop()?.toLowerCase() || "";
  if (entry.mime.startsWith("image/")) return { Icon: FileImage, tone: "border-fuchsia-500/20 bg-fuchsia-500/10", icon: "text-fuchsia-400" };
  if (entry.mime.startsWith("audio/")) return { Icon: FileAudio, tone: "border-pink-500/20 bg-pink-500/10", icon: "text-pink-400" };
  if (entry.mime.startsWith("video/")) return { Icon: FileVideo, tone: "border-violet-500/20 bg-violet-500/10", icon: "text-violet-400" };
  if (["zip", "gz", "bz2", "xz", "7z", "rar", "tar"].includes(extension)) return { Icon: FileArchive, tone: "border-amber-500/20 bg-amber-500/10", icon: "text-amber-400" };
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "php", "sh", "bash", "css", "html", "sql"].includes(extension)) return { Icon: FileCode2, tone: "border-cyan-500/20 bg-cyan-500/10", icon: "text-cyan-400" };
  if (["json", "yaml", "yml", "xml"].includes(extension)) return { Icon: FileJson2, tone: "border-yellow-500/20 bg-yellow-500/10", icon: "text-yellow-400" };
  if (["csv", "xls", "xlsx", "ods"].includes(extension)) return { Icon: FileSpreadsheet, tone: "border-emerald-500/20 bg-emerald-500/10", icon: "text-emerald-400" };
  if (entry.mime.startsWith("text/") || ["md", "log", "conf", "ini", "service"].includes(extension)) return { Icon: FileText, tone: "border-blue-500/20 bg-blue-500/10", icon: "text-blue-400" };
  return { Icon: FileIcon, tone: "border-border bg-muted/40", icon: "text-muted-foreground" };
}

function Explorer() {
  const { path = "/", q = "" } = Route.useSearch();
  const navigate = useNavigate({ from: "/explorer" });
  const currentPath = normalizePath(path);
  const uploadInput = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [realPath, setRealPath] = useState(currentPath);
  const [pathInput, setPathInput] = useState(currentPath);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(() => {
    if (typeof window === "undefined") return "list";
    return window.localStorage.getItem("wfilemanager.explorer.layout") === "grid" ? "grid" : "list";
  });
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [propertiesEntry, setPropertiesEntry] = useState<LocalFileEntry | null>(null);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [createName, setCreateName] = useState("");
  const [renameEntry, setRenameEntry] = useState<LocalFileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteEntries, setDeleteEntries] = useState<LocalFileEntry[]>([]);
  const [transfer, setTransfer] = useState<{ kind: TransferKind; entry: LocalFileEntry } | null>(null);
  const [destination, setDestination] = useState(currentPath);
  const [modeEntry, setModeEntry] = useState<LocalFileEntry | null>(null);
  const [mode, setMode] = useState("");
  const [previewEntry, setPreviewEntry] = useState<LocalFileEntry | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [extractPlan, setExtractPlan] = useState<ExtractPlan | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [operationProgress, setOperationProgress] = useState<{
    label: string;
    percent: number;
    detail?: string;
    cancel?: () => void;
  } | null>(null);

  const clearSelection = () => {
    setSelectedPaths(new Set());
    setLastSelectedPath(null);
  };

  const setPath = (value: string) => {
    navigate({
      search: (previous: { path?: string; q?: string }) => ({
        ...previous,
        path: normalizePath(value),
      }),
    });
    clearSelection();
  };

  const setSearch = (value: string) => {
    navigate({
      search: (previous: { path?: string; q?: string }) => ({
        ...previous,
        q: value || undefined,
      }),
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await localApi.list(currentPath);
      setEntries(result.entries);
      setRealPath(result.realPath);
      setPathInput(result.path);
      setSelectedPaths((current) => {
        const existing = new Set(result.entries.map((entry) => entry.path));
        return new Set(Array.from(current).filter((entryPath) => existing.has(entryPath)));
      });
    } catch (cause) {
      setEntries([]);
      clearSelection();
      setError(cause instanceof Error ? cause.message : "Unable to load this directory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    clearSelection();
    void load();
  }, [currentPath]);

  useEffect(() => {
    window.localStorage.setItem("wfilemanager.explorer.layout", layout);
  }, [layout]);

  const visibleEntries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!showHidden && entry.hidden) return false;
      return !needle || entry.name.toLowerCase().includes(needle);
    });
  }, [entries, q, showHidden]);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.has(entry.path)),
    [entries, selectedPaths],
  );

  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) => selectedPaths.has(entry.path));
  const someVisibleSelected = visibleEntries.some((entry) => selectedPaths.has(entry.path));

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedPaths(new Set(visibleEntries.map((entry) => entry.path)));
      }
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [visibleEntries]);

  const crumbs = useMemo(() => {
    const segments = currentPath.split("/").filter(Boolean);
    return [
      { label: "/", path: "/" },
      ...segments.map((segment, index) => ({
        label: segment,
        path: `/${segments.slice(0, index + 1).join("/")}`,
      })),
    ];
  }, [currentPath]);

  const selectEntry = (entry: LocalFileEntry, options: { additive?: boolean; range?: boolean } = {}) => {
    if (options.range && lastSelectedPath) {
      const start = visibleEntries.findIndex((item) => item.path === lastSelectedPath);
      const end = visibleEntries.findIndex((item) => item.path === entry.path);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        const rangePaths = visibleEntries.slice(from, to + 1).map((item) => item.path);
        setSelectedPaths((current) => new Set(options.additive ? [...current, ...rangePaths] : rangePaths));
        return;
      }
    }
    setSelectedPaths((current) => {
      if (!options.additive) return new Set([entry.path]);
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    setLastSelectedPath(entry.path);
  };

  const toggleEntry = (entry: LocalFileEntry) => {
    selectEntry(entry, { additive: true });
  };

  const selectForContextMenu = (entry: LocalFileEntry) => {
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setLastSelectedPath(entry.path);
    }
  };

  const openEntry = async (entry: LocalFileEntry) => {
    if (entry.kind === "directory") {
      setPath(entry.path);
      return;
    }
    if (entry.kind === "symlink" && entry.linkTarget?.startsWith("/")) {
      try {
        const target = await localApi.list(entry.linkTarget);
        if (target) setPath(entry.linkTarget);
        return;
      } catch {
        // Continue to the text preview when the link does not target a directory.
      }
    }
    setPreviewEntry(entry);
    setPreviewLoading(true);
    setPreviewError(null);
    setEditorContent("");
    try {
      const result = await localApi.read(entry.path);
      setEditorContent(result.content);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      toast.success(success);
      await load();
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Operation failed");
      return false;
    }
  };

  const isCancelled = (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError";

  const downloadEntry = async (entry: LocalFileEntry) => {
    if (operationProgress) {
      toast.warning("Wait for the current transfer to finish or cancel it first");
      return;
    }
    const controller = new AbortController();
    setOperationProgress({
      label: `Downloading ${entry.name}`,
      percent: 0,
      detail: `0 B / ${formatBytes(entry.size)}`,
      cancel: () => controller.abort(),
    });
    try {
      await localApi.download(entry.path, entry.name, (value) => {
        setOperationProgress({
          label: `Downloading ${entry.name}`,
          percent: value.percent,
          detail: `${formatBytes(value.loaded)} / ${formatBytes(value.total || entry.size)}`,
          cancel: () => controller.abort(),
        });
      }, controller.signal);
      toast.success(`${entry.name} downloaded`);
    } catch (cause) {
      if (isCancelled(cause)) toast.info(`Download of ${entry.name} cancelled`);
      else toast.error(cause instanceof Error ? cause.message : "Download failed");
    } finally {
      setOperationProgress(null);
    }
  };

  const createArchive = async (entry: LocalFileEntry, format: ArchiveFormat) => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    setOperationProgress({ label: `Creating ${format.toUpperCase()} archive`, percent: 15, detail: entry.name });
    try {
      const result = await archiveApi.create(entry.path, format);
      setOperationProgress({ label: `Creating ${format.toUpperCase()} archive`, percent: 100, detail: result.path });
      toast.success(`${result.path} created${result.skippedLinks ? ` · ${result.skippedLinks} link(s) skipped` : ""}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Archive creation failed");
    } finally {
      window.setTimeout(() => setOperationProgress(null), 650);
      setArchiveBusy(false);
    }
  };

  const extractArchive = async (entry: LocalFileEntry) => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    setOperationProgress({ label: `Inspecting ${entry.name}`, percent: 15, detail: "Checking archive safety" });
    try {
      const inspection = await archiveApi.inspect(entry.path);
      setOperationProgress(null);
      if (inspection.multipleTopLevel) {
        setExtractPlan({ entry, inspection });
      } else {
        setOperationProgress({ label: `Extracting ${entry.name}`, percent: 35, detail: `Into ${inspection.destinationParent}` });
        const result = await archiveApi.extract(entry.path, "current");
        setOperationProgress({ label: `Extracting ${entry.name}`, percent: 100, detail: result.extractedTo });
        toast.success(`${entry.name} extracted into ${result.extractedTo}`);
        await load();
      }
    } catch (cause) {
      setOperationProgress(null);
      toast.error(cause instanceof Error ? cause.message : "Archive extraction failed");
    } finally {
      window.setTimeout(() => setOperationProgress(null), 650);
      setArchiveBusy(false);
    }
  };

  const confirmExtraction = async (mode: "current" | "folder") => {
    if (!extractPlan || archiveBusy) return;
    const plan = extractPlan;
    setExtractPlan(null);
    setArchiveBusy(true);
    setOperationProgress({
      label: `Extracting ${plan.entry.name}`,
      percent: 35,
      detail: mode === "folder" ? `Into ${plan.inspection.suggestedFolder}` : `Into ${plan.inspection.destinationParent}`,
    });
    try {
      const result = await archiveApi.extract(
        plan.entry.path,
        mode,
        mode === "folder" ? plan.inspection.suggestedFolder : undefined,
      );
      setOperationProgress({ label: `Extracting ${plan.entry.name}`, percent: 100, detail: result.extractedTo });
      toast.success(`${plan.entry.name} extracted into ${result.extractedTo}`);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Archive extraction failed");
    } finally {
      window.setTimeout(() => setOperationProgress(null), 650);
      setArchiveBusy(false);
    }
  };

  const openRename = (entry: LocalFileEntry) => {
    setRenameEntry(entry);
    setRenameName(entry.name);
  };

  const openTransfer = (kind: TransferKind, entry: LocalFileEntry) => {
    setTransfer({ kind, entry });
    setDestination(currentPath);
  };

  const openMode = (entry: LocalFileEntry) => {
    setModeEntry(entry);
    setMode(entry.mode);
  };

  const dropdownMenu = (entry: LocalFileEntry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md hover:bg-muted"
          aria-label={`Actions for ${entry.name}`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => void openEntry(entry)}><Eye className="mr-2 h-4 w-4" />{entry.kind === "directory" ? "Open" : "View / edit"}</DropdownMenuItem>
        {entry.kind === "file" && <DropdownMenuItem onClick={() => void downloadEntry(entry)}><Download className="mr-2 h-4 w-4" />Download</DropdownMenuItem>}
        {entry.kind === "directory" && <DropdownMenuItem onClick={() => void createArchive(entry, "zip")}><FileArchive className="mr-2 h-4 w-4" />Compress as ZIP</DropdownMenuItem>}
        {entry.kind === "directory" && <DropdownMenuItem onClick={() => void createArchive(entry, "tar.gz")}><FileArchive className="mr-2 h-4 w-4" />Compress as TAR.GZ</DropdownMenuItem>}
        {isArchiveEntry(entry) && <DropdownMenuItem onClick={() => void extractArchive(entry)}><FolderInput className="mr-2 h-4 w-4" />Extract archive</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openRename(entry)}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openTransfer("copy", entry)}><Copy className="mr-2 h-4 w-4" />Copy to…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openTransfer("move", entry)}><FolderInput className="mr-2 h-4 w-4" />Move to…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openMode(entry)}><Shield className="mr-2 h-4 w-4" />Permissions</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPropertiesEntry(entry)}><Info className="mr-2 h-4 w-4" />Properties</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteEntries([entry])}><Trash2 className="mr-2 h-4 w-4" />Move to trash</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const contextMenu = (entry: LocalFileEntry) => (
    <ContextMenuContent className="min-w-56">
      <ContextMenuItem onClick={() => void openEntry(entry)}><Eye className="mr-2 h-4 w-4" />{entry.kind === "directory" ? "Open" : "View / edit"}</ContextMenuItem>
      {entry.kind === "file" && <ContextMenuItem onClick={() => void downloadEntry(entry)}><Download className="mr-2 h-4 w-4" />Download</ContextMenuItem>}
      {entry.kind === "directory" && <ContextMenuItem onClick={() => void createArchive(entry, "zip")}><FileArchive className="mr-2 h-4 w-4" />Compress as ZIP</ContextMenuItem>}
      {entry.kind === "directory" && <ContextMenuItem onClick={() => void createArchive(entry, "tar.gz")}><FileArchive className="mr-2 h-4 w-4" />Compress as TAR.GZ</ContextMenuItem>}
      {isArchiveEntry(entry) && <ContextMenuItem onClick={() => void extractArchive(entry)}><FolderInput className="mr-2 h-4 w-4" />Extract archive</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => openRename(entry)}><Pencil className="mr-2 h-4 w-4" />Rename</ContextMenuItem>
      <ContextMenuItem onClick={() => openTransfer("copy", entry)}><Copy className="mr-2 h-4 w-4" />Copy to…</ContextMenuItem>
      <ContextMenuItem onClick={() => openTransfer("move", entry)}><FolderInput className="mr-2 h-4 w-4" />Move to…</ContextMenuItem>
      <ContextMenuItem onClick={() => openMode(entry)}><Shield className="mr-2 h-4 w-4" />Permissions</ContextMenuItem>
      <ContextMenuItem onClick={() => setPropertiesEntry(entry)}><Info className="mr-2 h-4 w-4" />Properties</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteEntries(selectedPaths.has(entry.path) && selectedEntries.length > 1 ? selectedEntries : [entry])}>
        <Trash2 className="mr-2 h-4 w-4" />{selectedPaths.has(entry.path) && selectedEntries.length > 1 ? `Move ${selectedEntries.length} selected items to trash` : "Move to trash"}
      </ContextMenuItem>
    </ContextMenuContent>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-surface/60 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => history.back()} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => history.forward()} aria-label="Forward"><ArrowRight className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" disabled={currentPath === "/"} onClick={() => setPath(parentPath(currentPath))} aria-label="Parent"><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => setPath("/root")} aria-label="Root home"><Home className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => void load()} aria-label="Refresh"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
          </div>

          <form
            className="flex min-w-[260px] flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPath(pathInput);
            }}
          >
            <Input value={pathInput} onChange={(event) => setPathInput(event.target.value)} className="font-mono text-xs" aria-label="Server path" />
          </form>

          <div className="relative min-w-[190px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(event) => setSearch(event.target.value)} placeholder="Filter current directory" className="pl-8" />
          </div>

          <Button variant="outline" size="sm" onClick={() => { setCreateKind("file"); setCreateName(""); }}><FilePlus2 className="mr-1.5 h-4 w-4" />New file</Button>
          <Button variant="outline" size="sm" onClick={() => { setCreateKind("directory"); setCreateName(""); }}><FolderPlus className="mr-1.5 h-4 w-4" />New folder</Button>
          <Button size="sm" onClick={() => uploadInput.current?.click()}><UploadCloud className="mr-1.5 h-4 w-4" />Upload</Button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            hidden
            onChange={async (event) => {
              if (!event.target.files?.length) return;
              if (operationProgress) {
                toast.warning("Wait for the current transfer to finish or cancel it first");
                event.target.value = "";
                return;
              }
              const files = event.target.files;
              const controller = new AbortController();
              setOperationProgress({ label: `Uploading ${files.length} file(s)`, percent: 0, cancel: () => controller.abort() });
              try {
                await localApi.upload(currentPath, files, (value: ProgressState) => {
                  setOperationProgress({
                    label: `Uploading ${files.length} file(s)`,
                    percent: value.percent,
                    detail: `${formatBytes(value.loaded)} / ${formatBytes(value.total)}${value.detail ? ` · ${value.detail}` : ""}`,
                    cancel: () => controller.abort(),
                  });
                }, controller.signal);
                toast.success(`${files.length} file(s) uploaded`);
                await load();
              } catch (cause) {
                if (isCancelled(cause)) toast.info("Upload cancelled");
                else toast.error(cause instanceof Error ? cause.message : "Upload failed");
              } finally {
                setOperationProgress(null);
                event.target.value = "";
              }
            }}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                <span key={crumb.path} className="contents">
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {index === crumbs.length - 1 ? (
                      <BreadcrumbPage className="font-mono text-xs">{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild><button className="font-mono text-xs" onClick={() => setPath(crumb.path)}>{crumb.label}</button></BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-border bg-background p-0.5" aria-label="Explorer layout">
              <Button size="icon" variant={layout === "list" ? "secondary" : "ghost"} className="h-7 w-7 rounded-sm" onClick={() => setLayout("list")} aria-label="List layout" title="List layout"><List className="h-4 w-4" /></Button>
              <Button size="icon" variant={layout === "grid" ? "secondary" : "ghost"} className="h-7 w-7 rounded-sm" onClick={() => setLayout("grid")} aria-label="Mosaic layout" title="Mosaic layout"><Grid2X2 className="h-4 w-4" /></Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={showHidden} onCheckedChange={(value) => setShowHidden(Boolean(value))} />
              Show hidden files
            </label>
          </div>
        </div>

        {selectedEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2 text-xs">
            <span className="font-medium">{selectedEntries.length} selected</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedPaths(new Set(visibleEntries.map((entry) => entry.path)))}>Select all visible</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>Clear</Button>
            <Button size="sm" variant="destructive" className="ml-auto h-7 text-xs" onClick={() => setDeleteEntries(selectedEntries)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Move selected to trash</Button>
          </div>
        )}
      </div>

      {operationProgress && (
        <div className="border-b border-border bg-surface/70 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-3 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium">{operationProgress.label}</span>
            <span className="shrink-0 font-mono text-muted-foreground">{operationProgress.detail || `${operationProgress.percent}%`}</span>
            {operationProgress.cancel && (
              <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={operationProgress.cancel}>
                <CircleX className="mr-1 h-3.5 w-3.5" />Cancel
              </Button>
            )}
          </div>
          <Progress value={operationProgress.percent} />
        </div>
      )}

      {currentPath !== realPath && !loading && (
        <Alert className="m-3 mb-0"><AlertDescription>Resolved path: <span className="font-mono">{realPath}</span></AlertDescription></Alert>
      )}
      {error && <Alert variant="destructive" className="m-3 mb-0"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="min-h-0 flex-1 overflow-auto p-4" onClick={(event) => { if (event.target === event.currentTarget) clearSelection(); }}>
        {loading ? (
          <div className="grid h-56 place-items-center text-sm text-muted-foreground">
            <div className="text-center"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />Loading {currentPath}</div>
          </div>
        ) : !error && visibleEntries.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-xl border border-dashed border-border bg-muted/10 text-center">
            <div>
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl border border-primary/20 bg-primary/10 shadow-sm">
                <Folder className="h-9 w-9 fill-primary/15 text-primary" />
              </div>
              <p className="font-medium">This directory is empty</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a file, create a folder or upload something here.</p>
            </div>
          </div>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {visibleEntries.map((entry) => {
              const visual = entryVisual(entry);
              const Icon = visual.Icon;
              const active = selectedPaths.has(entry.path);
              return (
                <ContextMenu key={entry.path}>
                  <ContextMenuTrigger asChild onContextMenu={() => selectForContextMenu(entry)}>
                    <article
                      role="button"
                      tabIndex={0}
                      aria-label={`${entry.kind === "directory" ? "Folder" : "File"} ${entry.name}`}
                      aria-selected={active}
                      className={cn(
                        "group relative flex min-h-40 cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card p-2.5 outline-none no-underline transition-colors",
                        "hover:border-primary/35 hover:bg-muted/30 hover:no-underline",
                        "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25",
                        active && "border-primary/60 bg-primary/8 ring-1 ring-primary/30",
                      )}
                      onClick={(event) => selectEntry(entry, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey })}
                      onDoubleClick={() => void openEntry(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void openEntry(entry);
                        if (event.key === " ") { event.preventDefault(); toggleEntry(entry); }
                      }}
                    >
                      <div className="absolute left-2 top-2 z-10" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                        <Checkbox checked={active} onCheckedChange={() => toggleEntry(entry)} aria-label={`Select ${entry.name}`} />
                      </div>
                      <div className="absolute right-1.5 top-1.5 z-10 opacity-70 group-hover:opacity-100">{dropdownMenu(entry)}</div>
                      <div className="flex flex-1 flex-col items-center justify-center px-1 pt-4 text-center">
                        <div className={cn("mb-2.5 grid h-14 w-14 place-items-center rounded-xl border", visual.tone)}>
                          <Icon className={cn("h-8 w-8", visual.icon)} />
                        </div>
                        <div className="w-full truncate text-sm font-medium no-underline group-hover:no-underline" title={entry.name}>{entry.name}</div>
                        {entry.linkTarget && <div className="mt-1 w-full truncate font-mono text-[10px] text-muted-foreground no-underline" title={entry.linkTarget}>→ {entry.linkTarget}</div>}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/65 pt-2 text-[10px] text-muted-foreground">
                        <span className="truncate">{entry.kind === "directory" ? "Folder" : formatBytes(entry.size)}</span>
                        <Badge variant="outline" className="h-5 px-1.5 font-mono text-[9px] font-normal">{entry.mode}</Badge>
                      </div>
                    </article>
                  </ContextMenuTrigger>
                  {contextMenu(entry)}
                </ContextMenu>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-[34px_minmax(0,1fr)_90px_42px] items-center gap-3 border-b border-border bg-muted/35 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid-cols-[34px_minmax(0,1fr)_100px_86px_80px_150px_42px]">
              <Checkbox
                checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                onCheckedChange={() => setSelectedPaths(allVisibleSelected ? new Set() : new Set(visibleEntries.map((entry) => entry.path)))}
                aria-label="Select all visible items"
              />
              <span>Name</span>
              <span className="text-right">Size</span>
              <span className="hidden md:block">Mode</span>
              <span className="hidden md:block">Owner</span>
              <span className="hidden md:block">Modified</span>
              <span />
            </div>
            <div className="divide-y divide-border/80">
              {visibleEntries.map((entry) => {
                const visual = entryVisual(entry);
                const Icon = visual.Icon;
                const active = selectedPaths.has(entry.path);
                return (
                  <ContextMenu key={entry.path}>
                    <ContextMenuTrigger asChild onContextMenu={() => selectForContextMenu(entry)}>
                      <article
                        role="button"
                        tabIndex={0}
                        aria-label={`${entry.kind === "directory" ? "Folder" : "File"} ${entry.name}`}
                        aria-selected={active}
                        className={cn(
                          "grid min-h-12 cursor-pointer grid-cols-[34px_minmax(0,1fr)_90px_42px] items-center gap-3 px-3 py-1.5 outline-none no-underline transition-colors md:grid-cols-[34px_minmax(0,1fr)_100px_86px_80px_150px_42px]",
                          "hover:bg-muted/45 hover:no-underline",
                          "focus-visible:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                          active && "bg-primary/10",
                        )}
                        onClick={(event) => selectEntry(entry, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey })}
                        onDoubleClick={() => void openEntry(entry)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void openEntry(entry);
                          if (event.key === " ") { event.preventDefault(); toggleEntry(entry); }
                        }}
                      >
                        <div onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                          <Checkbox checked={active} onCheckedChange={() => toggleEntry(entry)} aria-label={`Select ${entry.name}`} />
                        </div>
                        <div className="flex min-w-0 items-center gap-3 no-underline">
                          <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md border", visual.tone)}>
                            <Icon className={cn("h-5 w-5", visual.icon)} />
                          </div>
                          <div className="min-w-0 no-underline">
                            <div className="truncate text-sm font-medium no-underline group-hover:no-underline" title={entry.name}>{entry.name}</div>
                            {entry.linkTarget && <div className="truncate font-mono text-[10px] text-muted-foreground no-underline" title={entry.linkTarget}>→ {entry.linkTarget}</div>}
                          </div>
                        </div>
                        <span className="truncate text-right text-xs text-muted-foreground">{entry.kind === "directory" ? "—" : formatBytes(entry.size)}</span>
                        <Badge variant="outline" className="hidden h-5 w-fit px-1.5 font-mono text-[10px] font-normal md:inline-flex">{entry.mode}</Badge>
                        <span className="hidden font-mono text-xs text-muted-foreground md:block">{entry.uid}:{entry.gid}</span>
                        <span className="hidden truncate text-xs text-muted-foreground md:block">{formatDate(entry.modifiedAt)}</span>
                        <div className="flex justify-end" onDoubleClick={(event) => event.stopPropagation()}>{dropdownMenu(entry)}</div>
                      </article>
                    </ContextMenuTrigger>
                    {contextMenu(entry)}
                  </ContextMenu>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{visibleEntries.length} item(s) · {selectedEntries.length} selected · Ctrl/⌘ and Shift supported · right-click for actions</span>
        <span className="font-mono">{selectedEntries.length === 1 ? selectedEntries[0].path : currentPath}</span>
      </div>

      <Dialog open={Boolean(createKind)} onOpenChange={(open) => !open && setCreateKind(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create {createKind === "directory" ? "directory" : "file"}</DialogTitle><DialogDescription>It will be created inside <span className="font-mono">{currentPath}</span>.</DialogDescription></DialogHeader>
          <Input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder={createKind === "directory" ? "new-directory" : "new-file.txt"} />
          <DialogFooter><Button variant="outline" onClick={() => setCreateKind(null)}>Cancel</Button><Button disabled={!createName.trim()} onClick={async () => {
            const ok = await mutate(
              () => createKind === "directory" ? localApi.createDirectory(currentPath, createName) : localApi.createFile(currentPath, createName),
              `${createName} created`,
            );
            if (ok) setCreateKind(null);
          }}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameEntry)} onOpenChange={(open) => !open && setRenameEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename</DialogTitle><DialogDescription>Rename <span className="font-mono">{renameEntry?.path}</span>.</DialogDescription></DialogHeader>
          <Input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} />
          <DialogFooter><Button variant="outline" onClick={() => setRenameEntry(null)}>Cancel</Button><Button disabled={!renameName.trim()} onClick={async () => {
            if (!renameEntry) return;
            const ok = await mutate(() => localApi.rename(renameEntry.path, renameName), "Item renamed");
            if (ok) setRenameEntry(null);
          }}>Rename</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transfer)} onOpenChange={(open) => !open && setTransfer(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{transfer?.kind === "copy" ? "Copy" : "Move"} item</DialogTitle><DialogDescription>Enter an existing destination directory.</DialogDescription></DialogHeader>
          <div className="grid gap-2"><span className="truncate font-mono text-xs text-muted-foreground">Source: {transfer?.entry.path}</span><Input value={destination} onChange={(event) => setDestination(event.target.value)} className="font-mono" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setTransfer(null)}>Cancel</Button><Button onClick={async () => {
            if (!transfer) return;
            const ok = await mutate(
              () => {
                const label = transfer.kind === "copy" ? `Copying ${transfer.entry.name}` : `Moving ${transfer.entry.name}`;
                setOperationProgress({ label, percent: 0 });
                const update = (job: OperationJob) => setOperationProgress({
                  label,
                  percent: job.progress,
                  detail: job.currentItem ? `${job.progress}% · ${job.currentItem}` : `${job.progress}%`,
                });
                return transfer.kind === "copy"
                  ? localApi.copy(transfer.entry.path, destination, update)
                  : localApi.move(transfer.entry.path, destination, update);
              },
              transfer.kind === "copy" ? "Item copied" : "Item moved",
            );
            setTimeout(() => setOperationProgress(null), 800);
            if (ok) setTransfer(null);
          }}>{transfer?.kind === "copy" ? "Copy" : "Move"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(modeEntry)} onOpenChange={(open) => !open && setModeEntry(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change permissions</DialogTitle><DialogDescription>Enter an octal mode such as 0644, 0755 or 0600.</DialogDescription></DialogHeader>
          <Input value={mode} onChange={(event) => setMode(event.target.value)} className="font-mono" />
          <DialogFooter><Button variant="outline" onClick={() => setModeEntry(null)}>Cancel</Button><Button onClick={async () => {
            if (!modeEntry) return;
            const ok = await mutate(() => localApi.chmod(modeEntry.path, mode), "Permissions changed");
            if (ok) setModeEntry(null);
          }}>Apply</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(propertiesEntry)} onOpenChange={(open) => !open && setPropertiesEntry(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Info className="h-4 w-4" />Properties</DialogTitle>
            <DialogDescription className="truncate font-mono">{propertiesEntry?.path}</DialogDescription>
          </DialogHeader>
          {propertiesEntry && (
            <div className="overflow-hidden rounded-lg border border-border">
              <dl className="divide-y divide-border text-sm">
                {[
                  ["Name", propertiesEntry.name],
                  ["Type", propertiesEntry.kind === "directory" ? "Directory" : propertiesEntry.kind === "symlink" ? "Symbolic link" : propertiesEntry.kind === "file" ? "File" : "Other"],
                  ["MIME type", propertiesEntry.mime || "—"],
                  ["Size", propertiesEntry.kind === "directory" ? "—" : `${formatBytes(propertiesEntry.size)} (${propertiesEntry.size.toLocaleString()} bytes)`],
                  ["Permissions", propertiesEntry.mode],
                  ["Owner", `${propertiesEntry.uid}:${propertiesEntry.gid}`],
                  ["Modified", formatDate(propertiesEntry.modifiedAt)],
                  ["Created", formatDate(propertiesEntry.createdAt)],
                  ["Last accessed", formatDate(propertiesEntry.accessedAt)],
                  ["Readable", propertiesEntry.readable ? "Yes" : "No"],
                  ["Writable", propertiesEntry.writable ? "Yes" : "No"],
                  ["Hidden", propertiesEntry.hidden ? "Yes" : "No"],
                  ...(propertiesEntry.linkTarget ? [["Link target", propertiesEntry.linkTarget]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[140px_minmax(0,1fr)] gap-4 px-4 py-2.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className={cn("min-w-0 break-all", ["Permissions", "Owner", "Link target"].includes(label) && "font-mono")}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <DialogFooter><Button onClick={() => setPropertiesEntry(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewEntry)} onOpenChange={(open) => !open && setPreviewEntry(null)}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileIcon className="h-4 w-4" />{previewEntry?.name}</DialogTitle><DialogDescription className="truncate font-mono">{previewEntry?.path}</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1">
            {previewLoading ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground"><Loader2 className="mb-2 h-5 w-5 animate-spin" />Loading file…</div>
            ) : previewError ? (
              <div className="grid h-full place-items-center p-8 text-center"><div><HardDriveUpload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Text preview unavailable</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">{previewError}</p>{previewEntry?.kind === "file" && <Button className="mt-4" variant="outline" onClick={() => void downloadEntry(previewEntry)}><Download className="mr-2 h-4 w-4" />Download file</Button>}</div></div>
            ) : (
              <textarea value={editorContent} onChange={(event) => setEditorContent(event.target.value)} spellCheck={false} className="h-full w-full resize-none rounded-md border border-border bg-[oklch(0.14_0.005_260)] p-4 font-mono text-[13px] leading-relaxed text-[oklch(0.92_0.005_250)] outline-none focus:ring-1 focus:ring-ring" />
            )}
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">Maximum editable size: 5 MB</span>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setPreviewEntry(null)}>Close</Button><Button disabled={Boolean(previewError) || previewLoading || saving} onClick={async () => {
              if (!previewEntry) return;
              setSaving(true);
              try {
                await localApi.save(previewEntry.path, editorContent);
                toast.success("File saved");
                await load();
              } catch (cause) {
                toast.error(cause instanceof Error ? cause.message : "Save failed");
              } finally {
                setSaving(false);
              }
            }}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteEntries.length > 0} onOpenChange={(open) => !open && setDeleteEntries([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {deleteEntries.length > 1 ? `${deleteEntries.length} items` : "item"} to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteEntries.length === 1 ? <span className="font-mono">{deleteEntries[0]?.path}</span> : "All selected files and folders"} will be moved to the wFileManager trash. They can be restored later from the Trash page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              const pending = [...deleteEntries];
              if (!pending.length) return;
              const label = `Moving ${pending.length} item(s) to trash`;
              const ok = await mutate(async () => {
                for (let index = 0; index < pending.length; index += 1) {
                  const entry = pending[index];
                  setOperationProgress({ label, percent: Math.round((index / pending.length) * 100), detail: entry.name });
                  await localApi.trash.move(entry.path);
                }
                setOperationProgress({ label, percent: 100, detail: "Moved to trash" });
              }, `${pending.length} item(s) moved to trash`);
              setTimeout(() => setOperationProgress(null), 650);
              if (ok) {
                setDeleteEntries([]);
                clearSelection();
              }
            }}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(extractPlan)} onOpenChange={(open) => !open && setExtractPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive contains multiple top-level items</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Extracting <span className="font-mono text-foreground">{extractPlan?.entry.name}</span> directly into <span className="font-mono text-foreground">{extractPlan?.inspection.destinationParent}</span> will place several items there.</p>
                <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
                  {extractPlan?.inspection.topLevelEntries.slice(0, 20).map((item) => <div key={item}>{item}</div>)}
                  {(extractPlan?.inspection.topLevelEntries.length || 0) > 20 && <div>…and {(extractPlan?.inspection.topLevelEntries.length || 0) - 20} more</div>}
                </div>
                <p>Continue with raw extraction or place everything in a new folder named <span className="font-mono text-foreground">{extractPlan?.inspection.suggestedFolder}</span>.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => void confirmExtraction("current")}>Extract here</Button>
            <AlertDialogAction onClick={() => void confirmExtraction("folder")}>Extract into folder</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
