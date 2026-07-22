# Security Policy

wFileManager is a privileged Linux server-administration application. A vulnerability may expose files, credentials, user accounts, terminal access, or the complete server. Security reports must therefore be handled privately and responsibly.

## Supported versions

| Version | Security support |
| --- | --- |
| Latest stable release | Supported |
| Previous stable release | Best-effort critical fixes only |
| Older releases | Not supported |
| `main` development branch | Not recommended for production |

Install security updates promptly. Reports affecting unsupported versions may be closed after confirming that the issue is fixed in the latest stable release.

## Reporting a vulnerability

Do not create a public GitHub issue, discussion, pull request, or social-media post for an unpatched vulnerability.

Send the report privately to:

```text
support.wfilemanager@kmerhosting.com
```

Use a subject such as:

```text
SECURITY: short description of the issue
```

When GitHub private vulnerability reporting is available for the repository, it may also be used.

Do not send real passwords, service-role keys, session tokens, root reset tokens, private keys, customer files, or complete production database exports. Replace sensitive values with safe test values.

## Information to include

A useful report should contain:

- the affected wFileManager version or commit;
- the Ubuntu version and architecture;
- whether the installation runs on bare metal, KVM, LXC, or another environment;
- the affected component or route;
- a clear impact description;
- exact reproduction steps using a safe test environment;
- the minimum privileges required to reproduce the issue;
- relevant request and response details with secrets removed;
- logs with credentials and private data removed;
- a proof of concept when needed to demonstrate impact;
- suggested remediation when available;
- whether the issue has been disclosed to anyone else.

Screenshots are useful for interface issues but should not expose server paths, usernames, tokens, or customer data unnecessarily.

## Response process

KmerHosting LLC aims to:

- acknowledge a complete report within 72 hours;
- confirm whether the issue can be reproduced;
- assess severity and affected versions;
- prepare a fix and regression tests;
- publish an updated stable release when appropriate;
- coordinate disclosure with the reporter.

Complex issues may require more time. Reporters should avoid disclosure until a fix is available or a coordinated disclosure date has been agreed.

The project does not currently promise monetary rewards or operate a formal bug-bounty program.

## Security-sensitive areas

Reports are especially important when they involve:

- authentication bypass;
- session theft, fixation, or cross-instance access;
- privilege escalation;
- unauthorized terminal access;
- command injection;
- arbitrary file read, write, upload, download, move, or deletion;
- path traversal or unsafe path normalization;
- symbolic-link or hard-link attacks;
- archive traversal or unsafe archive extraction;
- exposure of service-role keys, reset tokens, passwords, or authorization headers;
- cross-user notification, account, session, or file access;
- missing instance isolation;
- password-policy bypass on the server;
- administrator root-recovery bypass;
- update-manifest or release-asset tampering;
- checksum, size-verification, health-check, or rollback bypass;
- persistent cross-site scripting in privileged pages;
- request forgery that reaches internal or privileged services;
- unsafe handling of pseudo-filesystems such as `/proc`, `/sys`, `/dev`, or `/run`;
- Linux ownership, permission, user, or sudo-account vulnerabilities.

## Safe testing rules

Security research must be performed only on systems and data you own or have explicit permission to test.

Do not:

- test against KmerHosting customers or third-party installations;
- access, modify, download, or delete data belonging to another person;
- interrupt production services;
- perform destructive testing on a production server;
- use denial-of-service techniques that consume excessive CPU, RAM, disk, network, processes, or database resources;
- deploy malware, persistence mechanisms, ransomware, cryptocurrency miners, or destructive payloads;
- use social engineering, phishing, credential stuffing, or physical attacks;
- publicly disclose an unpatched vulnerability;
- retain data obtained accidentally during testing.

Stop testing and report immediately if you gain access to unexpected production data, credentials, or systems.

## Scope guidance

Generally in scope:

- the wFileManager application code;
- official installation and update scripts;
- official systemd and Nginx configurations shipped by the project;
- wFileManager Supabase Edge Functions and prefixed database objects;
- official release manifests and update verification;
- the root-only administrator password recovery mechanism.

