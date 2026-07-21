import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, FolderTree, UploadCloud, Trash2, TerminalSquare, Users, ShieldCheck, HardDrive, UserCircle2, BookOpen, Info, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { SERVER_INFO } from "@/lib/demo/data";
import { useAuth } from "@/lib/auth";

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; permission?: string; anyPermission?: string[] };

const NAV: { label: string; items: Item[] }[] = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/explorer", label: "File Explorer", icon: FolderTree, permission: "browse" },
      { to: "/uploads", label: "Uploads", icon: UploadCloud, permission: "upload" },
      { to: "/trash", label: "Trash", icon: Trash2, anyPermission: ["delete", "restore", "permanently_delete"] },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/terminal", label: "Terminal", icon: TerminalSquare, permission: "use_terminal" },
      { to: "/storage", label: "Storage", icon: HardDrive },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/users", label: "Users", icon: Users, permission: "manage_users" },
      { to: "/roles", label: "Roles & permissions", icon: ShieldCheck, permission: "manage_roles" },
    ],
  },
  {
    label: "Personal",
    items: [
      { to: "/notifications", label: "Notifications", icon: Bell },
      { to: "/account", label: "Account", icon: UserCircle2 },
      { to: "/docs", label: "Documentation", icon: BookOpen },
      { to: "/about", label: "About & updates", icon: Info },
    ],
  },
];

export function AppSidebar({ className }: { className?: string }) {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = (to: string) => to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
  const canSee = (item: Item) => {
    if (!item.permission && !item.anyPermission) return true;
    if (user?.isAdmin) return true;
    const permissions = user?.permissions || [];
    if (item.permission) return permissions.includes(item.permission);
    return item.anyPermission?.some((permission) => permissions.includes(permission)) || false;
  };

  return (
    <aside className={cn("flex h-full w-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:w-60", className)}>
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary"><FolderTree className="h-4 w-4" /></div>
        <div className="flex flex-col leading-tight"><span className="text-[10px] tracking-wide text-muted-foreground">From KmerHosting LLC</span><span className="text-sm font-semibold tracking-tight">wFileManager</span></div>
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{group.label}</div>
            <ul className="space-y-0.5">
              {group.items.filter(canSee).map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                return (
                  <li key={item.to}>
                    <Link to={item.to} className={cn("group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors", active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground")}>
                      <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" /><span>v{SERVER_INFO.wfmVersion}</span></div>
      </div>
    </aside>
  );
}
