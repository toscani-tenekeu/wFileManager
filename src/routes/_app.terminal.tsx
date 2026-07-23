import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, KeyRound, Loader2, Maximize2, Minimize2, RotateCw, ShieldAlert, Trash2 } from "lucide-react";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { localApi } from "@/lib/local-api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/terminal")({
  head: () => ({ meta: [{ title: "Terminal — wFileManager" }] }),
  component: TerminalPage,
});

type ConnectionStatus = "locked" | "connecting" | "connected" | "disconnected" | "error";
type UnlockRequest = { id: number; password: string };

function TerminalPage() {
  const { user } = useAuth();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitRef = useRef<XTermFitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const pollingRef = useRef<number | null>(null);
  const writeQueueRef = useRef(Promise.resolve());
  const [status, setStatus] = useState<ConnectionStatus>("locked");
  const [password, setPassword] = useState("");
  const [unlockRequest, setUnlockRequest] = useState<UnlockRequest | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!user?.isAdmin || !unlockRequest || !hostRef.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;

    const stopPolling = () => {
      if (pollingRef.current != null) window.clearTimeout(pollingRef.current);
      pollingRef.current = null;
    };

    const initialize = async () => {
      setStatus("connecting");
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;

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

      const poll = async () => {
        const sessionId = sessionIdRef.current;
        if (disposed || !sessionId) return;
        try {
          const output = await localApi.ptyOutput(sessionId, cursorRef.current);
          cursorRef.current = output.cursor;
          if (output.data) terminal.write(output.data);
          if (output.exited) {
            setStatus("disconnected");
            sessionIdRef.current = null;
            return;
          }
          pollingRef.current = window.setTimeout(poll, 80);
        } catch (error) {
          terminal.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Terminal connection failed"}\x1b[0m`);
          setStatus("error");
          sessionIdRef.current = null;
        }
      };

      try {
        terminal.writeln("\x1b[90mVerifying the administrator and opening a root shell…\x1b[0m");
        const result = await localApi.ptyCreate("/root", terminal.cols, terminal.rows, "root", unlockRequest.password);
        if (disposed) {
          await localApi.ptyClose(result.sessionId).catch(() => undefined);
          return;
        }
        terminal.reset();
        sessionIdRef.current = result.sessionId;
        cursorRef.current = 0;
        setPassword("");
        setStatus("connected");
        terminal.focus();
        void poll();
      } catch (error) {
        terminal.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Unable to open terminal"}\x1b[0m`);
        setStatus("error");
        setPassword("");
      }

      dataDisposable = terminal.onData((data) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        writeQueueRef.current = writeQueueRef.current
          .then(() => localApi.ptyInput(sessionId, data))
          .then(() => undefined)
          .catch((error) => terminal.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : "Input failed"}\x1b[0m`));
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
    };

    void initialize();
    return () => {
      disposed = true;
      stopPolling();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) void localApi.ptyClose(sessionId).catch(() => undefined);
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [unlockRequest, user?.isAdmin]);

  useEffect(() => {
    if (fullscreen) requestAnimationFrame(() => fitRef.current?.fit());
  }, [fullscreen]);

  if (!user?.isAdmin) {
    return <Alert variant="destructive" className="m-4"><ShieldAlert className="h-4 w-4" /><AlertDescription>The terminal is restricted to administrators.</AlertDescription></Alert>;
  }

  if (!unlockRequest) {
    return (
      <div className="mx-auto grid w-full max-w-xl flex-1 place-items-center p-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Unlock administrator terminal</CardTitle>
            <CardDescription>The terminal opens a root shell. Enter the password of the currently signed-in wFileManager administrator. The password is verified and is not stored by the terminal.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(event) => {
              event.preventDefault();
              if (!password) return;
              setUnlockRequest({ id: Date.now(), password });
            }}>
              <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertDescription>Root commands directly affect the entire server and cannot be undone by wFileManager.</AlertDescription></Alert>
              <div className="grid gap-1.5"><Label htmlFor="terminal-password">Current administrator password</Label><Input id="terminal-password" type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
              <Button type="submit" disabled={!password}><KeyRound className="mr-2 h-4 w-4" /> Verify and open terminal</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", fullscreen && "fixed inset-0 z-50")}>
      {!fullscreen && (
        <Alert variant="destructive" className="m-3 mb-0 rounded-md">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>This terminal is running as root and is available only to administrators.</AlertDescription>
        </Alert>
      )}

      <div className={cn("flex items-center gap-2 border-y border-border bg-surface/60 px-2 py-1.5", !fullscreen && "mt-3")}>
        <Badge variant="destructive" className="font-mono">root</Badge>
        <span className="min-w-0 flex-1 text-xs capitalize text-muted-foreground">{status}</span>
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => {
          const current = sessionIdRef.current;
          sessionIdRef.current = null;
          if (current) void localApi.ptyClose(current).catch(() => undefined);
          setUnlockRequest(null);
          setStatus("locked");
          setPassword("");
        }}><RotateCw className="mr-1 h-3.5 w-3.5" /> Re-authenticate</Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={async () => {
          const selection = terminalRef.current?.getSelection() || "";
          if (!selection) return void toast.info("Select terminal text first");
          await navigator.clipboard.writeText(selection);
          toast.success("Selection copied");
        }}><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => terminalRef.current?.clear()}><Trash2 className="mr-1 h-3.5 w-3.5" /> Clear</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setFullscreen((value) => !value)} aria-label="Toggle fullscreen">
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#171719]">
        {status === "connecting" && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#171719]/70 text-sm text-white"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Opening root shell…</div>}
        <div ref={hostRef} className="h-full w-full bg-[#171719] p-2" />
      </div>

      <div className="flex items-center justify-between border-t border-border bg-surface/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>Interactive PTY · <span className="font-mono">/bin/bash --login</span> · application administrator <span className="font-mono">{user.username}</span></span>
        <span>Maximum sessions are enforced by the server</span>
      </div>
    </div>
  );
}
