import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Download,
  FolderCog,
  FolderTree,
  HardDrive,
  Info,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  UploadCloud,
  UserCog,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const Route = createFileRoute("/_app/docs")({
  head: () => ({ meta: [{ title: "Documentation — wFileManager" }] }),
  component: Docs,
});

type DocCategory = "Basics" | "Files" | "Transfers" | "Administration" | "Safety";
type NoteTone = "info" | "warning" | "danger";

type DocSection = {
  id: string;
  category: DocCategory;
  title: string;
  summary: string;
  icon: typeof BookOpen;
  route?: "/" | "/explorer" | "/uploads" | "/trash" | "/terminal" | "/storage" | "/users" | "/roles" | "/notifications" | "/account" | "/about";
  details: string[];
  notes?: { tone: NoteTone; title: string; body: string }[];
};

const SECTIONS: DocSection[] = [
  {
    id: "overview",
    category: "Basics",
    title: "Overview",
    summary: "Read the file-management status of the current server at a glance.",
    icon: BookOpen,
    route: "/",
    details: [
      "The Overview page summarizes the root directory, storage usage, memory, trash content and recent file activity.",
      "Values come from the Linux host running wFileManager. Use Refresh when you need an immediate update.",
      "The green strip at the top reports the number of distinct active users seen during the last two minutes.",
    ],
  },
  {
    id: "explorer",
    category: "Files",
    title: "File Explorer",
    summary: "Navigate the real Linux filesystem using list or mosaic view.",
    icon: FolderTree,
    route: "/explorer",
    details: [
      "Use the path field, breadcrumbs, Back, Forward, Parent and Home controls to move through the filesystem.",
      "List view is the default. The entire row is selectable and can be double-clicked; you do not need to target the file icon.",
      "Mosaic view is available from the view selector. The selected layout is remembered in the browser.",
      "Hidden files can be displayed from the explorer toolbar. Files beginning with a dot are hidden by default.",
    ],
    notes: [{ tone: "warning", title: "Sensitive locations", body: "Directories such as /etc, /root, /boot and /var/lib may contain files required by the operating system or installed services." }],
  },
  {
    id: "file-operations",
    category: "Files",
    title: "File operations",
    summary: "Create, inspect, edit, rename, copy, move and delete items.",
    icon: FolderCog,
    route: "/explorer",
    details: [
      "Use New file and New folder to create items in the current directory.",
      "The item menu provides View/Edit, Download, Rename, Copy, Move, Permissions, Properties and Delete.",
      "Properties shows the absolute path, type, MIME type, size, owner IDs, permissions and timestamps.",
      "Text editing is limited to files that can be safely loaded by the configured maximum editor size.",
      "Copy, move and other longer operations display progress and can report failures without freezing the interface.",
    ],
    notes: [{ tone: "danger", title: "System impact", body: "Renaming, moving or editing a system file can prevent Linux services from starting. Confirm the target path before saving." }],
  },
  {
    id: "permissions",
    category: "Files",
    title: "Linux permissions",
    summary: "Inspect and change standard numeric file modes.",
    icon: ShieldCheck,
    route: "/explorer",
    details: [
      "Permissions are displayed as an octal mode such as 0644 or 0755.",
      "Read, write and execute permissions apply separately to the owner, group and other users.",
      "Changing a mode affects the real item on the server immediately.",
      "Role permissions in wFileManager control whether the action is available; Linux permissions still determine whether the operating system accepts it.",
    ],
    notes: [{ tone: "warning", title: "Avoid overly broad modes", body: "Do not use 0777 as a general fix. Grant only the access required by the service or user." }],
  },
  {
    id: "uploads",
    category: "Transfers",
    title: "Uploads",
    summary: "Choose a destination visually, follow progress and cancel safely.",
    icon: UploadCloud,
    route: "/uploads",
    details: [
      "Select a destination with the directory browser, recent locations or common-path shortcuts instead of typing the full path.",
      "Choose one or more local files or drag them into the upload area.",
      "The progress panel shows the active filename, transferred bytes and percentage.",
      "Cancel stops the current transfer. A partial .part file is removed when cancellation succeeds.",
      "Completed uploads are written to the selected Linux directory and generate a private notification for the current user.",
    ],
  },
  {
    id: "downloads",
    category: "Transfers",
    title: "Downloads",
    summary: "Download server files with progress and cancellation.",
    icon: Download,
    route: "/explorer",
    details: [
      "Start a download from the item menu in File Explorer.",
      "wFileManager streams the file and displays transferred bytes and percentage when the browser exposes the file size.",
      "Cancel aborts the request before the browser saves the completed file.",
      "Large downloads may use significant bandwidth and temporary browser memory depending on browser behavior.",
    ],
  },
  {
    id: "trash",
    category: "Files",
    title: "Trash",
    summary: "Restore deleted items or remove them permanently.",
    icon: Trash2,
    route: "/trash",
    details: [
      "Delete in File Explorer moves the item into the private wFileManager trash instead of removing it immediately.",
      "Each trash entry stores its original path, deletion time, owner and size.",
      "Restore recreates missing parent directories but refuses to overwrite an item already present at the original path.",
      "Permanent delete and Empty trash cannot be undone.",
      "Trash data is stored under /var/lib/wfilemanager/trash and is isolated by wFileManager user.",
    ],
  },
  {
    id: "terminal",
    category: "Administration",
    title: "Interactive terminal",
    summary: "Use a real PTY shell with a dedicated sudo-capable Linux account.",
    icon: TerminalSquare,
    route: "/terminal",
    details: [
      "Every wFileManager account receives a dedicated Linux user whose name begins with wfm_.",
      "The default shell runs as that Linux user and supports interactive programs, keyboard shortcuts and terminal resizing.",
      "The user belongs to the sudo group. Standard sudo commands require the account password.",
      "Switch to root requires a warning confirmation and verification of the currently connected wFileManager password.",
      "Terminal tabs are independent PTY sessions. Close sessions that are no longer needed.",
    ],
    notes: [{ tone: "danger", title: "Root shell", body: "A root terminal can modify or delete any server file. Commands are executed immediately and are not reversible by wFileManager." }],
  },
  {
    id: "storage",
    category: "Administration",
    title: "Storage",
    summary: "Inspect unique storage volumes, capacity and inode usage.",
    icon: HardDrive,
    route: "/storage",
    details: [
      "The summary uses the primary root volume instead of adding Docker, LXD, bind, tmpfs and duplicate mount entries.",
      "Primary capacity is the total size of the filesystem mounted at /. Available storage is the space currently available on that same volume.",
      "Each volume shows disk usage, inode usage, mount options, filesystem type and read-only state.",
      "Open jumps directly to the mount point in File Explorer.",
    ],
    notes: [{ tone: "info", title: "Capacity units", body: "The operating system and interface may display binary-sized storage values slightly below the marketed disk capacity." }],
  },
  {
    id: "users",
    category: "Administration",
    title: "Users",
    summary: "Create and remove application users and their Linux accounts.",
    icon: Users,
    route: "/users",
    details: [
      "Administrators can create users with a display name, username, email, password and role.",
      "A corresponding sudo-capable Linux account is provisioned for terminal access.",
      "Deleting a user revokes sessions, removes private notifications and deletes the managed Linux account and home directory.",
      "The current administrator cannot delete their own account, and the final active administrator is protected.",
    ],
  },
  {
    id: "roles",
    category: "Administration",
    title: "Roles and permissions",
    summary: "Control which application actions each user can perform.",
    icon: UserCog,
    route: "/roles",
    details: [
      "System roles provide ready-to-use permission sets. Custom roles can be created and edited.",
      "Permissions cover browsing, reading, uploading, downloading, editing, moving, deleting, terminal access and administration.",
      "The Administrator role remains locked with complete access.",
      "A custom role cannot be deleted while users are assigned to it.",
      "Current permissions are checked by the local API before Linux operations are executed.",
    ],
    notes: [{ tone: "info", title: "Current scope", body: "Fine-grained path restrictions are not yet enforced. A granted action currently applies wherever Linux permissions allow it." }],
  },
  {
    id: "notifications",
    category: "Basics",
    title: "Notifications",
    summary: "Track private file-operation and account events.",
    icon: Bell,
    route: "/notifications",
    details: [
      "Notifications are private to the user who generated them and synchronize across that user’s devices.",
      "Use the bell to view unread items, mark them read or open the full notification center.",
      "Individual notifications can be deleted, and all notifications can be cleared at once.",
      "Notifications older than seven days are automatically removed during synchronization.",
    ],
  },
  {
    id: "account",
    category: "Basics",
    title: "Account and sessions",
    summary: "Update profile details, password and active sessions.",
    icon: KeyRound,
    route: "/account",
    details: [
      "Update your display name, email address and timezone from Account.",
      "Changing the password also synchronizes the password of the managed Linux terminal account.",
      "Active sessions show creation, last-seen time, expiration, IP address and browser user agent.",
      "Revoke a single session or sign out all sessions when a device is no longer trusted.",
    ],
  },
  {
    id: "updates",
    category: "Basics",
    title: "Application updates",
    summary: "Inspect the installed version and update source from About.",
    icon: RefreshCw,
    route: "/about",
    details: [
      "The About & updates page displays the installed version and checks a configured update manifest when available.",
      "Updating the application replaces program files but should preserve the environment, Nginx configuration, SSL certificate and Supabase data.",
      "Review release notes and keep a server backup before applying changes to a production installation.",
    ],
  },
  {
    id: "safety",
    category: "Safety",
    title: "Safe administration",
    summary: "Reduce the risk of data loss and service interruption.",
    icon: AlertTriangle,
    details: [
      "Confirm absolute paths before copy, move, delete, chmod or terminal operations.",
      "Keep backups of application data, databases and configuration files outside the managed server.",
      "Do not expose the internal Node port directly; access wFileManager through HTTPS and Nginx.",
      "Review sudo access regularly and delete unused users and sessions.",
      "Avoid editing pseudo-filesystems such as /proc, /sys, /dev and /run. Writes to these locations are restricted by default.",
    ],
    notes: [{ tone: "danger", title: "Elevated privileges", body: "wFileManager manages real server data and may use sudo or root privileges. Incorrect actions can cause permanent data loss or system compromise." }],
  },
  {
    id: "troubleshooting",
    category: "Safety",
    title: "Troubleshooting",
    summary: "Check the service, proxy and permissions when an operation fails.",
    icon: Info,
    details: [
      "Check the application with systemctl status wfilemanager and journalctl -u wfilemanager -n 100 --no-pager.",
      "Validate the proxy with nginx -t and confirm that the service listens on 127.0.0.1:1973.",
      "Permission denied usually means the selected role lacks the action or Linux rejected access to the path.",
      "A storage-full or inode-full filesystem prevents uploads, edits and temporary files even when the application itself remains online.",
      "After a deployment, sign out and sign in again if role or account data appears stale.",
    ],
  },
];

