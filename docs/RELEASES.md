# wFileManager release procedure

## Canonical artifact

The `Publish GitHub release` workflow runs only after CI succeeds on `main`. It creates one canonical
application archive named `wfilemanager-VERSION.tar.gz` and publishes its SHA-256 checksum and size.
Do not rebuild the archive for another channel.

## Stable channel order

1. Merge a versioned change after build, typecheck, tests, lint and shell validation pass.
2. Wait for the CI-gated GitHub release.
3. Download that exact GitHub release asset and verify `SHA256SUMS`.
4. Upload the same bytes to `releases.kmerhosting.com/wfilemanager/` if a mirror is required.
5. Upload `install.sh`, `update.sh`, service units and `uninstall.sh`.
6. Publish `stable.json` last with the canonical archive URL, checksum and byte size.
7. Verify the public manifest and every referenced asset.
8. Test a clean installation, update and rollback.

Publishing `stable.json` last prevents clients from observing an incomplete release.

## Manual update

```bash
sudo systemctl start wfilemanager-updater@install.service
sudo journalctl -u wfilemanager-updater@install.service -f
```

## Manual rollback

```bash
sudo systemctl start wfilemanager-updater@rollback.service
```
