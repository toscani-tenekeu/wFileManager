# wFileManager

**A modern and open source file manager for Linux servers.**

wFileManager provides a web file explorer, guarded archive handling, per-user trash, application users and roles, notifications, verified updates and an administrator-only Linux terminal.

> wFileManager runs with elevated privileges. Install it only on a server you control and restrict administrator access to trusted people.

## Requirements

- Ubuntu 20.04 LTS or newer; Ubuntu 24.04 LTS recommended
- KVM virtual machine, bare-metal server, or LXC container with systemd and root access
- `amd64` or `arm64`
- A domain with an A record pointing to the server's public IPv4 address
- Public ports `80` and `443`

Installation by IP address or plain HTTP is not supported. The installer verifies DNS and configures HTTPS with Certbot.

## Install

Point your domain's A record to the public IPv4 address of the server where wFileManager will be installed. Wait until the domain resolves to that address, then run:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

The installer asks for the domain and application-data mode. After installation, open:

```text
https://your-domain.example/setup
```

Administrator passwords require at least 12 alphanumeric characters with uppercase, lowercase and a number. Identical consecutive characters are rejected.

## Application-data modes

The selected mode controls wFileManager application records such as users, roles, sessions, authentication information, notifications and settings. It does not control or back up the files displayed by the file manager.

### Community — SQLite on your server

Community is free forever and does not require a paid licence or subscription. Application records are stored locally in:

```text
/var/lib/wfilemanager/wfilemanager.db
```

The server administrator is responsible for:

- SQLite database backups;
- restores and migrations;
- database maintenance;
- recovery after a server reinstall or replacement.

Community includes all wFileManager features and community support.

### Pro — Managed application data

Pro costs **$50 USD per instance per year** and includes **100 MB** of managed application storage.

Pro includes:

- managed users, roles, sessions and authentication records;
- managed notifications, settings and related application records;
- automatic backups of wFileManager application data;
- recovery of users and application records after a server reinstall or replacement;
- priority support.

Each additional **100 MB** of managed application storage costs **$1 USD per year**.

Pro storage covers wFileManager application records only. Files, directories, databases and other content on the server filesystem require a separate server backup and recovery strategy.

See [Application-data modes](./docs/data-modes.md) for the complete comparison.

## Pro Recovery Kit

A Pro instance creates a root-only Recovery Kit at:

```text
/root/wfilemanager-recovery-kit.txt
```

Copy this file to a secure location outside the server. It contains the instance identity, recovery key and configured domain required to reconnect a replacement installation.

Display or export the current kit:

```bash
sudo wfilemanager-recovery-kit show
sudo wfilemanager-recovery-kit export /root/wfilemanager-recovery-kit.txt
```

A successful recovery rotates the recovery key and revokes previous application sessions. Recovery applies only to managed wFileManager application records; it does not restore files from the server filesystem.

## Main features

- Linux filesystem browsing from `/`
- Multi-selection, copy, move, rename and delete operations
- Uploads and downloads with progress
- Text preview and editing
- ZIP and TAR.GZ creation and guarded extraction
- Protection against traversal, unsafe links, special archive entries and excessive expansion
- Per-user trash, restore and permanent deletion
- Application users, roles and permissions
- Sessions, notifications and presence
- Administrator-only root PTY terminal with current-password verification
- Stable updates with checksum verification, health checks and rollback

Application users are not Linux users. Creating an account, signing in or changing an application password never creates an operating-system account and never grants sudo access.

## Administration commands

Service status:

```bash
sudo systemctl status wfilemanager.service --no-pager
```

Service logs:

```bash
sudo journalctl -u wfilemanager.service -f
```

Application health:

```bash
curl -fsS http://127.0.0.1:1973/api/health
```

Pro managed-data heartbeat status:

```bash
sudo systemctl status wfilemanager-heartbeat.timer --no-pager
sudo systemctl start wfilemanager-heartbeat.service
```

Reset an administrator password:

```bash
sudo wfilemanager-reset-admin-password
```

Update the application:

```bash
sudo systemctl start wfilemanager-updater@install.service
```

Roll back to the previous verified release:

```bash
sudo systemctl start wfilemanager-updater@rollback.service
```

Uninstall wFileManager:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/uninstall.sh | sudo bash
```

The update system verifies the release archive, builds a separate release, switches atomically, restarts the service and checks application health. An unhealthy release is rolled back automatically.

## Persistent locations

```text
/opt/wfilemanager/                    Application releases
/etc/wfilemanager/                    Configuration and recovery key
/var/lib/wfilemanager/                SQLite, trash and update state
/root/wfilemanager-recovery-kit.txt   Pro recovery kit
/usr/local/lib/wfilemanager/          Updater and heartbeat helpers
/usr/local/sbin/wfilemanager-*        Administration commands
/etc/nginx/sites-available/wfilemanager
```

## Security essentials

- Port `1973` remains bound to `127.0.0.1`.
- Public access is HTTPS-only through Nginx.
- Community SQLite sessions are validated locally by privileged API operations.
- Repeated sign-in failures are rate-limited by account and source IP.
- Ordinary application users never receive Linux or sudo accounts.
- Terminal endpoints require an administrator and current-password verification.
- Mutations through symbolic-link path components are rejected.
- Writes to `/proc`, `/sys`, `/dev` and `/run` are blocked by default.
- Uploads never replace an existing destination.
- Archive entry count, expanded size, compression ratio and destination free space are checked.
- Release archives are verified by size and SHA-256 before activation.
- Recovery keys and exported Recovery Kits are stored with mode `0600`.
- Pro recovery authenticates with a hashed per-instance secret; the raw recovery key is not stored by the managed backend.

Read [SECURITY.md](./SECURITY.md) before reporting a vulnerability.

## Development

Requirements: Node.js 24, Bun, Python 3 and Linux.

```bash
git clone https://github.com/toscani-tenekeu/wFileManager.git
cd wFileManager
cp .env.example .env
bun install
bun run dev
```

Verification:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Example Community SQLite configuration:

```env
VITE_WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_SQLITE_PATH=./data/wfilemanager.db
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Developed by KmerHosting LLC.

MIT. See [LICENSE](./LICENSE).
