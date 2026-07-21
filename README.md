# wFileManager

**A project from KmerHosting LLC.**

wFileManager is a web-based Linux server file manager for Ubuntu. It includes a real local filesystem engine, an interactive PTY terminal, dedicated Linux sudo accounts for application users, custom Supabase-backed authentication, persistent roles and notifications, and a verified stable update channel.

## Current live features

- First-run administrator setup and custom session login
- Real Linux directory browsing from `/`
- List and mosaic layouts with real file metadata and properties
- Text-file reading and editing up to 5 MB
- File and directory creation, upload, download, rename, copy and move
- Upload and download progress with cancellation
- Per-user trash with restore and permanent deletion
- Basic octal permission changes with `chmod`
- Real interactive PTY terminal with a dedicated Linux sudo account per application user
- Root terminal elevation protected by the current wFileManager password
- Persistent Supabase roles, permissions and private notifications
- Administrator user creation and deletion
- Account profile, password change and session revocation
- Real mounted-filesystem capacity, inode usage and health information
- Verified in-app stable updates with automatic rollback after a failed health check

## Installation

Ubuntu 20.04 LTS or newer:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

For a domain and automatic SSL attempt:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo DOMAIN=files.example.com ENABLE_SSL=auto bash
```

The installer uses versioned releases under `/opt/wfilemanager/releases`, persistent configuration under `/etc/wfilemanager`, application state under `/var/lib/wfilemanager`, and the atomic `/opt/wfilemanager/current` symlink.

## Updates

The official stable manifest is stored in the public Supabase Storage bucket `releases.kmerhosting.com` at `wfilemanager/stable.json`. Releases are downloaded over HTTPS, checked with SHA-256, built in a new versioned directory, activated atomically and health-checked. A failed health check automatically restores the previous release.

No GitHub Actions workflow is used. Releases are published manually.

## Development

```bash
cp .env.example .env
bun install
bun run dev
```

## Production build

```bash
bun install
bun run build
bun run typecheck
PORT=1973 HOST=127.0.0.1 bun run start
```

## Supported systems

- Ubuntu 20.04 LTS or newer
- Ubuntu 24.04 LTS recommended
- amd64 and arm64
- Node.js 20 or newer; Node.js 24 recommended

## Security warning

> wFileManager can operate with elevated privileges. Incorrect configuration or misuse can cause permanent data loss, service interruption or complete system compromise.

## License

MIT — see `LICENSE`.
