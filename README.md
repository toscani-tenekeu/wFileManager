# wFileManager

**A modern and open source file manager for Linux servers.**  
A project from **KmerHosting LLC**.

wFileManager provides a web file explorer, archives, trash, storage analysis, users, roles, notifications, verified updates and a real Linux terminal.

> wFileManager runs with elevated privileges. Install it only on a server you control and give administrator access only to trusted users.

## Requirements

- Ubuntu 20.04 LTS or newer; Ubuntu 24.04 LTS recommended
- KVM, bare metal, or LXC with systemd and root access
- `amd64` or `arm64`
- A domain with an **A record pointing to the server's current public IPv4**
- Public ports `80` and `443`

Installation by IP address or plain HTTP is not supported. The installer validates DNS before changing the server and configures HTTPS with Certbot.

Do not have a domain or subdomain for testing? You can request a free test subdomain at [domain.kmerhosting.com](https://domain.kmerhosting.com). Point its A record to the VPS public IPv4 and wait for DNS propagation before installing.

## Install

Create the DNS A record first, wait until it resolves to the VPS, then run:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

The installer asks for:

1. the domain;
2. the database mode.

### Slow Ubuntu package downloads

The installer uses Ubuntu's configured APT mirror. Downloading package indexes can take several minutes. If the byte counter is still increasing, let it finish.

If the download remains at exactly the same byte count for more than five minutes, the configured mirror may be slow. On an Ubuntu 24.04 VPS located in or near Germany, switch to the German mirror:

```bash
sudo sed -i 's|http://archive.ubuntu.com/ubuntu|http://de.archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources
sudo apt-get clean
```

Then run the official installer again. It reuses the previously selected domain, database mode and instance identity. `apt-get clean` only clears downloaded package files; the speed improvement comes from using a closer or less congested mirror.

For VPS locations outside Germany, use an official Ubuntu mirror geographically close to the server instead of `de.archive.ubuntu.com`.

### Database modes

**KmerHosting managed Supabase — fastest setup and best for testing**

Supabase is automatically configured and no Supabase key is requested. Accounts, roles, sessions and notifications are stored remotely in the Supabase project managed by KmerHosting.

This mode provides the fastest installation and reduces the risk of losing application data if the VPS disk is lost or reinstalled. It is intended for quick deployment, evaluation and testing. Each server is limited to **100 MB of Supabase application data**.

**SQLite on this VPS — recommended for long-term installations**

SQLite keeps the application database entirely on your VPS and gives you full control over its storage, backups and retention. Application data is stored locally in:

```text
/var/lib/wfilemanager/wfilemanager.db
```

Use SQLite for a durable production installation, preferably with your own domain and regular VPS backups. The database uses WAL mode, foreign keys and parameterized queries.

For quick testing, use a free test subdomain and managed Supabase. For a long-term deployment, prefer your own domain and SQLite.

Files managed through the explorer always remain on the VPS in both modes. The database choice only affects accounts, roles, sessions, notifications and related application records.

After installation, open:

```text
https://your-domain.example/setup
```

The administrator password must contain at least 12 letters or numbers, including uppercase, lowercase and a number. Special characters and identical consecutive characters are rejected.

## Main features

- Real Linux filesystem browsing from `/`
- Multiple selection, context menus, copy, move, rename and delete
- Uploads and downloads with progress
- Text preview and editing
- ZIP and TAR.GZ creation and safe extraction
- Traversal, unsafe-link and archive-device protections
- Trash, restore and permanent deletion
- Mounted-volume, inode, extension and home-directory analysis
- Interactive PTY terminal
- Linux user provisioning
- Application users, roles and permissions
- Account sessions, notifications and presence
- Stable updates with SHA-256 verification, health checks and rollback
- Root-shell administrator password recovery

## Commands

Service status:

```bash
sudo systemctl status wfilemanager.service --no-pager
```

Logs:

```bash
sudo journalctl -u wfilemanager.service -f
```

Reset an administrator password:

```bash
sudo wfilemanager-reset-admin-password
```

The command asks for the new administrator password and its confirmation. Password input is intentionally invisible while typing: no characters, dots or asterisks are displayed.

Update the wFileManager application:

```bash
sudo systemctl start wfilemanager-updater@install.service
```

This updates the application to the latest stable release. The updater downloads and verifies the release, installs it, restarts wFileManager and performs a health check.

Rollback the wFileManager application:

```bash
sudo systemctl start wfilemanager-updater@rollback.service
```

This restores the previous application release and restarts wFileManager. Persistent configuration and application data are preserved.

## Uninstall and delete data

The application reminds the administrator after installation that it can be removed at any time:

```bash
sudo wfilemanager-uninstall
```

The interactive uninstaller offers:

1. remove wFileManager, its data and configuration while keeping system packages;
2. remove wFileManager, its data and configuration, then remove packages installed only by wFileManager;
3. cancel.

SQLite data is deleted locally. In managed Supabase mode, the uninstaller also requests deletion of the installation's remote application records using the root-only recovery token.

## Persistent locations

```text
/opt/wfilemanager/                    Application releases
/etc/wfilemanager/                    Configuration and recovery key
/var/lib/wfilemanager/                SQLite, trash and update state
/usr/local/lib/wfilemanager/          Updater
/usr/local/sbin/wfilemanager-*        Root administration commands
/etc/nginx/sites-available/wfilemanager
```

Updates preserve `/etc/wfilemanager` and `/var/lib/wfilemanager`.

## Security essentials

- Port `1973` remains bound to `127.0.0.1`.
- Public access is HTTPS-only through Nginx.
- Every installation receives a unique persistent instance key.
- Writes to `/proc`, `/sys`, `/dev` and `/run` are blocked by default.
- Update archives are checked by size and SHA-256 before activation.
- A failed update is rolled back automatically.
- The root recovery key is stored with mode `0600`.
- Never publish session tokens, recovery keys, database files or service-role keys.

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
bun run build
```

Set the backend in `.env`:

```env
VITE_WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_SQLITE_PATH=./data/wfilemanager.db
```

Use `supabase` instead of `sqlite` to test the managed backend. Do not use production credentials or instance keys during development.

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
