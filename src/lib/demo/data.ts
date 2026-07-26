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

export const DEMO_USERS: DemoUser[] = [];

export interface DemoRole {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  members: number;
  permissions: string[];
}

export const SERVER_INFO: { wfmVersion: string } = {
  wfmVersion: "0.8.11",
};

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
  "calculate_checksums",
  "view_logs",
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
    description: "Manage files across explicitly permitted paths without user administration.",
    builtin: true,
    members: 0,
    permissions: PERMISSION_KEYS.filter(
      (permission) => !["manage_users", "manage_roles", "view_logs"].includes(permission),
    ),
  },
  {
    id: "r_editor",
    name: "Editor",
    description: "Read and edit files in explicitly permitted paths.",
    builtin: true,
    members: 0,
    permissions: ["browse", "view", "preview", "read", "edit", "rename", "download"],
  },
  {
    id: "r_uploader",
    name: "Uploader",
    description: "Upload and organize content in explicitly permitted paths.",
    builtin: true,
    members: 0,
    permissions: ["browse", "view", "upload", "create_directories", "rename", "download"],
  },
  {
    id: "r_readonly",
    name: "Read Only",
    description: "Browse and download only inside explicitly permitted paths.",
    builtin: true,
    members: 0,
    permissions: ["browse", "view", "preview", "read", "download"],
  },
  {
    id: "r_auditor",
    name: "Auditor",
    description: "Read-only access to permitted files and audit logs when explicitly granted.",
    builtin: true,
    members: 0,
    permissions: ["browse", "view", "preview", "read"],
  },
];
