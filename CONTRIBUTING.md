# Contributing to wFileManager

wFileManager is a privileged Linux administration application. Keep changes focused, reviewable and tested. Report suspected vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

Never include production passwords, session tokens, recovery keys, managed-backend secrets, SQLite databases, customer files or private server configuration.

## Development

Requirements:

- Node.js 24
- Bun
- Python 3
- Linux; Ubuntu 24.04 LTS recommended

```bash
git clone https://github.com/toscani-tenekeu/wFileManager.git
cd wFileManager
cp .env.example .env
bun install
bun run dev
```

Use a unique development instance key. Never point development at a production instance.

Configure Community SQLite in `.env`:

```env
VITE_WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_DATABASE_MODE=sqlite
WFILEMANAGER_SQLITE_PATH=./data/wfilemanager.db
```

Use the `supabase` database mode only when testing the Pro managed application-data backend.

## Required checks

```bash
bun run lint
bun run typecheck
bun run build
```

Also test the modified behavior manually. A successful build is not sufficient for authentication, filesystem, archive, terminal, installer or update changes.

## Coding rules

- Validate client-controlled input on the server.
- Normalize filesystem paths before access.
- Use argument arrays instead of interpolated shell commands.
- Preserve blocks on writes to `/proc`, `/sys`, `/dev` and `/run`.
- Preserve archive traversal, link and device-entry checks.
- Keep port `1973` private and require HTTPS publicly.
- Never log credentials, tokens or private file contents.
- Revoke sessions after security-sensitive password operations.
- Keep persistent data outside versioned releases.
- Avoid new dependencies when the existing stack is sufficient.

## Database rules

Both data modes must expose equivalent application behavior.

For Community SQLite:

- use parameterized queries;
- keep WAL mode and foreign keys enabled;
- keep the database root-readable only;
- add migrations for schema changes;
- preserve self-managed backup and recovery behavior.

For the Pro managed backend:

- isolate every query by installation and user;
- keep service-role keys inside trusted Edge Functions only;
- use migrations for database changes;
- preserve automatic backup and recovery behavior;
- keep managed application records separate from files on the server filesystem.

## Installer and uninstaller rules

The normal installation command must remain:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

The installer must verify that the domain's A record resolves to the target server, configure HTTPS, offer Community SQLite on the user's server or Pro managed application data, verify release checksums and finish only after a successful health check.

The uninstaller must clearly distinguish between removing the application and data while keeping packages, and a full removal including packages installed by wFileManager.

## Pull requests

A pull request should include:

- the problem and solution;
- affected privilege or security boundaries;
- test commands and results;
- screenshots for visible changes;
- database migration and rollback notes when relevant;
- documentation updates when data-mode behavior changes.

Checklist:

- [ ] No secrets or production data are included.
- [ ] Lint, typecheck and build pass.
- [ ] Relevant manual tests pass.
- [ ] Filesystem and archive protections remain intact.
- [ ] Community and Pro data modes were considered.
- [ ] Server filesystem data remains separate from wFileManager application records.
- [ ] Documentation matches current behavior.

Contributions are provided under the project's MIT License.
