# wFileManager

**A project from KmerHosting LLC.**

wFileManager is a web-based administration interface for managing files on an Ubuntu server. It provides a real local filesystem engine, an interactive Linux terminal, custom application authentication, roles, private notifications, storage monitoring, and verified application updates.

## Features

- Browse the Linux filesystem from `/`
- List and mosaic file layouts
- File and directory creation, upload, download, rename, copy, move and deletion
- Transfer progress and cancellation
- Text-file preview and editing
- File properties and octal permission changes
- Per-user trash with restore and permanent deletion
- Interactive PTY terminal
- Dedicated Linux sudo account for each wFileManager user
- Password-protected terminal elevation to root
- Administrator user and role management
- Account profile, password and active-session management
- Private persistent notifications
- Real storage capacity, available space, mounts and inode usage
- Online-user presence reporting
- Stable updates with SHA-256 verification, health checks and automatic rollback

## Requirements

- Ubuntu 20.04 LTS or newer
- Ubuntu 24.04 LTS recommended
- `amd64` or `arm64`
- Node.js 20 or newer
- Bun

## Installation

Run as root or through `sudo`:

```bash
curl -fsSL \
  https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh |
  sudo bash
```

Install with a public domain and automatic HTTPS configuration:

```bash
curl -fsSL \
  https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh |
  sudo env DOMAIN=files.example.com ENABLE_SSL=auto bash
```

The installer uses these persistent locations:

```text
/opt/wfilemanager/releases/   Versioned application releases
/opt/wfilemanager/current     Active release symbolic link
/etc/wfilemanager/            Persistent configuration
/var/lib/wfilemanager/        Trash and update state
```

## Updates

The stable release manifest is published through Supabase Storage. Updates are downloaded over HTTPS, checked against their SHA-256 checksum, built in a new versioned directory and activated atomically.

If the new version fails its local health check, wFileManager restores the previous release automatically.

Manual update:

```bash
systemctl start wfilemanager-updater@install.service
journalctl -u wfilemanager-updater@install.service -f
```

Manual rollback:

```bash
systemctl start wfilemanager-updater@rollback.service
```

## Development

```bash
git clone https://github.com/toscani-tenekeu/wFileManager.git
cd wFileManager
cp .env.example .env
bun install
bun run dev
```

Production verification:

```bash
bun install
bun run typecheck
bun run build
PORT=1973 HOST=127.0.0.1 bun run start
```

The production build uses the Nitro `node-server` preset.

## Supabase architecture

wFileManager uses custom application authentication rather than Supabase Auth. Database objects use the `wfilemanager_` prefix.

The local filesystem and terminal server validate the current wFileManager session before executing privileged operations. Notifications remain private to their associated user.

## Security warning

> wFileManager can administer the complete Linux filesystem and execute privileged commands. Incorrect configuration or misuse can cause permanent data loss, service interruption or full server compromise.

The systemd service runs as `root` because the application must manage system files, Linux users and privileged terminal sessions. Keep the application behind HTTPS and restrict administrator access to trusted users.

Writes to `/proc`, `/sys`, `/dev` and `/run` are blocked by default. Enabling `WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=true` is not recommended.

## Current limitations

- Archive creation and extraction
- Advanced ACL and recursive ownership editing
- Path-specific role restrictions enforced by the local filesystem engine
- Resumable uploads after browser or network interruption
- Rich media previews and large-file streaming editing

## License

MIT — see [LICENSE](./LICENSE).

Copyright © KmerHosting LLC.