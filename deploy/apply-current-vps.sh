#!/usr/bin/env bash
set -Eeuo pipefail

BUNDLE="${1:-/root/wfilemanager-v0.6.6-bundle.zip}"
PUBLISHER_URL="https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/wfilemanager-release-publisher"
PUBLISH_TOKEN="a551855347a386cad0b4e246e352a4002a51319b3a821e929b5c707d5f5fb45f"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -f "$BUNDLE" ]] || { echo "Bundle not found: $BUNDLE" >&2; exit 1; }
missing_packages=()
command -v unzip >/dev/null 2>&1 || missing_packages+=(unzip)
command -v curl >/dev/null 2>&1 || missing_packages+=(curl)
command -v python3 >/dev/null 2>&1 || missing_packages+=(python3)
command -v sha256sum >/dev/null 2>&1 || missing_packages+=(coreutils)
if ((${#missing_packages[@]})); then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing_packages[@]}"
fi
unzip -q "$BUNDLE" -d "$TMP"
ASSETS="$(find "$TMP" -type d -name release-assets | head -n1)"
[[ -n "$ASSETS" ]] || { echo "release-assets directory not found in bundle" >&2; exit 1; }

(
  cd "$ASSETS"
  sha256sum -c SHA256SUMS
)

upload() {
  local name="$1" content_type="$2"
  echo "Publishing $name..."
  curl -fsS --retry 3 -X PUT \
    "$PUBLISHER_URL?path=wfilemanager/$name" \
    -H "x-publish-token: $PUBLISH_TOKEN" \
    -H "Content-Type: $content_type" \
    --data-binary "@$ASSETS/$name" >/dev/null
}

# Publish immutable assets first. stable.json is always uploaded last.
upload "wfilemanager-0.6.6.tar.gz" "application/gzip"
upload "install.sh" "text/x-shellscript"
upload "update.sh" "text/x-shellscript"
upload "wfilemanager.service" "text/plain"
upload "wfilemanager-updater@.service" "text/plain"
upload "migrate-existing-vps.sh" "text/x-shellscript"
upload "SHA256SUMS" "text/plain"
upload "stable.json" "application/json"

curl -fsS "$PUBLISHER_URL" -H "x-publish-token: $PUBLISH_TOKEN" > "$TMP/published.json"
python3 - <<'PY' "$TMP/published.json"
import json, sys
value=json.load(open(sys.argv[1]))
names={item.get('name') for item in value.get('files', [])}
required={'stable.json','install.sh','update.sh','wfilemanager-0.6.6.tar.gz','wfilemanager.service','wfilemanager-updater@.service','migrate-existing-vps.sh'}
missing=sorted(required-names)
if missing:
    raise SystemExit('Missing published objects: '+', '.join(missing))
print('Supabase release objects verified:', ', '.join(sorted(required)))
PY

# Disable the one-time publisher token after a successful publication.
curl -fsS -X POST "$PUBLISHER_URL?finalize=true" -H "x-publish-token: $PUBLISH_TOKEN" >/dev/null

echo "Migrating the current VPS to the versioned release layout..."
bash "$ASSETS/migrate-existing-vps.sh"

echo
echo "Release publication and VPS migration completed."
echo "Stable manifest: https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/stable.json"
echo "Application: https://wfilemanager.kmerhosting.com"
