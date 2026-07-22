# wFileManager

**A modern and open source file manager for Linux servers.**

A project from **KmerHosting LLC**.

wFileManager is a self-hosted web administration panel for managing files and common filesystem operations on an Ubuntu server. It combines a real local filesystem engine, an interactive Linux terminal, user and role management, storage analysis, private notifications, audit information, and verified application updates in one interface.

> [!WARNING]
> wFileManager runs with elevated privileges because it must manage system files, Linux users, permissions, ownership, archives, and terminal sessions. Install it only on a server you control, use HTTPS, and give administrator access only to trusted people.

## Quick installation

This is the normal installation method for end users:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

When the installer asks for a public domain, leave it empty to access wFileManager through the server IP address.

When you already have a domain pointing to the server, install with automatic HTTPS configuration:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo env DOMAIN=files.example.com ENABLE_SSL=auto bash
```

When the current shell is already running as `root`, `sudo` can be omitted.

No Supabase secret or service-role key is required for a normal installation. The installer creates a unique wFileManager instance key for the server automatically.

## What the installer does

The official installer:

1. verifies that the server runs a supported Ubuntu release;
2. installs required system packages, Nginx, Node.js, Bun, Python, and build tools when needed;
3. downloads the stable release manifest and release assets over HTTPS;
4. verifies published SHA-256 checksums before installation;
5. builds the application in a versioned release directory;
6. creates the persistent configuration and data directories;
7. installs and enables the systemd service;
8. configures Nginx as a reverse proxy;
9. configures HTTPS with Certbot when a domain is supplied;
10. starts wFileManager and performs a local health check.

The application listens on `127.0.0.1:1973` by default and is exposed through Nginx. The Node.js service is not intended to be exposed directly to the public internet.

## Supported systems

- Ubuntu 20.04 LTS or newer
- Ubuntu 24.04 LTS recommended
- `amd64` and `arm64`
- Bare-metal servers
- KVM and similar virtual machines
- LXC containers with systemd and root access

On KVM, wFileManager manages the complete filesystem of the virtual machine. Inside LXC, it manages the container filesystem and mounted paths, not the filesystem of the physical host.

The installer currently rejects non-Ubuntu systems.

## First-run setup

After installation, open the server IP address or configured domain in a browser. The first-run screen creates the initial local wFileManager administrator.

Administrator passwords must:

- contain at least 12 characters;
- contain at least one uppercase letter;
- contain at least one lowercase letter;
- contain at least one number;
- contain only letters and numbers;
- not contain identical consecutive characters such as `aa`, `BB`, or `11`.

wFileManager uses its own application authentication system rather than Supabase Auth. Database tables and related objects use the `wfilemanager_` prefix.

Do not reuse the same `WFILEMANAGER_INSTANCE_KEY` on unrelated servers. Each installation should have its own instance key and administrator accounts.

## Features

### Overview

- Server uptime, platform, architecture, memory, disk, and application version
- Root filesystem capacity and available space
- Number of Linux accounts with interactive login access
- Trash usage and recent operational information
- Update availability and current update state

### File explorer

- Browse the real Linux filesystem starting from `/`
- List and grid layouts
- Hidden-file visibility control
- Search within the current directory
- Breadcrumb and direct-path navigation
- Multiple selection using checkboxes, `Ctrl`/`Command`, `Shift`, and `Ctrl+A`
- Right-click context menus
- Create files and directories
- Upload files with progress information
- Download files with progress and cancellation
- Rename, copy, move, and delete files or directories
- Move multiple selected items to trash
- Text-file preview and editing
- File metadata and properties
- Octal permission changes
- Owner and group information
- Symbolic-link awareness

### Archives

- Create ZIP archives
- Create TAR.GZ archives
- Compress individual files or complete directories
- Inspect archives before extraction
- Detect unsafe absolute and parent-traversal paths
- Reject symbolic links, hard links, and device entries during extraction
- Extract into the current directory, a new folder, or another destination
- Keep conflicting items by adding `(1)`, `(2)`, and subsequent suffixes
- Replace existing items when explicitly selected
- Warn when an archive contains several first-level items

### Trash

- Move files and directories to the wFileManager trash
- Restore trashed items
- Permanently delete selected trash entries
- Track trash size and item count

### Storage

- Real mounted-volume detection
- Capacity, used space, available space, and usage percentage
- Filesystem type and mount options
- Inode totals and inode usage
- Read-only, warning, and critical health states
- File-type and extension distribution
- Recursive filesystem analysis
- Linux home-directory usage analysis

### Terminal and Linux integration

- Interactive PTY terminal in the browser
- Real command execution on the server
- Persistent working-directory changes
- Dedicated Linux account provisioning for wFileManager users
- Password-protected privilege elevation for authorized users
- Terminal permission controlled through application roles

### Users, roles, and access

- Administrator and standard application users
- Role creation, editing, and deletion
- Fine-grained permissions for browsing, reading, editing, uploading, downloading, archives, trash, terminal, users, and roles
- User status management
- Optional forced password change for newly created accounts
- Online-user presence reporting

### Account and sessions

- Profile name, email, and timezone management
- Password changes
- Active-session listing
- Revoke an individual session
- Revoke all sessions
- Persistent or short-lived sign-in sessions
- Administrator password recovery from the server root shell

### Notifications and auditing

- Private persistent notifications associated with the authenticated user
- Read, unread, delete, and clear operations
- Authentication and administrative audit information
- Login, logout, password verification, setup, and user-management events

### Updates

- Stable release channel
- HTTPS release downloads
- SHA-256 checksum verification
- Release-size verification
- Versioned release directories
- Atomic active-release switching
- Local health checks after activation
- Automatic rollback when a new release fails
- Manual rollback to the previous release
- Old-release cleanup

## Administrator password recovery

wFileManager does not expose a public “Forgot password” page. On supported releases, the server owner can reset an administrator password from a root shell:

```bash
sudo wfilemanager-reset-admin-password
```

To target a specific administrator username:

```bash
sudo wfilemanager-reset-admin-password admin
```

The command validates the same password policy used during setup and revokes existing wFileManager sessions after a successful reset. This changes the wFileManager application password; it does not change the Linux `root` password.

## Service management

Check the service:

```bash
systemctl status wfilemanager.service --no-pager
```

Follow application logs:

```bash
journalctl -u wfilemanager.service -f
```

Restart the application:

```bash
systemctl restart wfilemanager.service
```

Test the local application endpoint:

```bash
curl -fsS http://127.0.0.1:1973/
```

Validate and reload Nginx:

```bash
nginx -t && systemctl reload nginx
```

## Updates and rollback

Start a stable update:

```bash
systemctl start wfilemanager-updater@install.service
journalctl -u wfilemanager-updater@install.service -f
```

Roll back to the previous available release:

```bash
systemctl start wfilemanager-updater@rollback.service
journalctl -u wfilemanager-updater@rollback.service -f
```

The updater downloads the stable manifest, verifies the release checksum and size, builds the new release separately, activates it atomically, restarts the service, and runs a health check. A failed health check restores the previous working release automatically.

## Persistent locations

```text
/opt/wfilemanager/releases/          Versioned application releases
/opt/wfilemanager/current            Symbolic link to the active release
/etc/wfilemanager/                   Persistent configuration and recovery data
/etc/wfilemanager/wfilemanager.env   Runtime and build configuration
/var/lib/wfilemanager/trash/         Managed trash storage
/var/lib/wfilemanager/update/        Update state and rollback information
/usr/local/lib/wfilemanager/         Updater scripts
/usr/local/sbin/                     Root administration commands
/etc/systemd/system/                 Application and updater services
/etc/nginx/sites-available/          Nginx virtual-host configuration
```

Application updates do not replace the persistent configuration or trash directories.

## Configuration

The main configuration is stored in `/etc/wfilemanager/wfilemanager.env`.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Local Node.js listening port | `1973` |
| `VITE_SUPABASE_URL` | Supabase URL embedded into the browser build | Project default |
| `VITE_WFILEMANAGER_INSTANCE_KEY` | Instance key embedded into the browser build | Generated during installation |
| `WFILEMANAGER_SUPABASE_URL` | Server-side Supabase URL | Same as the browser URL |
| `WFILEMANAGER_INSTANCE_KEY` | Server-side installation identity | Generated during installation |
| `WFILEMANAGER_TRASH_DIR` | Persistent trash directory | `/var/lib/wfilemanager/trash` |
| `WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE` | Allows writes to protected pseudo-filesystems | `false` |
| `WFILEMANAGER_UPDATE_MANIFEST_URL` | Stable update-manifest URL | Official stable channel |
| `WFILEMANAGER_UPDATE_STATE_FILE` | Persistent updater state | `/var/lib/wfilemanager/update/state.json` |
| `WFILEMANAGER_HEALTH_URL` | Local post-update health-check URL | `http://127.0.0.1:1973/` |

