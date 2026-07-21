import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, KeyRound, Loader2, Maximize2, Minimize2, Plus, RotateCw, ShieldAlert, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { localApi, type TerminalIdentity } from "@/lib/local-api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/terminal")({
  head: () => ({ meta: [{ title: "Terminal — wFileManager" }] }),
  component: TerminalPage,
});

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type ShellMode = "user" | "root";
interface TerminalTab { id: string; index: number; name: string; cwd: string; mode: ShellMode }
interface ReconnectResult { mode: ShellMode; linuxUsername: string; home: string }
interface TerminalHandle {
  focus: () => void;
  clear: () => void;
  copySelection: () => Promise<boolean>;
  reconnect: (mode?: ShellMode, password?: string) => Promise<ReconnectResult>;
}

function createTab(index: number, identity: TerminalIdentity): TerminalTab {
  return {
    id: `terminal-${Date.now()}-${index}`,
    index,
    name: `${identity.linuxUsername}-${index}`,
    cwd: identity.home,
    mode: "user",
  };
}

const TerminalPane = forwardRef<TerminalHandle, {
  active: boolean;
  cwd: string;
  initialMode: ShellMode;
  onStatus: (status: ConnectionStatus) => void;
}>(function TerminalPane({ active, cwd, initialMode, onStatus }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitRef = useRef<XTermFitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const disposedRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const writeQueueRef = useRef(Promise.resolve());
  const modeRef = useRef<ShellMode>(initialMode);
  const connectRef = useRef<(mode?: ShellMode, password?: string) => Promise<ReconnectResult>>(async () => ({ mode: "user", linuxUsername: "", home: "" }));
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    disposedRef.current = false;
    let resizeObserver: ResizeObserver | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;

    const initialize = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposedRef.current || !hostRef.current) return;

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 10000,
        allowProposedApi: false,
        convertEol: false,
        theme: {
          background: "#171719",
          foreground: "#e8e8e8",
          cursor: "#3ecf8e",
          selectionBackground: "#3ecf8e55",
          black: "#171719",
          red: "#f87171",
          green: "#3ecf8e",
          yellow: "#facc15",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#e5e7eb",
          brightBlack: "#71717a",
          brightRed: "#fca5a5",
          brightGreen: "#6ee7b7",
          brightYellow: "#fde047",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#ffffff",
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(hostRef.current);
      terminalRef.current = terminal;
      fitRef.current = fit;
      requestAnimationFrame(() => fit.fit());

      const stopPolling = () => {
        if (pollingRef.current != null) window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      };

      const poll = async () => {
        const sessionId = sessionIdRef.current;
        if (disposedRef.current || !sessionId) return;
        try {
          const output = await localApi.ptyOutput(sessionId, cursorRef.current);
          cursorRef.current = output.cursor;
          if (output.data) terminal.write(output.data);
          if (output.exited) {
            onStatusRef.current("disconnected");
            sessionIdRef.current = null;
            return;
          }
          pollingRef.current = window.setTimeout(poll, 80);
        } catch (error) {
          terminal.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Terminal connection failed"}\x1b[0m`);
          onStatusRef.current("error");
          sessionIdRef.current = null;
        }
      };

      const connect = async (requestedMode = modeRef.current, password?: string) => {
        stopPolling();
        const previous = sessionIdRef.current;
        sessionIdRef.current = null;
        if (previous) await localApi.ptyClose(previous).catch(() => undefined);
        cursorRef.current = 0;
        terminal.reset();
        terminal.writeln(`\x1b[90mConnecting to the local ${requestedMode === "root" ? "root" : "sudo-user"} shell…\x1b[0m`);
        onStatusRef.current("connecting");
        fit.fit();
        try {
          const result = await localApi.ptyCreate(
            requestedMode === "root" ? "/root" : cwd,
            terminal.cols,
            terminal.rows,
            requestedMode,
            password,
          );
          if (disposedRef.current) {
            await localApi.ptyClose(result.sessionId).catch(() => undefined);
            throw new Error("Terminal was closed while connecting");
          }
          terminal.reset();
          sessionIdRef.current = result.sessionId;
          modeRef.current = requestedMode;
          onStatusRef.current("connected");
          terminal.focus();
          void poll();
          return { mode: result.mode, linuxUsername: result.linuxUsername, home: result.home };
        } catch (error) {
          terminal.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Unable to create terminal"}\x1b[0m`);
          onStatusRef.current("error");
          throw error;
        }
      };
      connectRef.current = connect;

      dataDisposable = terminal.onData((data) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        writeQueueRef.current = writeQueueRef.current
          .then(() => localApi.ptyInput(sessionId, data))
          .then(() => undefined)
          .catch((error) => {
            terminal.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Input failed"}\x1b[0m`);
          });
      });
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        const sessionId = sessionIdRef.current;
        if (sessionId) void localApi.ptyResize(sessionId, cols, rows).catch(() => undefined);
      });
      resizeObserver = new ResizeObserver(() => {
        if (!hostRef.current || hostRef.current.clientWidth === 0 || hostRef.current.clientHeight === 0) return;
        fit.fit();
      });
      resizeObserver.observe(hostRef.current);
      await connect(initialMode);
    };

    void initialize();
    return () => {
      disposedRef.current = true;
      if (pollingRef.current != null) window.clearTimeout(pollingRef.current);
      const sessionId = sessionIdRef.current;
      if (sessionId) void localApi.ptyClose(sessionId).catch(() => undefined);
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [cwd]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
  }, [active]);

  useImperativeHandle(ref, () => ({
    focus: () => terminalRef.current?.focus(),
    clear: () => terminalRef.current?.clear(),
    async copySelection() {
      const selection = terminalRef.current?.getSelection() || "";
      if (!selection) return false;
      await navigator.clipboard.writeText(selection);
      return true;
    },
    reconnect: (mode, password) => connectRef.current(mode, password),
  }), []);

  return <div ref={hostRef} className={cn("h-full w-full bg-[#171719] p-2", !active && "hidden")} />;
});

