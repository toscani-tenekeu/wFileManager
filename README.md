# wFileManager

wFileManager is a browser-based file manager for Ubuntu servers. It provides filesystem browsing,
uploads and downloads, guarded archive handling, per-user trash, application users and roles,
notifications, verified updates, rollback and an administrator-only root terminal.

## Community edition

wFileManager has one edition. It is free, MIT licensed and stores its application records locally
in SQLite at:

```text
/var/lib/wfilemanager/wfilemanager.db
```

The server administrator is responsible for backing up and restoring that database as well as the
server files, websites and databases managed through the application.

## Install

Requirements: Ubuntu 20.04 LTS or newer, root access, systemd, a public IPv4 address and a domain
whose A record points to the server.

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

The installer verifies DNS, installs prerequisites, configures Nginx and HTTPS, downloads a verified
release and opens `/setup` for the first local administrator.

## Operations

```bash
sudo systemctl status wfilemanager
sudo journalctl -u wfilemanager -f
curl -fsS http://127.0.0.1:1973/api/health | jq
sudo systemctl start wfilemanager-updater@install.service
sudo systemctl start wfilemanager-updater@rollback.service
sudo wfilemanager-reset-admin-password
sudo wfilemanager-uninstall
```

The updater validates release size and SHA-256, builds in a separate directory, switches the active
release atomically and rolls back automatically if the health check fails.

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run lint
```

Security reports: `support@kmerhosting.com`.
