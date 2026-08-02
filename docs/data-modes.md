# Application data

wFileManager stores users, roles, sessions, authentication records, notifications and settings in
SQLite on the server:

```text
/var/lib/wfilemanager/wfilemanager.db
```

The application does not provide a hosted data plan or remote filesystem backup service. The server
administrator is responsible for SQLite backups, restores, migrations, maintenance, local disk
availability and disaster recovery.

Server filesystem content is separate from the wFileManager SQLite database. Maintain an independent,
tested backup policy for websites, databases, uploads, mounted volumes and operating-system state.
