import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Menu, Moon, Sun, Monitor, LogOut, UserCircle2, Check, CircleCheck, CircleAlert, CircleX, Info, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import { AppSidebar } from "./sidebar";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { localApi } from "@/lib/local-api";
import { wfilemanagerApi } from "@/lib/wfilemanager-api";
import { useNotifications } from "@/lib/notifications";
import { formatRelative } from "@/lib/format";

export function Topbar() {
  const { theme, setTheme } = useTheme();
  const auth = useAuth();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifications = useNotifications();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur">
      <Sheet>
        <SheetTrigger asChild>
          <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0"><AppSidebar /></SheetContent>
      </Sheet>

      <Link to="/" className="flex items-center gap-2 lg:hidden"><span className="text-sm font-semibold">wFileManager</span></Link>

      <div className="ml-auto flex items-center gap-1.5">
        <Popover open={notifOpen} onOpenChange={(open) => { setNotifOpen(open); if (open) void notifications.refresh(); }}>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Notifications" className="relative">
              <Bell className="h-4 w-4" />
              {notifications.unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0" align="end">
            <div className="flex items-center justify-between border-b border-border p-3">
              <div><div className="text-sm font-semibold">Notifications</div><div className="text-[11px] text-muted-foreground">Automatically removed after 7 days</div></div>
              {notifications.unreadCount > 0 && <button onClick={() => void notifications.markAllRead()} className="text-xs text-muted-foreground hover:text-foreground">Mark all read</button>}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.loading && notifications.notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading notifications…</div>
              ) : notifications.notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No notifications.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.notifications.slice(0, 6).map((item) => {
                    const ToneIcon = item.tone === "success" ? CircleCheck : item.tone === "warning" ? CircleAlert : item.tone === "error" ? CircleX : Info;
                    return (
                      <li key={item.id} className={!item.readAt ? "bg-primary/[0.04]" : undefined}>
                        <div className="flex items-start gap-3 p-3">
                          <ToneIcon className={item.tone === "error" ? "mt-0.5 h-4 w-4 shrink-0 text-destructive" : item.tone === "warning" ? "mt-0.5 h-4 w-4 shrink-0 text-warning" : "mt-0.5 h-4 w-4 shrink-0 text-primary"} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2"><p className="flex-1 text-sm font-medium">{item.title}</p>{!item.readAt && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />}</div>
                            {item.message && <p className="mt-0.5 text-xs text-muted-foreground">{item.message}</p>}
                            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span>{formatRelative(item.createdAt)}</span>
                              {!item.readAt && <button onClick={() => void notifications.markRead(item.id)} className="hover:text-foreground">Mark read</button>}
                              {item.link && <a href={item.link} onClick={() => void notifications.markRead(item.id)} className="hover:text-foreground">Open</a>}
                            </div>
                          </div>
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Delete notification" onClick={() => void notifications.remove(item.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border p-2">
              <Link to="/notifications" onClick={() => setNotifOpen(false)} className="px-2 text-xs text-muted-foreground hover:text-foreground">Open notification center</Link>
              {notifications.notifications.length > 0 && <button onClick={() => void notifications.clearAll()} className="px-2 text-xs text-muted-foreground hover:text-destructive">Clear all</button>}
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Theme">{theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Theme</DropdownMenuLabel><DropdownMenuSeparator />
            {(["light", "dark", "system"] as const).map((item) => (
              <DropdownMenuItem key={item} onClick={() => setTheme(item)}>
                {item === "light" ? <Sun className="mr-2 h-4 w-4" /> : item === "dark" ? <Moon className="mr-2 h-4 w-4" /> : <Monitor className="mr-2 h-4 w-4" />}
                <span className="capitalize">{item}</span>{theme === item && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-left hover:bg-muted/60" aria-label="Account menu">
              <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary">{(auth.user?.displayName || auth.user?.username || "A").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
              <div className="hidden md:flex flex-col leading-tight"><span className="text-xs font-medium">{auth.user?.displayName || auth.user?.username}</span><span className="text-[10px] text-muted-foreground">{auth.user?.isAdmin ? "Administrator" : auth.user?.roleName || "User"}</span></div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel><div className="flex flex-col"><span>{auth.user?.displayName || auth.user?.username}</span><span className="text-xs font-normal text-muted-foreground">{auth.user?.email || auth.user?.username}</span></div></DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/account"><UserCircle2 className="mr-2 h-4 w-4" /> Account</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={async () => { await auth.logout(); toast.success("Signed out"); navigate({ to: "/login" }); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function ConnectionBanner() {
  const [state, setState] = useState<"checking" | "connected" | "failed">("checking");
  const [onlineUsers, setOnlineUsers] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await localApi.system();
        const presence = await wfilemanagerApi.onlineUsers();
        if (!active) return;
        setOnlineUsers(presence.onlineUsers);
        setState("connected");
      } catch {
        if (!active) return;
        setState("failed");
        setOnlineUsers(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const label = state === "checking"
    ? "Checking active users…"
    : state === "connected"
      ? `${onlineUsers ?? 0} ${onlineUsers === 1 ? "user" : "users"} online`
      : "Unable to read the current online-user count.";

  return (
    <div className={state === "failed" ? "flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-1.5 text-[11px] text-destructive" : "flex items-center gap-2 border-b border-border bg-primary/10 px-4 py-1.5 text-[11px] text-foreground"}>
      <span className={state === "checking" ? "h-1.5 w-1.5 animate-pulse rounded-full bg-warning" : state === "connected" ? "h-1.5 w-1.5 rounded-full bg-primary" : "h-1.5 w-1.5 rounded-full bg-destructive"} />
      <span>{label}</span>
    </div>
  );
}