Generally out of scope unless a concrete wFileManager vulnerability is demonstrated:

- unsupported operating systems;
- installations modified by third parties;
- outdated releases after an update is available;
- intentionally public port `1973` exposure caused by administrator configuration;
- missing HTTPS when the administrator chose to expose the service over plain HTTP;
- weak server SSH credentials or compromised root access;
- vulnerabilities in Ubuntu, Nginx, Node.js, Bun, browsers, or dependencies without a wFileManager-specific exploit path;
- local root modifying wFileManager files, configuration, recovery keys, or systemd services;
- expected administrator capabilities, including reading files and executing privileged commands;
- reports based only on automated scanner output without reproducible impact;
- clickjacking or security-header suggestions without a meaningful exploit;
- self-XSS that cannot affect another user;
- rate-limit observations without a practical security impact;
- denial of service requiring existing root access;
- social engineering and physical attacks.

Because wFileManager is designed to administer a server, actions performed by an authenticated and authorized administrator are not automatically vulnerabilities. A report must show that a user can exceed their intended permissions, cross an instance or user boundary, bypass authentication, or compromise update and recovery controls.

## Password and recovery security

The initial administrator and root-recovery password policy requires:

- at least 12 characters;
- an uppercase letter;
- a lowercase letter;
- a number;
- letters and numbers only;
- no identical consecutive characters.

The policy must be enforced by the trusted server component, not only by the browser interface.

wFileManager intentionally does not expose a public “Forgot password” page. Administrator recovery is performed from the server’s root shell using:

```bash
sudo wfilemanager-reset-admin-password
```

The recovery token must remain root-readable only. A successful administrator password reset revokes existing wFileManager sessions.

The recovery command changes the wFileManager application password. It does not change the Linux `root` password.

## Deployment security responsibilities

Server administrators are responsible for:

- using a supported Ubuntu release;
- applying Ubuntu and wFileManager updates;
- placing the application behind HTTPS;
- keeping port `1973` bound to localhost and inaccessible publicly;
- protecting SSH and root access;
- restricting administrator accounts;
- assigning a unique instance key to each server;
- protecting `/etc/wfilemanager` and recovery files;
- maintaining independent backups;
- monitoring logs and disk usage;
- removing unused users and sessions;
- verifying DNS before enabling Certbot;
- reviewing third-party changes before deployment.

The systemd service runs as `root` by design. Compromise of the application or an administrator account may therefore compromise the entire server.

## Filesystem and archive protections

The project is expected to preserve the following protections:

- normalization and validation of server paths;
- rejection of parent-directory traversal;
- rejection of unsafe absolute archive paths;
- rejection of symbolic links, hard links, and device entries during extraction;
- conflict handling before replacement;
- default blocking of writes to `/proc`, `/sys`, `/dev`, and `/run`;
- limits on command execution time and captured output;
- authentication and permission checks before privileged local operations.

A contribution that weakens one of these controls requires explicit security review.

## Update integrity

Official updates use:

- HTTPS downloads;
- a stable release manifest;
- SHA-256 checksums;
- expected release sizes;
- safe archive-path validation;
- versioned release directories;
- atomic active-release switching;
- local health checks;
- automatic rollback after failure.

Do not install releases from an untrusted manifest or disable verification to work around an update failure. Investigate the failure and confirm the expected release source.

## Secret handling

Never publish or commit:

- Supabase service-role keys;
- root recovery tokens;
- password hashes or salts from production;
- session tokens;
- authorization headers;
- `.env` files containing secrets;
- private SSH keys;
- production database dumps;
- customer files;
- real administrator passwords.

A root recovery token should remain in a root-only file with mode `0600`. Only its cryptographic hash should be stored remotely for verification.

If a secret is exposed, rotate or revoke it immediately. Removing it from the latest Git commit is not sufficient because it may remain in Git history, caches, logs, or forks.

## Disclosure and credit

After a fix is available, the project may publish a security advisory describing the affected versions, impact, remediation, and reporter credit. Credit is provided only with the reporter’s consent.

Public disclosure before a fix may reduce or eliminate the ability to coordinate remediation and protect installations.