The `VITE_` variables are compile-time values. Rebuild the application after changing them.

Do not enable `WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=true` unless the consequences are fully understood. Writes to `/proc`, `/sys`, `/dev`, and `/run` are blocked by default.

## Security model

wFileManager deliberately runs its systemd application service as `root`. This is necessary for the product’s intended filesystem, ownership, user, permission, and terminal capabilities. It also means a vulnerability or compromised administrator account can affect the entire server.

Minimum deployment rules:

- use HTTPS for internet-facing installations;
- keep Ubuntu and wFileManager updated;
- restrict administrator access;
- use a unique instance key for every server;
- do not expose port `1973` publicly;
- keep `/etc/wfilemanager` readable only by root;
- protect server SSH access;
- keep independent backups of important files;
- never paste service-role keys, reset tokens, or session tokens into issues or logs.

Read [SECURITY.md](./SECURITY.md) before reporting a vulnerability.

## Development

### Requirements

- Node.js 20 or newer
- Bun
- Python 3
- Linux recommended for terminal and filesystem integration

### Local setup

```bash
git clone https://github.com/toscani-tenekeu/wFileManager.git
cd wFileManager
cp .env.example .env
bun install
bun run dev
```

### Verification

```bash
bun run lint
bun run typecheck
bun run build
```

Run the production build locally:

```bash
PORT=1973 HOST=127.0.0.1 bun run start
```

The production output is generated in `.output/` using the Nitro `node-server` preset.

Available scripts:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the development server |
| `bun run lint` | Run ESLint |
| `bun run format` | Format the repository with Prettier |
| `bun run typecheck` | Run TypeScript validation |
| `bun run build` | Generate the production build |
| `bun run start` | Start an existing production build |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution rules and pull-request requirements.

## Current limitations

- Ubuntu is the only officially supported operating system.
- wFileManager manages one Linux server per installation; it is not a multi-server orchestration platform.
- Advanced POSIX ACL management is not yet complete.
- Uploads cannot currently resume after a browser or network interruption.
- Large binary files are downloadable but are not edited in the browser.
- Rich previews for every media and document format are not available.
- An LXC installation cannot access host paths unless those paths are explicitly mounted into the container.

## License

wFileManager is licensed under the [MIT License](./LICENSE).

Copyright © 2026 KmerHosting LLC.