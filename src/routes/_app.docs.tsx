import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Download,
  FolderCog,
  FolderTree,
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

type DocCategory = "Basics" | "Files" | "Transfers" | "Administration" | "Safety";
type NoteTone = "info" | "warning" | "danger";
type AppRoute = "/" | "/explorer" | "/uploads" | "/trash" | "/terminal" | "/users" | "/roles" | "/notifications" | "/account" | "/about";

type DocSection = {
  id: string;
  category: DocCategory;
  title: string;
  summary: string;
  icon: typeof BookOpen;
  route?: AppRoute;
  details: string[];
  notes?: { tone: NoteTone; title: string; body: string }[];
};

export const Route = createFileRoute("/_app/docs")({
  head: () => ({ meta: [{ title: "Documentation — wFileManager" }] }),
  component: Docs,
});

const SECTIONS: DocSection[] = [
  {
    id: "overview",
    category: "Basics",
    title: "Overview",
    summary: "Read the file-management status of the current installation at a glance.",
    icon: BookOpen,
    route: "/",
    details: [
      "The Overview page reports root-directory items, common readable and writable locations, Linux login users and trash content.",
      "It also displays the text-editor limit, upload request limit and protected pseudo-filesystems.",
      "The Overview intentionally focuses on file-management capabilities rather than general server resource monitoring.",
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
      "List view is the default. The entire row is selectable and can be double-clicked.",
      "Mosaic view is available from the view selector and is remembered in the browser.",
      "Hidden files can be displayed from the explorer toolbar.",
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
      "Mutating operations reject paths that traverse symbolic links into protected kernel-managed filesystems.",
      "Longer copy, move and delete operations expose progress and report failures without freezing the interface.",
    ],
    notes: [{ tone: "danger", title: "System impact", body: "Renaming, moving or editing a system file can prevent Linux services from starting. Confirm the absolute path before saving." }],
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
      "Role permissions determine whether wFileManager exposes an operation.",
      "Linux permissions still determine whether the operating system accepts the operation.",
      "Do not use 0777 as a general permission fix.",
    ],
  },
  {
    id: "uploads",
    category: "Transfers",
    title: "Uploads",
    summary: "Choose a destination, follow progress and cancel safely.",
    icon: UploadCloud,
    route: "/uploads",
    details: [
      "Select a destination with the directory browser, recent locations or common-path shortcuts.",
      "Completed uploads are committed atomically and never overwrite an existing file with the same name.",
      "A partial temporary file is removed when a transfer fails or is cancelled.",
      "The configured upload limit is displayed on Overview.",
    ],
  },
  {
    id: "downloads",
    category: "Transfers",
    title: "Downloads",
    summary: "Download regular server files with progress and cancellation.",
    icon: Download,
    route: "/explorer",
    details: [
      "Start a download from the item menu in File Explorer.",
      "Transferred bytes and percentage are displayed when the browser exposes the file size.",
      "Cancel aborts the request before the browser saves the completed file.",
      "Very large downloads may consume significant temporary browser memory.",
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
      "Delete in File Explorer moves the item into the private wFileManager trash.",
      "Each entry stores its original path, deletion time, owner and size.",
      "Restore refuses to overwrite an item already present at the original path.",
      "Permanent delete and Empty trash cannot be undone.",
    ],
  },
  {
    id: "terminal",
    category: "Administration",
    title: "Administrator terminal",
    summary: "Use a real PTY shell reserved for wFileManager administrators.",
    icon: TerminalSquare,
    route: "/terminal",
    details: [
      "The Terminal entry appears only for administrators and every terminal API request verifies administrator status.",
      "A dedicated Linux account is created only when an administrator opens the terminal.",
      "Ordinary application users are never provisioned as Linux users and never added to sudo.",
      "Switch to root requires verification of the current administrator password.",
      "Terminal tabs are independent PTY sessions and expire after inactivity.",
    ],
    notes: [{ tone: "danger", title: "Root shell", body: "A root terminal can modify or delete any server file. Commands are executed immediately and are not reversible by wFileManager." }],
  },
  {
    id: "users",
    category: "Administration",
    title: "Users",
    summary: "Create application users without creating Linux accounts.",
    icon: Users,
    route: "/users",
    details: [
      "Administrators can create users with a display name, username, optional email, password and role.",
      "Application accounts are separate from operating-system accounts.",
      "Creating, signing in or changing the password of an ordinary user does not create a Linux user or grant sudo.",
      "Deleting a user revokes sessions and removes private application data without deleting server files.",
    ],
  },
  {
    id: "roles",
    category: "Administration",
    title: "Roles and permissions",
    summary: "Control which file-management actions each user can perform.",
    icon: UserCog,
    route: "/roles",
    details: [
      "System roles provide ready-to-use permission sets and custom roles can be created.",
      "Permissions cover browsing, reading, uploading, downloading, editing, moving, deleting and administration.",
      "The Administrator role retains complete application access.",
      "Root terminal access is an administrator capability and is not granted by an ordinary role permission.",
    ],
  },
  {
    id: "notifications",
    category: "Basics",
    title: "Notifications",
    summary: "Track private file-operation and account events.",
    icon: Bell,
    route: "/notifications",
    details: [
      "Notifications are private to the user who generated them.",
      "Use the bell to view unread items or open the full notification center.",
      "Individual notifications can be deleted and all notifications can be cleared.",
    ],
  },
  {
    id: "account",
    category: "Basics",
    title: "Account and sessions",
    summary: "Update your profile, application password and active sessions.",
    icon: KeyRound,
    route: "/account",
    details: [
      "Update your display name, email address and timezone from Account.",
      "The wFileManager password is separate from Linux credentials.",
      "Changing it revokes other application sessions but does not change an operating-system password.",
      "Revoke a single session or sign out all devices when a device is no longer trusted.",
    ],
  },
  {
    id: "updates",
    category: "Basics",
    title: "Application updates",
    summary: "Inspect, install and roll back verified releases.",
    icon: RefreshCw,
    route: "/about",
    details: [
      "The About & updates page displays the installed and latest stable versions.",
      "Release archives are verified by SHA-256 and size before extraction.",
      "The updater builds a separate release, switches atomically and checks the application, database and persistent filesystem.",
      "A failed health check automatically restores the previous release.",
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
      "Writes through symbolic-link path components and writes to /proc, /sys, /dev and /run are blocked by default.",
    ],
    notes: [{ tone: "danger", title: "Elevated privileges", body: "wFileManager manages real server data. Incorrect administrator actions can cause permanent data loss or system compromise." }],
  },
  {
    id: "troubleshooting",
    category: "Safety",
    title: "Troubleshooting",
    summary: "Check the service, proxy and health endpoint when an operation fails.",
    icon: Info,
    details: [
      "Check the service with systemctl status wfilemanager and journalctl -u wfilemanager -n 100 --no-pager.",
      "Verify application health with curl -fsS http://127.0.0.1:1973/api/health.",
      "Validate the proxy with nginx -t and confirm that the service listens on 127.0.0.1:1973.",
      "Permission denied usually means the role lacks the action or Linux rejected access to the path.",
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
    const needle = query.trim().toLowerCase();
    return SECTIONS.filter((section) => (category === "All" || section.category === category) && (!needle || `${section.title} ${section.summary} ${section.details.join(" ")}`.toLowerCase().includes(needle)));
  }, [category, query]);

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-6"><h1 className="text-xl font-semibold tracking-tight">Documentation</h1><p className="text-sm text-muted-foreground">Operational guidance for this wFileManager installation.</p></div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documentation…" className="pl-9" /></div>
        {CATEGORIES.map((item) => <Button key={item} size="sm" variant={category === item ? "default" : "outline"} onClick={() => setCategory(item)}>{item}</Button>)}
      </div>
      <Card className="p-4">
        {filtered.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No documentation section matches this search.</div> : (
          <Accordion type="multiple" className="w-full">
            {filtered.map((section) => {
              const Icon = section.icon;
              return (
                <AccordionItem key={section.id} value={section.id}>
                  <AccordionTrigger className="hover:no-underline"><div className="flex items-center gap-3 text-left"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" /><div><div className="flex items-center gap-2"><span className="font-medium">{section.title}</span><Badge variant="outline" className="text-[10px]">{section.category}</Badge></div><p className="mt-0.5 text-xs font-normal text-muted-foreground">{section.summary}</p></div></div></AccordionTrigger>
                  <AccordionContent className="space-y-3 pl-7">
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">{section.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
                    {section.notes?.map((note) => <Alert key={note.title} className={noteClasses(note.tone)}><AlertTitle>{note.title}</AlertTitle><AlertDescription>{note.body}</AlertDescription></Alert>)}
                    {section.route && <Button asChild size="sm" variant="outline"><Link to={section.route}>Open {section.title}</Link></Button>}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </Card>
    </div>
  );
}
