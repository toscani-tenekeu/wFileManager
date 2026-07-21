# Supabase status

Project: `kmerhosting`

Project ID: `igihzeyfgwhnuiflamvn`

wFileManager does not use Supabase Auth. Users and opaque sessions are stored in ordinary application tables.

## Deployed database objects

- `wfilemanager_instances`
- `wfilemanager_roles`
- `wfilemanager_users`
- `wfilemanager_sessions`
- `wfilemanager_path_rules`
- `wfilemanager_settings`
- `wfilemanager_audit_logs`

## Deployed Edge Function

`wfilemanager-api`

Implemented actions:

- installation status
- first administrator setup
- login
- current session
- logout
- list users
- create a standard user
- audit log retrieval

Passwords are currently derived with PBKDF2-SHA-256 and unique salts. Session tokens are opaque and only their SHA-256 hashes are stored.

## Current boundary

Supabase stores application accounts, sessions, roles, path policies, settings and audit metadata. It does not access the Ubuntu filesystem. The existing File Explorer remains in safe demonstration mode until a local privileged Ubuntu agent is implemented and connected.
