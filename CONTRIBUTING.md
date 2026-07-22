# Contributing to wFileManager

Thank you for contributing to wFileManager.

wFileManager is a privileged server-administration application. Changes that look small in the interface can affect authentication, Linux permissions, filesystem safety, terminal execution, update integrity, and complete-server security. Contributions must therefore be narrow, reviewable, and tested.

## Before contributing

Use the appropriate channel:

- Use a GitHub issue for confirmed bugs, feature proposals, documentation problems, and reproducible compatibility issues.
- Use a pull request for a focused implementation that can be reviewed independently.
- Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](./SECURITY.md).
- Do not include passwords, session tokens, instance reset tokens, Supabase keys, private server addresses, customer data, or real production configuration in an issue or pull request.

Search existing issues and pull requests before creating a duplicate.

## Supported contribution areas

Contributions are welcome for:

- file-explorer behavior and accessibility;
- archive creation and safe extraction;
- uploads, downloads, previews, and editing;
- storage and mount analysis;
- Linux account and permission handling;
- terminal reliability and safety;
- authentication, sessions, roles, and notifications;
- update verification and rollback;
- Ubuntu compatibility;
- tests, documentation, translations, and usability improvements.

Large architectural rewrites should be discussed in an issue before implementation.

## Development requirements

Use:

- Node.js 20 or newer;
- Bun;
- Python 3;
- Linux for testing filesystem, terminal, systemd, user, archive, and permission behavior.

Ubuntu 24.04 LTS is the recommended development and integration-test environment.

## Local development

```bash
git clone https://github.com/toscani-tenekeu/wFileManager.git
cd wFileManager
cp .env.example .env
bun install
bun run dev
```

Do not point a development checkout at a production instance key or production database unless the work specifically requires it and you control the environment.

Use a unique development instance key, for example:

```env
VITE_WFILEMANAGER_INSTANCE_KEY=wfm-development-yourname
WFILEMANAGER_INSTANCE_KEY=wfm-development-yourname
```

The browser-facing `VITE_` values are compiled into the application. Restart or rebuild after changing them.

## Required verification

Before submitting a pull request, run:

```bash
bun run lint
bun run typecheck
bun run build
```

Also run focused manual tests for the modified area.

Examples:

- Explorer changes: test files, directories, hidden items, selection, keyboard actions, context menus, and error states.
- Archive changes: test ZIP and TAR.GZ files, conflicts, several top-level entries, traversal attempts, links, and custom destinations.
- Authentication changes: test first-run setup, login, logout, short and persistent sessions, invalid credentials, and revoked sessions.
- Terminal changes: test normal-user commands, working-directory changes, cancellation, elevation, and rejected access.
- Update changes: test checksum failure, invalid manifests, failed builds, health-check failure, rollback, and interrupted updates.
- Storage changes: test regular disks, additional mounts, read-only filesystems, inaccessible mounts, and low-space conditions.

A build that succeeds is not sufficient for privileged filesystem or authentication changes.

## Branches and commits

Create a focused branch from the current `main` branch.

Recommended branch names:

```text
fix/archive-conflict-detection
feat/storage-home-usage
docs/security-reporting
```

Use clear imperative commit messages, for example:

```text
Fix archive conflict renaming
Add inode warning state
Document root password recovery
```

Avoid unrelated formatting or refactoring in the same commit as a behavioral fix.

## Coding rules

