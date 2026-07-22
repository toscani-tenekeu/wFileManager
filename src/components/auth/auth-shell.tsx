import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function AuthShell({
  title,
  desc,
  children,
  footer,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="hidden flex-col justify-between border-r border-border bg-surface p-10 lg:flex">
        <Link to="/" className="flex items-center">
<div className="text-sm font-semibold">wFileManager</div>
        </Link>
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-tight">
            A modern file manager for Linux servers.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Browse, edit, upload, share and audit files from a single administration panel. Built
            for Ubuntu 24.04 LTS.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} KmerHosting LLC. All rights reserved.</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <Link to="/" className="inline-flex items-center">
<span className="text-sm font-semibold">wFileManager</span>
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
          <p className="mt-10 text-xs text-muted-foreground lg:hidden">© {new Date().getFullYear()} KmerHosting LLC. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

export function useDemoAction() {
  const [loading, setLoading] = useState(false);
  return {
    loading,
    run: async (fn: () => Promise<void> | void) => {
      setLoading(true);
      await new Promise((r) => setTimeout(r, 600));
      await fn();
      setLoading(false);
    },
  };
}
