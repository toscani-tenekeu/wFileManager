export interface DemoUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  status: "active" | "disabled" | "invited";
  lastActive: string;
  timezone: string;
  language: string;
  twoFactor: boolean;
  expiresAt?: string;
  notes?: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: "u_admin",
    name: "Alex Admin",
    username: "admin",
    email: "admin@kmerhosting.com",
    role: "Administrator",
    status: "active",
    lastActive: new Date().toISOString(),
    timezone: "Africa/Douala",
    language: "en",
    twoFactor: true,
  },
  {
    id: "u_dev",
    name: "Dana Developer",
    username: "dana",
    email: "dana@kmerhosting.com",
    role: "File Manager",
    status: "active",
    lastActive: new Date(Date.now() - 3_600_000).toISOString(),
    timezone: "Europe/Paris",
    language: "en",
    twoFactor: true,
  },
  {
    id: "u_audit",
    name: "Ada Auditor",
    username: "ada",
    email: "ada@kmerhosting.com",
    role: "Auditor",
    status: "active",
    lastActive: new Date(Date.now() - 86_400_000).toISOString(),
    timezone: "UTC",
    language: "en",
    twoFactor: false,
  },
  {
    id: "u_content",
    name: "Chris Content",
    username: "chris",
    email: "chris@kmerhosting.com",
    role: "Content Manager",
    status: "active",
    lastActive: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    timezone: "America/New_York",
    language: "en",
    twoFactor: false,
  },
  {
    id: "u_pending",
    name: "Priya Pending",
    username: "priya",
    email: "priya@kmerhosting.com",
    role: "Read Only",
    status: "invited",
    lastActive: "",
    timezone: "Asia/Kolkata",
    language: "en",
    twoFactor: false,
  },
  {
    id: "u_disabled",
    name: "Diego Disabled",
    username: "diego",
    email: "diego@kmerhosting.com",
    role: "Uploader",
    status: "disabled",
    lastActive: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    timezone: "America/Mexico_City",
    language: "es",
    twoFactor: false,
  },
];

export interface DemoRole {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  members: number;
  permissions: string[];
}

export const PERMISSION_KEYS = [
  "browse",
  "view",
  "preview",
  "read",
  "create_files",
  "create_directories",
  "edit",
  "rename",
  "copy",
  "move",
  "upload",
  "download",
  "compress",
  "extract",
  "delete",
  "restore",
  "permanently_delete",
  "change_permissions",
  "change_owner",
  "change_group",
  "create_symlinks",
  "calculate_checksums",
  "manage_users",
  "manage_roles",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const DEMO_ROLES: DemoRole[] = [
  {
    id: "r_admin",
    name: "Administrator",
    description: "Full application access, including the administrator terminal.",
    builtin: true,
    members: 1,
    permissions: [...PERMISSION_KEYS],
  },
  {
    id: "r_filemanager",
    name: "File Manager",
    description: "Manage files across permitted paths without user or role administration.",
    builtin: true,
    members: 1,
    permissions: PERMISSION_KEYS.filter((permission) => !["manage_users", "manage_roles"].includes(permission)),
  },
  {
    id: "r_editor",
    name: "Editor",
    description: "Read and edit files without delete or administration access.",
    builtin: true,
    members: 0,
    permissions: ["browse", "view", "preview", "read", "edit", "rename", "download"],
  },
  {
    id: "r_uploader",
    name: "Uploader",
    description: "Upload and organize content in permitted paths.",
    builtin: true,
    members: 1,
    permissions: ["browse", "view", "upload", "create_directories", "rename", "download"],
  },
  {
    id: "r_readonly",
    name: "Read Only",
    description: "Browse and download only.",
    builtin: true,
    members: 1,
    permissions: ["browse", "view", "preview", "read", "download"],
  },
  {
    id: "r_auditor",
    name: "Auditor",
    description: "Read-only access to files.",
    builtin: true,
    members: 1,
    permissions: ["browse", "view", "preview", "read"],
  },
];

export type ActivityResult = "success" | "failure" | "warning";

export interface ActivityEvent {
  id: string;
  time: string;
  user: string;
  action: string;
  category: "auth" | "file" | "user" | "permission" | "terminal" | "settings" | "archive";
  target?: string;
  result: ActivityResult;
  ip?: string;
  device?: string;
  duration?: number;
}

const actions: Array<Omit<ActivityEvent, "id" | "time">> = [
  { user: "admin", action: "Signed in", category: "auth", ip: "192.168.1.20", device: "Firefox on Ubuntu", result: "success" },
  { user: "dana", action: "Edited file", category: "file", target: "/etc/nginx/nginx.conf", result: "success", ip: "192.168.1.21" },
  { user: "chris", action: "Uploaded file", category: "file", target: "/var/www/example.com/uploads/brochure.pdf", result: "success" },
  { user: "diego", action: "Failed sign in", category: "auth", ip: "203.0.113.44", result: "failure" },
  { user: "admin", action: "Changed permissions", category: "permission", target: "/var/www/example.com", result: "success" },
  { user: "dana", action: "Extracted archive", category: "archive", target: "/tmp/release-1.4.2.tar.gz", result: "success" },
  { user: "admin", action: "Created user", category: "user", target: "priya", result: "success" },
  { user: "admin", action: "Opened administrator terminal", category: "terminal", target: "/root", result: "success" },
  { user: "chris", action: "Moved to trash", category: "file", target: "/var/www/example.com/uploads/old-banner.png", result: "success" },
  { user: "admin", action: "Emptied trash", category: "file", result: "warning" },
];

export const DEMO_ACTIVITY: ActivityEvent[] = actions.map((activity, index) => ({
  ...activity,
  id: `evt_${index + 1}`,
  time: new Date(Date.now() - index * 1_800_000).toISOString(),
  duration: Math.round(Math.random() * 400),
}));

export const SERVER_INFO = {
  hostname: "app-prod-01",
  os: "Ubuntu",
  version: "24.04 LTS (Noble Numbat)",
  kernel: "6.8.0-45-generic",
  architecture: "x86_64",
  uptimeSeconds: 12 * 86_400 + 4 * 3_600 + 18 * 60,
  wfmVersion: "0.7.3",
  connection: "demonstration" as const,
};
