// Realistic Linux filesystem demo data for the frontend.
// Everything here is in-memory only — no server calls.

export type FsKind = "dir" | "file" | "symlink";

export interface FsNode {
  name: string;
  kind: FsKind;
  size: number; // bytes; directories report aggregate demo size
  owner: string;
  group: string;
  mode: string; // octal, 3 digits, e.g. "755"
  mtime: string; // ISO
  ctime?: string;
  atime?: string;
  mime?: string;
  linkTarget?: string;
  hidden?: boolean;
  children?: FsNode[];
  content?: string; // for text preview
  starred?: boolean;
  trashed?: {
    originalPath: string;
    deletedAt: string;
    deletedBy: string;
  };
}

const now = new Date();
const iso = (dOffsetDays = 0, h = 0) =>
  new Date(now.getTime() - dOffsetDays * 86400000 - h * 3600000).toISOString();

function file(
  name: string,
  opts: Partial<FsNode> & { size?: number; content?: string } = {},
): FsNode {
  return {
    name,
    kind: "file",
    size: opts.size ?? 1024,
    owner: opts.owner ?? "root",
    group: opts.group ?? "root",
    mode: opts.mode ?? "644",
    mtime: opts.mtime ?? iso(1),
    ctime: opts.ctime ?? iso(30),
    atime: opts.atime ?? iso(0, 3),
    mime: opts.mime ?? guessMime(name),
    hidden: opts.hidden ?? name.startsWith("."),
    content: opts.content,
    starred: opts.starred,
  };
}

function dir(name: string, children: FsNode[], opts: Partial<FsNode> = {}): FsNode {
  return {
    name,
    kind: "dir",
    size: children.reduce((a, c) => a + c.size, 0),
    owner: opts.owner ?? "root",
    group: opts.group ?? "root",
    mode: opts.mode ?? "755",
    mtime: opts.mtime ?? iso(2),
    ctime: opts.ctime ?? iso(60),
    atime: opts.atime ?? iso(0, 1),
    hidden: opts.hidden ?? name.startsWith("."),
    children,
    starred: opts.starred,
  };
}

function link(name: string, target: string, opts: Partial<FsNode> = {}): FsNode {
  return {
    name,
    kind: "symlink",
    size: 0,
    owner: opts.owner ?? "root",
    group: opts.group ?? "root",
    mode: "777",
    mtime: opts.mtime ?? iso(3),
    linkTarget: target,
  };
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    yml: "application/yaml",
    yaml: "application/yaml",
    xml: "application/xml",
    csv: "text/csv",
    log: "text/plain",
    conf: "text/plain",
    sh: "application/x-sh",
    js: "text/javascript",
    ts: "text/typescript",
    tsx: "text/typescript",
    py: "text/x-python",
    html: "text/html",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    "7z": "application/x-7z-compressed",
  };
  return map[ext] ?? "application/octet-stream";
}

const nginxConf = `user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
  worker_connections 1024;
}

http {
  sendfile on;
  tcp_nopush on;
  types_hash_max_size 2048;
  include /etc/nginx/mime.types;
  default_type application/octet-stream;

  server {
    listen 80;
    server_name _;
    root /var/www/html;
    index index.html;
    location / {
      try_files $uri $uri/ =404;
    }
  }
}
`;

const sshdConfig = `# Package generated configuration file
Port 22
Protocol 2
PermitRootLogin prohibit-password
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
Subsystem sftp /usr/lib/openssh/sftp-server
`;

const envFile = `# wFileManager demo environment
NODE_ENV=production
APP_NAME=wFileManager
APP_PORT=8443
DATA_DIR=/opt/wfilemanager.kmerhosting.com/data
LOG_LEVEL=info
`;

const packageJson = `{
  "name": "example-site",
  "version": "1.4.2",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "node server.js"
  }
}
`;

const readmeMd = `# example-site

A demo project served from \`/var/www/example.com\`.

## Deploy

\`\`\`bash
rsync -avz ./dist/ user@server:/var/www/example.com/
sudo systemctl reload nginx
\`\`\`
`;