- Keep TypeScript types explicit at trust boundaries.
- Validate all client-controlled values on the server, even when the interface already validates them.
- Normalize and validate filesystem paths before access.
- Never construct shell commands by concatenating untrusted input.
- Prefer argument arrays with `execFile` or equivalent APIs over shell interpolation.
- Preserve the default blocks on writes to `/proc`, `/sys`, `/dev`, and `/run`.
- Do not weaken archive traversal, absolute-path, link, or device-entry protections.
- Do not expose the local Node.js port publicly.
- Do not log passwords, session tokens, reset tokens, service-role keys, complete authorization headers, or sensitive file contents.
- Keep session and notification data isolated by instance and user.
- Revoke or invalidate sessions after security-sensitive password operations.
- Preserve atomic update switching, checksum verification, health checks, and rollback behavior.
- Keep persistent data outside versioned release directories.
- Use existing UI primitives and design conventions before adding a new dependency.
- Add a dependency only when the same result cannot reasonably be achieved with the existing stack.

## Filesystem safety requirements

Changes involving paths, archives, trash, copy, move, extraction, upload, or download must consider:

- absolute paths;
- `..` traversal;
- repeated separators and normalization;
- symbolic links and link races;
- hard links;
- device and special files;
- inaccessible paths;
- mount boundaries;
- name conflicts;
- partial failure and cleanup;
- very large files and output limits;
- permission and ownership preservation;
- cancellation and interrupted operations.

Never remove a safety check merely to make a test pass. Correct the implementation or update the test with a documented reason.

## Authentication and password rules

The initial administrator password and root recovery password must:

- contain at least 12 characters;
- include uppercase and lowercase letters;
- include at least one number;
- contain only letters and numbers;
- not contain identical consecutive characters.

Client-side validation is for usability only. The authoritative validation must remain on the server.

Do not add a public password-reset link without a complete, reviewed recovery design. The supported recovery mechanism is the root-only server command.

## Database and Supabase changes

- Prefix project-specific database objects with `wfilemanager_`.
- Use migrations for schema changes.
- Do not hardcode generated database IDs.
- Keep instance isolation in every query.
- Keep user ownership checks for private resources.
- Use service-role credentials only in trusted server or Edge Function environments.
- Never place a service-role key in browser code, committed files, examples, screenshots, or logs.
- Document migration and rollback implications in the pull request.

## Update and release changes

Release publishing is restricted to maintainers.

A release-related contribution must preserve:

- HTTPS asset URLs;
- SHA-256 verification;
- release-size verification;
- safe archive-path validation;
- versioned installation directories;
- atomic symlink switching;
- post-start health checks;
- automatic rollback;
- persistent configuration and data directories.

Do not commit `.output/`, `node_modules/`, private `.env` files, release secrets, or generated production credentials.

## Documentation changes

Documentation must describe current behavior rather than planned behavior. Commands should be directly usable and should clearly state when root privileges, a domain, HTTPS, or a destructive action is involved.

Keep the standard user installation path simple:

```bash
curl -fsSL https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/install.sh | sudo bash
```

Advanced development, migration, and release-maintenance commands should not replace the normal installation instructions.

## Pull-request requirements

A pull request should include:

- a concise description of the problem;
- the implemented solution;
- the affected security or privilege boundaries;
- test commands and manual test results;
- screenshots for visible interface changes;
- migration notes when persistent data changes;
- rollback notes for update, schema, or deployment changes;
- known limitations or follow-up work.

Keep pull requests small enough to review. A reviewer may request that unrelated changes be split into separate pull requests.

## Pull-request checklist

- [ ] The change has a single clear purpose.
- [ ] No secrets or production data are included.
- [ ] `bun run lint` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run build` passes.
- [ ] Relevant manual tests were completed.
- [ ] Trust-boundary validation exists on the server.
- [ ] Filesystem and archive safety checks remain intact.
- [ ] Authentication and instance isolation remain intact.
- [ ] Documentation was updated when behavior changed.
- [ ] The change is compatible with the MIT License.

## Review and acceptance

Submitting a contribution does not guarantee acceptance. Maintainers may reject changes that increase the privileged attack surface without sufficient benefit, duplicate existing functionality, weaken security controls, introduce unnecessary dependencies, or are not maintainable within the project scope.

By contributing, you agree that your contribution is provided under the project’s [MIT License](./LICENSE).