# wFileManager

**A modern and open source file manager for Linux servers.**  
A project from **KmerHosting LLC**.

wFileManager provides a web file explorer, guarded archive handling, trash, application users, roles, notifications, verified updates and an administrator-only Linux terminal.

> wFileManager runs with elevated privileges. Install it only on a server you control and restrict administrator accounts to trusted people.

## Requirements

- Ubuntu 20.04 LTS or newer; Ubuntu 24.04 LTS recommended
- KVM, bare metal, or LXC with systemd and root access
- `amd64` or `arm64`
- A domain with an A record pointing to the server's public IPv4
- Public ports `80` and `443`

Installation by IP address or plain HTTP is not supported. The installer validates DNS and configures HTTPS with Certbot.

A free test subdomain can be requested at [domain.kmerhosting.com](https://domain.kmerhosting.com).

## Install

Create the DNS A record first, wait for propagation, then run:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

The installer asks for the domain and database mode.

### Database modes

**KmerHosting managed Supabase** is the fastest option for evaluation and testing. Accounts, roles, sessions and notifications are kept in the managed project. Each server is limited to 100 MB of application data.

**SQLite on this VPS** is recommended for long-term installations. It keeps application records locally in:

```text
/var/lib/wfilemanager/wfilemanager.db
```

Files managed in File Explorer always remain on the VPS. The selected database affects only application accounts, roles, sessions, notifications and related records.

After installation, open:

```text
https://your-domain.example/setup
```

Administrator passwords require at least 12 alphanumeric characters with uppercase, lowercase and a number. Identical consecutive characters are rejected.

## Main features

- Real Linux filesystem browsing from `/`
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

Reset an administrator password:

```bash
sudo wfilemanager-reset-admin-password
```

The command asks for a new password and confirmation. Input is invisible while typing: no characters, dots or asterisks are displayed.

Update the application:

```bash
sudo systemctl start wfilemanager-updater@install.service
```

Roll back to the previous verified release:

```bash
sudo systemctl start wfilemanager-updater@rollback.service
```

The update system verifies the archive, runs tests, builds a separate release, switches atomically, restarts the service and checks the application, database and persistent filesystem. An unhealthy release is rolled back automatically.

## Persistent locations

```text
/opt/wfilemanager/                    Application releases
/etc/wfilemanager/                    Configuration and recovery key
/var/lib/wfilemanager/                SQLite, trash and update state
/usr/local/lib/wfilemanager/          Updater
/usr/local/sbin/wfilemanager-*        Administration commands
/etc/nginx/sites-available/wfilemanager
```

## Security essentials

- Port `1973` remains bound to `127.0.0.1`.
- Public access is HTTPS-only through Nginx.
- SQLite sessions are validated locally by privileged API operations.
- Repeated SQLite sign-in failures are rate-limited by account and source IP.
- Ordinary application users never receive Linux or sudo accounts.
- Terminal endpoints require an administrator and current-password verification.
- Mutations through symbolic-link path components are rejected.
- Writes to `/proc`, `/sys`, `/dev` and `/run` are blocked by default.
- Uploads never replace an existing destination.
- Archive entry count, expanded size, compression ratio and destination free space are checked.
- Release archives are verified by size and SHA-256 before activation.
- The root recovery key is stored with mode `0600`.

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

Example local SQLite configuration:

```env
VITE_WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_SQLITE_PATH=./data/wfilemanager.db
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
