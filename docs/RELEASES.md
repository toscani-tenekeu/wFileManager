# wFileManager release procedure

wFileManager deliberately does not use GitHub Actions. Stable releases are built, tested and published manually.

## Public channel

- Bucket: `releases.kmerhosting.com`
- Folder: `wfilemanager/`
- Manifest: `wfilemanager/stable.json`
- Application archive: `wfilemanager/wfilemanager-VERSION.tar.gz`

The application reads the public Supabase Storage manifest. The branded hostname `releases.kmerhosting.com` can proxy the same files, but the Supabase public URL remains the technical source of truth unless the manifest is changed.

## Required order

1. Change the version in `package.json`.
2. Run `bun install`, `bun run build` and `bun run typecheck`.
3. Create the source release archive.
4. Calculate its SHA-256 checksum and byte size.
5. Update `release/stable.json` and `release/SHA256SUMS`.
6. Upload the versioned archive and support scripts.
7. Upload `stable.json` last.
8. Verify every public URL and checksum.
9. Test installation on a clean Ubuntu system.
10. Test update and rollback on an existing installation.

Uploading `stable.json` last prevents clients from seeing a release whose archive or support files are incomplete.

## Installed layout

```text
/etc/wfilemanager/wfilemanager.env
/opt/wfilemanager/releases/VERSION/
/opt/wfilemanager/current -> /opt/wfilemanager/releases/VERSION
/usr/local/lib/wfilemanager/update.sh
/var/lib/wfilemanager/trash/
/var/lib/wfilemanager/update/state.json
```

## Manual update

```bash
sudo systemctl start wfilemanager-updater@install.service
sudo journalctl -u wfilemanager-updater@install.service -f
```

## Manual rollback

```bash
sudo systemctl start wfilemanager-updater@rollback.service
```

The updater verifies SHA-256, builds the release in a new directory, switches the `current` symlink atomically, restarts the application and performs a local health check. If the health check fails, the previous symlink is restored automatically.