const accessLog = Array.from({ length: 40 })
  .map((_, i) => {
    const ip = `192.168.1.${20 + (i % 40)}`;
    const path = ["/", "/about", "/api/health", "/assets/app.css", "/login"][i % 5];
    const code = [200, 200, 200, 304, 404][i % 5];
    const size = 100 + i * 37;
    return `${ip} - - [${new Date(Date.now() - i * 60_000).toUTCString()}] "GET ${path} HTTP/1.1" ${code} ${size}`;
  })
  .join("\n");

const errorLog = Array.from({ length: 12 })
  .map(
    (_, i) =>
      `${new Date(Date.now() - i * 300_000).toISOString()} [error] worker#${i}: upstream timed out while reading response header`,
  )
  .join("\n");

export const ROOT: FsNode = dir("/", [
  dir("boot", [file("vmlinuz-6.8.0-45-generic", { size: 12_582_912, mode: "644" })]),
  dir("dev", [file("null", { size: 0, mode: "666" }), file("zero", { size: 0, mode: "666" })]),
  dir("etc", [
    dir(
      "nginx",
      [
        file("nginx.conf", { size: nginxConf.length, content: nginxConf, starred: true }),
        dir("sites-available", [
          file("default", { size: 512 }),
          file("example.com", { size: 780 }),
        ]),
        dir("sites-enabled", [link("default", "/etc/nginx/sites-available/default")]),
      ],
      { owner: "root", group: "root" },
    ),
    dir("ssh", [
      file("sshd_config", { size: sshdConfig.length, content: sshdConfig, mode: "600" }),
      file("ssh_host_ed25519_key", { size: 464, mode: "600" }),
      file("ssh_host_ed25519_key.pub", { size: 96, mode: "644" }),
    ]),
    file("hostname", { size: 12, content: "app-prod-01\n" }),
    file("hosts", { size: 220, content: "127.0.0.1 localhost\n127.0.1.1 app-prod-01\n" }),
    file("os-release", {
      size: 220,
      content:
        'NAME="Ubuntu"\nVERSION="24.04 LTS (Noble Numbat)"\nID=ubuntu\nVERSION_ID="24.04"\n',
    }),
    file("fstab", { size: 340 }),
  ]),
  dir(
    "home",
    [
      dir(
        "admin",
        [
          dir("Documents", [
            file("notes.md", {
              size: 420,
              content: "# Notes\n\n- review nginx config\n- rotate ssh keys\n",
              starred: true,
            }),
            file("budget-2025.csv", {
              size: 1240,
              content: "month,category,amount\nJan,hosting,120\nFeb,hosting,120\n",
            }),
          ]),
          dir("Downloads", [
            file("ubuntu-24.04-live-server-amd64.iso", { size: 2_684_354_560, mode: "644" }),
            file("report.pdf", { size: 384_000 }),
          ]),
          dir("Pictures", [
            file("wallpaper.jpg", { size: 2_450_000, mime: "image/jpeg" }),
            file("logo.svg", {
              size: 640,
              content:
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#3ecf8e"/></svg>',
            }),
          ]),
          dir("Projects", [
            dir("api", [
              file("package.json", { size: packageJson.length, content: packageJson }),
              file("README.md", { size: readmeMd.length, content: readmeMd, starred: true }),
              file(".env", { size: envFile.length, content: envFile, mode: "600", hidden: true }),
              dir("src", [
                file("index.ts", { size: 1200, content: "console.log('hello from api')\n" }),
                file("server.ts", { size: 3400 }),
              ]),
            ]),
          ]),
          file(".bashrc", { size: 3_771, hidden: true }),
          file(".profile", { size: 807, hidden: true }),
        ],
        { owner: "admin", group: "admin", mode: "750" },
      ),
    ],
    { owner: "root", group: "root" },
  ),
  dir(
    "root",
    [file(".bash_history", { size: 2048, hidden: true, mode: "600" })],
    { mode: "700" },
  ),
  dir("opt", [
    dir(
      "wfilemanager.kmerhosting.com",
      [
        dir("bin", [file("wfilemanager", { size: 24_567_890, mode: "755" })]),
        dir("data", [
          file("sessions.db", { size: 512_000, mode: "600" }),
          file("audit.log", { size: 1_240_000 }),
        ]),
        file("LICENSE", { size: 1080 }),
        file("VERSION", { size: 10, content: "0.3.0\n" }),
      ],
      { owner: "wfm", group: "wfm" },
    ),
  ]),
  dir(
    "var",
    [
      dir("log", [
        file("syslog", { size: 4_320_000 }),
        file("auth.log", { size: 220_000, mode: "640" }),
        dir("nginx", [
          file("access.log", { size: accessLog.length, content: accessLog }),
          file("error.log", { size: errorLog.length, content: errorLog }),
        ]),
      ]),
      dir("www", [
        file("index.nginx-debian.html", { size: 612 }),
        dir(
          "example.com",
          [
            file("index.html", {
              size: 812,
              content: "<!doctype html><html><body><h1>Example</h1></body></html>",
            }),
            dir("assets", [
              file("app.css", { size: 42_000 }),
              file("app.js", { size: 128_000 }),
            ]),
            dir("uploads", [
              file("brochure.pdf", { size: 890_000 }),
              file("banner.webp", { size: 220_000 }),
            ]),
          ],
          { owner: "www-data", group: "www-data" },
        ),
      ]),
      dir("lib", [dir("systemd", [dir("system", [file("nginx.service", { size: 380 })])])]),
    ],
    { owner: "root", group: "root" },
  ),
  dir("tmp", [file("session-cache.bin", { size: 12_000, mode: "600" })], { mode: "1777" }),
  dir("usr", [
    dir("bin", [
      file("ls", { size: 138_000, mode: "755" }),
      file("cat", { size: 40_000, mode: "755" }),
      file("systemctl", { size: 900_000, mode: "755" }),
    ]),
    dir("local", [dir("bin", [file("wfm-cli", { size: 12_800_000, mode: "755" })])]),
  ]),
  dir("mnt", [dir("backups", [file("2025-11-01.tar.gz", { size: 5_800_000_000 })])]),
]);