function TerminalPage() {
  const auth = useAuth();
  const [identity, setIdentity] = useState<TerminalIdentity | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState("");
  const [counter, setCounter] = useState(2);
  const [fullscreen, setFullscreen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [rootDialog, setRootDialog] = useState(false);
  const [rootPassword, setRootPassword] = useState("");
  const [elevating, setElevating] = useState(false);
  const handles = useRef(new Map<string, TerminalHandle>());
  const active = tabs.find((tab) => tab.id === activeId) || tabs[0];

  useEffect(() => {
    let cancelled = false;
    localApi.terminalIdentity()
      .then((value) => {
        if (cancelled) return;
        setIdentity(value);
        const first = createTab(1, value);
        setTabs([first]);
        setActiveId(first.id);
      })
      .catch((error) => !cancelled && setIdentityError(error instanceof Error ? error.message : "Unable to prepare the Linux terminal user"));
    return () => { cancelled = true; };
  }, []);

  const closeTab = (id: string) => {
    handles.current.delete(id);
    setTabs((current) => {
      if (current.length === 1) return current;
      const index = current.findIndex((tab) => tab.id === id);
      const remaining = current.filter((tab) => tab.id !== id);
      if (id === activeId) setActiveId(remaining[Math.max(0, index - 1)]?.id || remaining[0].id);
      return remaining;
    });
  };

  const setActiveMode = (mode: ShellMode, result: ReconnectResult) => {
    if (!active) return;
    setTabs((current) => current.map((tab) => tab.id === active.id ? {
      ...tab,
      mode,
      name: `${mode === "root" ? "root" : result.linuxUsername}-${tab.index}`,
    } : tab));
  };

  if (identityError) {
    return <Alert variant="destructive" className="m-4"><AlertDescription>{identityError}</AlertDescription></Alert>;
  }
  if (!identity || !active) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Preparing your Linux sudo account…</div>;
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", fullscreen && "fixed inset-0 z-50")}>
      {!fullscreen && active.mode === "root" && (
        <Alert variant="destructive" className="m-3 mb-0 rounded-md">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>This tab is running as root. Commands and interactive programs directly affect the entire VPS.</AlertDescription>
        </Alert>
      )}
      {!fullscreen && active.mode === "user" && (
        <Alert className="m-3 mb-0 rounded-md border-primary/30 bg-primary/5">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <AlertDescription>
            Signed in as Linux user <span className="font-mono font-medium">{identity.linuxUsername}</span>. This account belongs to the sudo group. Use “Switch to root” for an authenticated root shell.
          </AlertDescription>
        </Alert>
      )}

      <div className={cn("flex items-center gap-1 border-y border-border bg-surface/60 px-2 py-1.5", !fullscreen && "mt-3")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {tabs.map((tab) => {
            const status = statuses[tab.id] || "connecting";
            return (
              <button
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs",
                  tab.id === activeId ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status === "connected" && (tab.mode === "root" ? "bg-destructive" : "bg-primary"),
                  status === "connecting" && "animate-pulse bg-amber-400",
                  (status === "disconnected" || status === "error") && "bg-destructive",
                )} />
                {tab.name}
                {tabs.length > 1 && <X className="h-3 w-3 opacity-60 hover:opacity-100" onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }} />}
              </button>
            );
          })}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
            const tab = createTab(counter, identity);
            setCounter((value) => value + 1);
            setTabs((current) => [...current, tab]);
            setActiveId(tab.id);
          }}><Plus className="h-3.5 w-3.5" /></Button>
        </div>

        {active.mode === "user" ? (
          <Button size="sm" variant="outline" className="text-xs" onClick={() => setRootDialog(true)}>
            <KeyRound className="mr-1 h-3.5 w-3.5" />Switch to root
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="text-xs" onClick={async () => {
            try {
              const result = await handles.current.get(active.id)?.reconnect("user");
              if (result) setActiveMode("user", result);
              toast.success(`Returned to ${identity.linuxUsername}`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Unable to return to the user shell");
            }
          }}>
            <UserRound className="mr-1 h-3.5 w-3.5" />Return to user
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-xs" onClick={async () => {
          if (active.mode === "root") {
            setRootDialog(true);
            toast.info("Confirm your password again to restart a root shell");
            return;
          }
          try {
            await handles.current.get(active.id)?.reconnect("user");
            toast.success("Terminal restarted");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Restart failed");
          }
        }}><RotateCw className="mr-1 h-3.5 w-3.5" />Restart</Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={async () => {
          const copied = await handles.current.get(active.id)?.copySelection();
          if (copied) toast.success("Selection copied");
          else toast.info("Select terminal text first");
        }}><Copy className="mr-1 h-3.5 w-3.5" />Copy</Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => handles.current.get(active.id)?.clear()}><Trash2 className="mr-1 h-3.5 w-3.5" />Clear</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setFullscreen((value) => !value)} aria-label="Toggle fullscreen">
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#171719]">
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            ref={(handle) => { if (handle) handles.current.set(tab.id, handle); else handles.current.delete(tab.id); }}
            active={tab.id === activeId}
            cwd={tab.cwd}
            initialMode={tab.mode}
            onStatus={(status) => setStatuses((current) => current[tab.id] === status ? current : { ...current, [tab.id]: status })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>Interactive PTY · <span className="font-mono">/bin/bash --login</span> · application account <span className="font-mono">{auth.user?.username}</span></span>
        <span className="flex items-center gap-2 capitalize">
          <Badge variant={active.mode === "root" ? "destructive" : "outline"} className="h-5 font-mono text-[10px]">{active.mode === "root" ? "root" : identity.linuxUsername}</Badge>
          {statuses[active.id] || "connecting"}
        </span>
      </div>

      <Dialog open={rootDialog} onOpenChange={(open) => { setRootDialog(open); if (!open) setRootPassword(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />Switch this terminal to root</DialogTitle>
            <DialogDescription>
              Root bypasses normal Linux file permissions and can stop services, delete system files or make the VPS unbootable. Enter the password of the currently connected wFileManager account <span className="font-mono font-medium">{auth.user?.username}</span> to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="root-confirm-password">Current account password</Label>
            <Input
              id="root-confirm-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={rootPassword}
              onChange={(event) => setRootPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && rootPassword && !elevating) document.getElementById("confirm-root-switch")?.click();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRootDialog(false)}>Cancel</Button>
            <Button
              id="confirm-root-switch"
              variant="destructive"
              disabled={!rootPassword || elevating}
              onClick={async () => {
                setElevating(true);
                try {
                  const result = await handles.current.get(active.id)?.reconnect("root", rootPassword);
                  if (result) setActiveMode("root", result);
                  setRootDialog(false);
                  setRootPassword("");
                  toast.success("Root terminal opened");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Root confirmation failed");
                } finally {
                  setElevating(false);
                }
              }}
            >
              {elevating ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Verifying…</> : "Confirm and switch to root"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
