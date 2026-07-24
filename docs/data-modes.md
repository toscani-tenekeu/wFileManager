# Application-data modes

wFileManager separates application records from the files managed on the server filesystem.

Application records include:

- users and roles;
- sessions and authentication information;
- notifications;
- application settings;
- related wFileManager metadata.

Files, directories, databases and other content displayed by the file manager remain on your server in both modes.

## Community — SQLite on your server

Community is free forever and does not require a paid licence or subscription.

Application records are stored locally in:

```text
/var/lib/wfilemanager/wfilemanager.db
```

You are responsible for database backups, restores, migrations, maintenance and recovery after reinstalling or replacing the server.

Community includes all wFileManager features and community support.

## Pro — Managed application data

Pro costs **$50 USD per instance per year** and includes **100 MB** of managed application storage.

Pro provides:

- managed users, roles, sessions and authentication records;
- managed notifications, settings and related application records;
- automatic backups of wFileManager application data;
- recovery tools for reconnecting a replacement installation;
- restoration of managed application records after a server reinstall;
- priority support.

Additional managed storage costs **$1 USD per 100 MB per year**.

## Storage scope

Pro storage does not include files from the server filesystem. wFileManager is a management layer above the filesystem; it does not replace a server backup system.

Maintain an independent backup and recovery strategy for:

- user files and directories;
- website and application content;
- server databases;
- configuration outside wFileManager application records;
- mounted storage and external volumes.

## Installation requirement

Before installing wFileManager, point your domain's A record to the public IPv4 address of the target server. Wait until the domain resolves to that address, then run the official installer.

Supported deployment types include KVM virtual machines, bare-metal servers and LXC containers with systemd and root access.