// ---------- Path traversal helpers ----------

export function normalizePath(p: string): string {
  if (!p || p === "") return "/";
  const parts = p.split("/").filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export function getNodeAt(path: string, root: FsNode = ROOT): FsNode | null {
  const norm = normalizePath(path);
  if (norm === "/") return root;
  const parts = norm.split("/").filter(Boolean);
  let cur: FsNode = root;
  for (const p of parts) {
    if (!cur.children) return null;
    const next = cur.children.find((c) => c.name === p);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export function listDir(path: string): FsNode[] {
  const n = getNodeAt(path);
  if (!n || n.kind !== "dir") return [];
  return n.children ?? [];
}

export function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base}/${name}`;
}

export function breadcrumbs(path: string): { name: string; path: string }[] {
  const norm = normalizePath(path);
  const parts = norm.split("/").filter(Boolean);
  const out = [{ name: "/", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    out.push({ name: p, path: acc });
  }
  return out;
}

// ---------- Search ----------

export interface SearchResult {
  path: string;
  node: FsNode;
}

export function searchFs(query: string, root: FsNode = ROOT, limit = 200): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchResult[] = [];
  const walk = (node: FsNode, path: string) => {
    if (results.length >= limit) return;
    if (node.name.toLowerCase().includes(q) && path !== "/") {
      results.push({ path, node });
    }
    if (node.children) {
      for (const c of node.children) walk(c, path === "/" ? `/${c.name}` : `${path}/${c.name}`);
    }
  };
  walk(root, "/");
  return results;
}

// ---------- Aggregates ----------

export function countAll(root: FsNode = ROOT): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;
  const walk = (n: FsNode) => {
    if (n.kind === "dir") {
      dirs++;
      n.children?.forEach(walk);
    } else files++;
  };
  walk(root);
  return { files, dirs: Math.max(0, dirs - 1) };
}

export const SENSITIVE_PATHS = [
  "/",
  "/boot",
  "/dev",
  "/etc",
  "/proc",
  "/root",
  "/run",
  "/sys",
  "/usr",
  "/var/lib",
];

export function isSensitive(path: string): boolean {
  return SENSITIVE_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}