const CATEGORIES: Array<"All" | DocCategory> = ["All", "Basics", "Files", "Transfers", "Administration", "Safety"];

function noteClasses(tone: NoteTone) {
  if (tone === "danger") return "border-destructive/35 bg-destructive/10 text-destructive";
  if (tone === "warning") return "border-warning/35 bg-warning/10 text-foreground";
  return "border-primary/30 bg-primary/10 text-foreground";
}

function Docs() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return SECTIONS.filter((section) => {
      if (category !== "All" && section.category !== category) return false;
      if (!normalized) return true;
      return [section.title, section.summary, section.category, ...section.details, ...(section.notes || []).flatMap((note) => [note.title, note.body])]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [category, query]);

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Documentation</h1>
            <p className="text-sm text-muted-foreground">Operational guidance for the current wFileManager features.</p>
          </div>
        </div>
        <Badge variant="outline" className="h-6 text-[11px]">{SECTIONS.length} topics</Badge>
      </div>

      <Alert className="mb-4 border-warning/35 bg-warning/10 py-2.5">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-xs">Manage the server carefully</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          File, permission and terminal actions affect the real Linux host. Verify paths and keep current backups before privileged operations.
        </AlertDescription>
      </Alert>

      <div className="mb-4 flex flex-col gap-2 rounded-md border border-border bg-card p-2.5 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documentation…" className="h-8 pl-8 text-xs" />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((item) => (
            <Button key={item} size="sm" variant={category === item ? "secondary" : "ghost"} className="h-7 px-2.5 text-[11px]" onClick={() => setCategory(item)}>
              {item}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No documentation topic matches this search.</Card>
      ) : (
        <Accordion type="multiple" className="grid items-start gap-2 lg:grid-cols-2">
          {filtered.map((section) => {
            const Icon = section.icon;
            return (
              <AccordionItem key={section.id} value={section.id} className="rounded-md border border-border bg-card px-0">
                <AccordionTrigger className="gap-3 px-3 py-2.5 text-left hover:no-underline [&>svg]:h-3.5 [&>svg]:w-3.5">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{section.title}</span>
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal">{section.category}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] font-normal leading-4 text-muted-foreground">{section.summary}</p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-3">
                  <div className="border-t border-border pt-2.5">
                    <ul className="space-y-1.5 pl-4 text-xs leading-5 text-muted-foreground">
                      {section.details.map((detail) => <li key={detail} className="list-disc pl-0.5">{detail}</li>)}
                    </ul>
                    {section.notes?.map((note) => (
                      <div key={`${section.id}-${note.title}`} className={`mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-4 ${noteClasses(note.tone)}`}>
                        <div className="font-medium">{note.title}</div>
                        <div className="mt-0.5 text-muted-foreground">{note.body}</div>
                      </div>
                    ))}
                    {section.route && (
                      <Button asChild size="sm" variant="outline" className="mt-2.5 h-7 text-[11px]">
                        <Link to={section.route}>Open this area</Link>
                      </Button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
