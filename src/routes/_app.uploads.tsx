import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronUp,
  Folder,
  FolderOpen,
  Home,
  Loader2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { localApi, type DirectoryResult, type ProgressState } from "@/lib/local-api";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/uploads")({
  head: () => ({ meta: [{ title: "Uploads — wFileManager" }] }),
  component: Uploads,
});

type UploadStatus = "uploading" | "completed" | "failed" | "cancelled";
type UploadResult = { name: string; size: number; status: UploadStatus; error?: string };

const QUICK_DESTINATIONS = ["/root", "/home", "/var/www", "/opt", "/tmp"];
const RECENT_KEY = "wfilemanager_recent_upload_destinations";

function parentPath(value: string) {
  if (value === "/") return "/";
  const parts = value.replace(/\/+$/, "").split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function isAbortError(cause: unknown) {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function Uploads() {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const [destination, setDestination] = useState("/root");
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({ loaded: 0, total: 0, percent: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState("/root");
  const [pickerInput, setPickerInput] = useState("/root");
  const [pickerData, setPickerData] = useState<DirectoryResult | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (Array.isArray(value)) setRecent(value.filter((item): item is string => typeof item === "string").slice(0, 5));
    } catch {
      setRecent([]);
    }
  }, []);

  const rememberDestination = (value: string) => {
    const next = [value, ...recent.filter((item) => item !== value)].slice(0, 5);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const loadPicker = async (value: string) => {
    const path = value.trim() || "/";
    setPickerLoading(true);
    try {
      const data = await localApi.list(path);
      setPickerData(data);
      setPickerPath(data.path);
      setPickerInput(data.path);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to open directory");
    } finally {
      setPickerLoading(false);
    }
  };

  useEffect(() => {
    if (pickerOpen) void loadPicker(destination);
  }, [pickerOpen]);

  const directories = useMemo(
    () => pickerData?.entries.filter((entry) => entry.kind === "directory" && !entry.hidden) || [],
    [pickerData],
  );

  const cancelUpload = () => {
    uploadController.current?.abort();
  };

  const upload = async (files: FileList | File[]) => {
    const values = Array.from(files);
    if (!values.length || uploading) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    setProgress({ loaded: 0, total: values.reduce((sum, file) => sum + file.size, 0), percent: 0 });
    setResults(values.map((file) => ({ name: file.name, size: file.size, status: "uploading" })));
    try {
      await localApi.upload(destination, values, setProgress, controller.signal);
      setResults(values.map((file) => ({ name: file.name, size: file.size, status: "completed" })));
      rememberDestination(destination);
      toast.success(`${values.length} file(s) uploaded to ${destination}`);
    } catch (cause) {
      if (isAbortError(cause)) {
        setResults(values.map((file) => ({ name: file.name, size: file.size, status: "cancelled" })));
        toast.info("Upload cancelled. Partial files were removed.");
      } else {
        const message = cause instanceof Error ? cause.message : "Upload failed";
        setResults(values.map((file) => ({ name: file.name, size: file.size, status: "failed", error: message })));
        toast.error(message);
      }
    } finally {
      uploadController.current = null;
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Upload files</h1>
        <p className="text-sm text-muted-foreground">Choose a server folder visually, then upload files with progress and cancellation.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Destination</CardTitle>
          <CardDescription>Select a known location or browse the server instead of typing the complete path manually.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input value={destination} onChange={(event) => setDestination(event.target.value)} className="font-mono" />
            <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}><FolderOpen className="mr-2 h-4 w-4" />Browse</Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_DESTINATIONS.map((path) => (
              <Button key={path} type="button" size="sm" variant={destination === path ? "secondary" : "outline"} className="font-mono text-xs" onClick={() => setDestination(path)}>{path}</Button>
            ))}
          </div>

          {recent.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent destinations</p>
              <div className="flex flex-wrap gap-2">
                {recent.map((path) => <Button key={path} type="button" size="sm" variant="ghost" className="font-mono text-xs" onClick={() => setDestination(path)}>{path}</Button>)}
              </div>
            </div>
          )}

          <div
            className={cn("grid min-h-48 place-items-center rounded-lg border border-dashed border-border p-8 text-center transition-colors", dragging && "border-primary bg-primary/5")}
            onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploading) void upload(event.dataTransfer.files); }}
          >
            <div>
              <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Drop files here</p>
              <p className="mt-1 text-xs text-muted-foreground">or choose files from this device</p>
              <div className="mt-4 flex justify-center">
                <Button disabled={uploading || !destination.startsWith("/")} onClick={() => inputRef.current?.click()}>{uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Choose files</Button>
              </div>
            </div>
          </div>
          <input ref={inputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) void upload(event.target.files); event.target.value = ""; }} />
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Latest upload</CardTitle>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{progress.percent}%</span>
                {uploading && <Button size="sm" variant="destructive" onClick={cancelUpload}><X className="mr-1.5 h-3.5 w-3.5" />Cancel</Button>}
              </div>
            </div>
            <Progress value={progress.percent} />
            <CardDescription>{formatBytes(progress.loaded)} of {formatBytes(progress.total || results.reduce((sum, item) => sum + item.size, 0))}{progress.detail ? ` · ${progress.detail}` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {results.map((result) => (
                <div key={result.name} className="flex items-center gap-3 px-6 py-3">
                  {result.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : result.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{result.name}</p><p className="text-xs text-muted-foreground">{formatBytes(result.size)}{result.error ? ` · ${result.error}` : ""}</p></div>
                  <Badge variant="outline" className="capitalize">{result.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Select upload destination</DialogTitle><DialogDescription>Browse server directories and choose the folder that will receive the uploaded files.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="icon" variant="outline" onClick={() => void loadPicker("/root")} aria-label="Home"><Home className="h-4 w-4" /></Button>
              <Button size="icon" variant="outline" disabled={pickerPath === "/"} onClick={() => void loadPicker(parentPath(pickerPath))} aria-label="Parent directory"><ChevronUp className="h-4 w-4" /></Button>
              <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); void loadPicker(pickerInput); }}>
                <Input className="font-mono text-xs" value={pickerInput} onChange={(event) => setPickerInput(event.target.value)} />
                <Button type="submit" variant="outline">Go</Button>
              </form>
            </div>
            <div className="rounded-md border border-border">
              <ScrollArea className="h-80">
                {pickerLoading ? (
                  <div className="grid h-80 place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading directory…</div>
                ) : directories.length === 0 ? (
                  <div className="grid h-80 place-items-center text-sm text-muted-foreground">No visible subdirectories in this location.</div>
                ) : (
                  <div className="grid gap-1 p-2 sm:grid-cols-2">
                    {directories.map((entry) => (
                      <button key={entry.path} type="button" className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left hover:border-border hover:bg-muted/60" onClick={() => void loadPicker(entry.path)}>
                        <Folder className="h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{entry.name}</p><p className="truncate font-mono text-[11px] text-muted-foreground">{entry.path}</p></div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">Selected folder: <span className="font-mono">{pickerPath}</span></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button onClick={() => { setDestination(pickerPath); setPickerOpen(false); }}><FolderOpen className="mr-2 h-4 w-4" />Use this folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
