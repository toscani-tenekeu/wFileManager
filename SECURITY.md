# Security Policy

wFileManager is a privileged Linux administration application. A successful exploit may expose files, credentials, terminal access or the complete server.

## Supported versions

| Version | Support |
| --- | --- |
| Latest stable | Supported |
| Previous stable | Critical fixes when practical |
| Older versions | Not supported |
| `main` | Development only |

Install stable security updates promptly.

## Report vulnerabilities privately

Do not publish an unpatched vulnerability in an issue, discussion, pull request or social-media post.

Email:

```text
support.wfilemanager@kmerhosting.com
```

Suggested subject:

```text
SECURITY: short description
```

Include the affected version, Ubuntu version, deployment type, impact, reproduction steps and sanitized logs. Do not send real passwords, tokens, private keys, customer files or production database exports.

KmerHosting aims to acknowledge complete reports within 72 hours and coordinate remediation and disclosure. There is currently no formal paid bug-bounty program.

## Important security areas

Reports are especially relevant for:

- authentication or permission bypass;
- cross-user or cross-instance access;
- command injection or unauthorized terminal access;
- arbitrary file access, traversal or link attacks;
- unsafe archive extraction;
- session, password or recovery-token exposure;
- update verification or rollback bypass;
- persistent XSS in privileged pages;
- unsafe access to `/proc`, `/sys`, `/dev` or `/run`;
- weaknesses in the Community SQLite or Pro managed application-data backends.

Expected administrator capabilities are not vulnerabilities by themselves. A report must show access beyond the user's intended permissions or a bypass of a security boundary.

## Safe testing

Test only systems and data you own or have explicit permission to test.

Do not access other users' data, interrupt production, perform destructive tests, cause resource exhaustion, deploy malware, use social engineering or publicly disclose an unpatched issue. Stop testing if unexpected production access occurs.

## Deployment requirements

Production installations must:

- use a domain whose A record points to the server's public IPv4 address;
- use HTTPS on the entire session;
- keep port `1973` bound to localhost;
- protect SSH, root access and `/etc/wfilemanager`;
- restrict administrator accounts;
- apply Ubuntu and wFileManager updates;
- maintain independent server backups;
- remove unused users and sessions.

The systemd service runs as `root` by design. Compromise of the application or an administrator account may compromise the entire server.

## Authentication and application data

Administrator passwords require at least 12 alphanumeric characters, uppercase, lowercase and a number, with no identical consecutive characters. Validation must occur on the server.

There is no public password-reset page. Recovery is performed from a root shell:

```bash
sudo wfilemanager-reset-admin-password
```

Recovery files must remain readable only by root. Password recovery revokes existing sessions.

wFileManager supports:

- Community SQLite stored under `/var/lib/wfilemanager` on the user's server;
- Pro managed application data isolated by installation key.

Community SQLite must retain WAL mode, foreign keys, parameterized queries and root-only file permissions. Pro managed queries must retain installation and user isolation.

Pro backups and recovery cover wFileManager application records only. Files and other data on the server filesystem require a separate backup and recovery strategy.

## Filesystem and update protections

Do not weaken:

- path normalization and traversal rejection;
- archive absolute-path, link and device-entry checks;
- pseudo-filesystem write blocking;
- authentication before local privileged operations;
- command time and output limits;
- HTTPS release downloads;
- SHA-256 and size verification;
- versioned releases, health checks and rollback.

## Secrets

Never commit or publish:

- service-role keys;
- root recovery tokens;
- session tokens;
- password hashes or salts;
- `.env` files with secrets;
- SQLite databases or production dumps;
- SSH private keys or customer files.

Rotate exposed secrets immediately. Removing a secret from the latest commit does not remove it from Git history, logs, caches or forks.
