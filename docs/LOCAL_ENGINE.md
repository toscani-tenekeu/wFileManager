# Local engine status

The local engine is implemented inside the TanStack Start Node server at `/api/local`.

Implemented operations:

- list directories
- read and save text files
- create files and directories
- upload and download files
- rename, copy and move
- move to trash, restore, permanent trash deletion and empty trash
- chmod
- system summary
- command execution

Every request requires the custom bearer token issued by the `wfilemanager-api` Supabase Edge Function. The local engine calls the Edge Function's `me` action and permits only active administrators.

The terminal now uses a persistent Linux PTY rendered with xterm.js. It supports interactive programs, terminal resizing, multiple tabs, and live input/output. The browser currently exchanges PTY data through short authenticated polling requests rather than a WebSocket.

## v0.4 terminal identity model

Each active wFileManager account is mapped to a dedicated Ubuntu account named `wfm_<username>_<id>`. The local account is created with a home directory, Bash login shell and membership in the `sudo` group. Its password is synchronized when the user logs in, when an administrator creates the user, or when the user confirms root elevation.

Terminal tabs start under the dedicated Linux UID/GID. Root tabs are created only after the current wFileManager password is verified by the custom Supabase Edge Function. No Supabase Auth user is involved.

## Transfer progress

Uploads use XMLHttpRequest upload events and can be aborted. The server writes to a temporary `.part` file and removes it when the request is cancelled. Downloads consume the response stream in the browser, update progress from `Content-Length`, and support `AbortController` cancellation before the final browser save is triggered.

## v0.5 trash model

Deleted entries are moved into a private per-user directory under `/var/lib/wfilemanager/trash`. Each trash item contains an opaque payload and a protected metadata file with its original path, deletion time, user, size and filesystem kind. Restoring recreates a missing parent directory when needed and refuses to overwrite an existing path.
