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
      "Overview reports the number of items in the root directory, accessible common locations, Linux login users and trash content.",
      "It also displays the text-editor limit, upload request limit and protected pseudo-filesystems.",
      "The page intentionally focuses on file-management capabilities rather than general server monitoring.",
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
      "List view is the default and the entire row can be selected or double-clicked.",
      "Mosaic view is available from the view selector and the preference is remembered in the browser.",
      "Hidden files can be displayed from the explorer toolbar.",
    ],
    notes: [{ tone: "warning", title: "Sensitive locations", body: "Directories such as /etc, /root, /boot and /var/lib may contain files required by Linux or installed services." }],
  },
  {
    id: "operations",
    category: "Files",
    title: "File operations",
    summary: "Create, inspect, edit, rename, copy, move and delete items.",
    icon: FolderCog,
    route: "/explorer",
    details: [
      "Use New file and New folder to create items in the current directory.",
      "The item menu provides preview, editing, download, rename, copy, move, permissions, properties and delete actions.",
      "Mutating operations reject paths that traverse symbolic links into protected kernel-managed locations.",
      "Long copy, move and delete operations expose progress and return explicit failures.",
    ],
    notes: [{ tone: "danger", title: "System impact", body: "Editing or moving a system file can prevent services from starting. Verify the absolute path before confirming." }],
  },
  {
    id: "permissions",
    category: "Files",
    title: "Linux permissions",
    summary: "Inspect and change standard numeric file modes.",
    icon: ShieldCheck,
    route: "/explorer",
    details: [
      "Permissions are displayed as octal values such as 0644 or 0755.",
      "Application roles determine whether wFileManager exposes an operation.",
      "Linux permissions still determine whether the operating system accepts it.",
      "Avoid using 0777 as a general permission fix.",
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
      "Uploads are streamed into a temporary file and committed only after the transfer completes.",
      "An existing destination is never overwritten; the server returns a conflict instead.",
      "Partial temporary files are removed after cancellation or failure.",
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
      "Start a download from an item menu in File Explorer.",
      "Transferred bytes and percentage are displayed when the browser exposes the file size.",
      "Cancel aborts the request before the completed file is saved.",
      "Very large downloads may consume temporary browser memory.",
    ],
  },
  {
    id: "archives",
    category: "Files",
    title: "Archives",
    summary: "Create and extract ZIP or TAR.GZ archives with safety limits.",
    icon: FolderCog,
    route: "/explorer",
    details: [
      "Absolute paths, parent traversal, symbolic links, hard links and device entries are rejected during extraction.",
      "Entry count, expanded size, compression ratio and destination free space are checked before extraction.",
      "Conflict handling can stop, rename top-level items or replace explicitly selected destinations.",
      "Archive creation skips symbolic links and unsupported special entries.",
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
      "Delete in File Explorer moves an item into the current user's private wFileManager trash.",
      "Each entry stores its original path, deletion time, actor and measured size.",
      "Restore refuses to overwrite an existing item at the original path.",
      "Permanent delete and Empty trash cannot be undone.",
    ],
  },
  {
    id: "terminal",
    category: "Administration",
    title: "Administrator terminal",
    summary: "Use a root PTY shell reserved for administrators.",
    icon: TerminalSquare,
    route: "/terminal",
    details: [
      "Terminal is shown under Administration and is visible only to administrators.",
      "Every terminal API request verifies administrator status.",
      "Opening a session requires the current wFileManager administrator password again.",
      "The shell runs directly as root; wFileManager does not create a dedicated Linux user and does not add application users to sudo.",
      "The server limits concurrent sessions, terminal input, retained output and idle duration.",
    ],
    notes: [{ tone: "danger", title: "Root shell", body: "Root commands affect the entire server immediately and are not reversible by wFileManager." }],
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
      "Application accounts remain separate from operating-system accounts.",
      "Signing in or changing an application password never creates a Linux user and never grants sudo.",
      "Deleting a user revokes sessions and removes private application records without deleting server files.",
    ],
  },
  {
    id: "roles",
    category: "Administration",
    title: "Roles and permissions",
    summary: "Control which file-management actions each user may perform.",
    icon: UserCog,
    route: "/roles",
    details: [
      "System roles provide ready-to-use permission sets and custom roles can be created.",
      "Permissions cover browsing, reading, uploading, downloading, editing, moving, deleting and administration.",
      "The Administrator role retains complete application access.",
      "Root terminal access is an administrator capability and cannot be granted through an ordinary role permission.",
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
      "Changing it revokes other application sessions but does not modify an operating-system password.",
      "Revoke a single session or sign out all devices when a device is no longer trusted.",
    ],
  },
  {
    id: "supabase-recovery",
    category: "Administration",
    title: "Managed Supabase recovery",
    summary: "Recover or delete application records after a VPS reinstall or loss.",
    icon: KeyRound,
    details: [
      "Managed Supabase stores application accounts, roles, sessions, notifications and settings; it does not store or restore Linux server files.",
      "The installer writes a root-only Recovery Kit to /root/wfilemanager-recovery-kit.txt. Copy it outside the VPS.",
      "The kit contains the instance key, recovery key and domain. The raw recovery key is not stored in Supabase.",
      "A signed server heartbeat runs every 12 hours. Inactivity means no valid heartbeat or authenticated API activity, not a lack of human logins.",
      "After 30 days without activity, the instance is frozen, sessions are revoked, normal login is blocked and the managed data remains intact.",
      "A valid heartbeat from the original installation or recovery on a replacement server reactivates the instance.",
      "Recovery rotates the key and revokes all previous sessions, so old Recovery Kit copies must be replaced.",
      "After 90 days from the last valid activity, the managed Supabase records are permanently deleted. No inactivity warning is sent.",
      "Run sudo wfilemanager-recovery-kit show or export to inspect or save the current kit.",
    ],
    notes: [{ tone: "danger", title: "Keep the kit outside the VPS", body: "Without the Recovery Kit, a lost server cannot prove ownership of the managed instance, recover it or request remote deletion." }],
  },
  {
    id: "updates",
    category: "Basics",
    title: "Application updates",
    summary: "Inspect, install and roll back verified releases.",
    icon: RefreshCw,
    route: "/about",
    details: [
      "About & updates displays the installed and latest stable versions.",
      "Release archives are verified by SHA-256, byte size, paths and entry types before extraction.",
      "The updater tests and builds a separate release before switching the current symlink.",
      "Application, database and persistent-filesystem checks run after restart; an unhealthy release is rolled back automatically.",
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
      "Keep independent backups of application data, databases and configuration files.",
      "Do not expose the internal Node port; access the application through HTTPS and Nginx.",
      "Writes through symbolic-link path components and writes to /proc, /sys, /dev and /run are blocked by default.",
    ],
    notes: [{ tone: "danger", title: "Elevated privileges", body: "wFileManager manages real server files. Incorrect administrator actions can cause permanent data loss or system compromise." }],
  },
  {
    id: "troubleshooting",
    category: "Safety",
    title: "Troubleshooting",
    summary: "Check the service, proxy and health endpoint when an operation fails.",
    icon: Info,
    details: [
      "Inspect the wfilemanager.service status and its system journal.",
      "The local /api/health endpoint checks application metadata, the selected database backend and persistent filesystem access.",
      "Validate the Nginx configuration and confirm that the application listens only on 127.0.0.1:1973.",
      "For managed Supabase, inspect wfilemanager-heartbeat.timer and wfilemanager-heartbeat.service when the instance stops reporting activity.",
      "Permission denied usually means the role lacks the action or Linux rejected access to the selected path.",
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
    return SECTIONS.filter((section) =>
      (category === "All" || section.category === category)
      && (!needle || `${section.title} ${section.summary} ${section.details.join(" ")}`.toLowerCase().includes(needle)),
    );
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
