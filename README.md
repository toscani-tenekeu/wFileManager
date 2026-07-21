# wFileManager

**A project from KmerHosting LLC.**

wFileManager is a web-based Linux server file manager for Ubuntu. This revision contains a real local filesystem engine, a real administrative command terminal, and custom application authentication stored in prefixed Supabase tables. Supabase Auth is not used.

## Current live features

- First-run administrator setup and custom session login
- Real Linux directory browsing from `/`
- List and mosaic layouts with real file metadata and properties
- Text-file reading and editing up to 5 MB
- File and directory creation, upload, download, rename, copy and move
- Upload and download progress with cancellation
- Per-user trash with restore, permanent delete and automatic metadata
- Basic octal permission changes with `chmod`
- Real interactive PTY terminal with a dedicated Linux sudo account per application user
- Root terminal elevation protected by the current wFileManager password
- Persistent Supabase roles, permissions and notifications
- Administrator user creation and deletion, including Linux-account provisioning and cleanup
- Functional account profile, password change and session revocation
- Real mounted-filesystem capacity, inode usage and health information
- Verified in-app stable updates with automatic rollback after failed health checks

## Current limitations

The following areas remain intentionally deferred:

- Archive creation and extraction
- Recursive ownership editor and advanced ACLs
- Path-specific guest restrictions enforced by the local engine
- Resumable or chunked uploads across interrupted browser sessions
- Media previews and large-file streaming editors

## Supported systems

- Ubuntu 20.04 LTS or newer
- Ubuntu 24.04 LTS recommended
- Node.js 20 or newer; Node.js 24 recommended

## Development

```bash
cp .env.example .env
bun install
bun run dev
```

## Production build

```bash
bun install
bun run typecheck
bun run build
PORT=1973 HOST=127.0.0.1 bun run start
```

The production build uses the Nitro `node-server` preset.

## Supabase

Project: `igihzeyfgwhnuiflamvn`

Application records use the `wfilemanager_` prefix. The local server validates the browser's custom wFileManager session through the deployed `wfilemanager-api` Edge Function before allowing filesystem or terminal operations.

## Security warning

> wFileManager is designed to manage files on a Linux server and may operate with elevated privileges. Incorrect configuration or misuse can cause data loss, service interruption, or system compromise.

The current systemd service runs as `root` because the product is intended to administer the whole server. Access should remain behind HTTPS and limited to trusted administrators. Writes to `/proc`, `/sys`, `/dev` and `/run` are blocked by default. They can only be enabled explicitly with `WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=true`, which is not recommended.

## License

MIT — see [LICENSE](./LICENSE).

wFileManager — A project from KmerHosting LLC.

## v0.3.0

- Real interactive root terminal powered by xterm.js and a persistent Linux PTY.
- Actual upload progress.
- Progress tracking for copy, move, and delete operations.
- Simplified login screen.


## v0.4.0 live features

- Download progress with cancellation.
- Upload progress with cancellation and partial-file cleanup.
- Real `/etc/os-release` information on the overview page.
- One dedicated Ubuntu Linux account per wFileManager user.
- Each managed Linux account is added to the `sudo` group.
- Terminal sessions start as the dedicated Linux user, not root.
- Switching a terminal to root requires the current wFileManager password.
- The Linux account password is synchronized at login, user creation, or root elevation.

The local service still runs as root because it must create managed Linux users and open privileged terminal sessions.

## v0.5.0 live features

- Real per-user trash stored under `/var/lib/wfilemanager/trash`.
- File Explorer deletion now moves files and folders to trash instead of deleting them immediately.
- Trash supports listing, searching, restoring, permanent deletion and emptying all items.
- Original path, deletion time, owner, type and size are retained in trash metadata.
- File Explorer now uses a responsive mosaic layout with large file-type and folder icons.
- Mosaic cards use clear selection, subtle elevation and no hover underlining.

## v0.6.5 live features

- File Explorer now supports both list and mosaic layouts, with the selected layout remembered in the browser.
- List rows are fully selectable and openable by double-clicking anywhere on the row.
- Mosaic icons are smaller and hover zoom/elevation effects have been removed.
- File and folder names never receive hover underlines.
- Item menus now include a Properties dialog with Linux metadata.
- Upload destination browser with quick paths and recent upload destinations.
- Upload cancellation from the dedicated Uploads page.
- File-manager-focused overview cards for root entries and trash usage.
- Supabase-backed role CRUD and persistent permission matrices.
- Role selection when creating users.
- Basic permission enforcement for local filesystem and terminal endpoints.
- Permission-aware application navigation.

- Removed Favorites, Recent, Shared access, Activity logs, Settings, command palette and keyboard-shortcut interfaces.
- Moved update checks to About & updates.
- Added real account profile editing, password changes and active-session management without 2FA.
- Added administrator-driven user deletion with last-administrator protection.
- Added real storage mount, capacity and inode reporting.

Path-based restrictions are not enforced in this version. Roles control actions globally for the current installation.


## Installation and updates

The official stable channel is published from Supabase Storage. Install on Ubuntu 20.04 LTS or newer with:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

The installer creates versioned releases under `/opt/wfilemanager/releases`, keeps persistent configuration in `/etc/wfilemanager`, stores application state in `/var/lib/wfilemanager`, and activates releases through the `/opt/wfilemanager/current` symbolic link. Updates are checksum-verified and automatically rolled back when the local health check fails.

No GitHub Actions workflow is required. Release archives and the stable manifest are published manually to the public Supabase Storage bucket `releases.kmerhosting.com`.


## v0.6.6 live features

- Official public stable channel in Supabase Storage.
- One-shot Ubuntu installer.
- Versioned releases under `/opt/wfilemanager/releases`.
- Persistent configuration under `/etc/wfilemanager`.
- In-app update installation with progress phases.
- SHA-256 package verification.
- Atomic release activation and automatic rollback after a failed local health check.
- Manual rollback to the previous verified release.
