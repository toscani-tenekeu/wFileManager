#!/usr/bin/env bash
set -Eeuo pipefail

ASSET_DIR="${1:-release-assets}"
SUPABASE_URL="${SUPABASE_URL:-https://igihzeyfgwhnuiflamvn.supabase.co}"
BUCKET="${WFILEMANAGER_RELEASE_BUCKET:-releases.kmerhosting.com}"
PREFIX="${WFILEMANAGER_RELEASE_PREFIX:-wfilemanager}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

[[ -n "$SERVICE_KEY" ]] || { echo "Set SUPABASE_SERVICE_ROLE_KEY in the environment." >&2; exit 1; }
[[ -d "$ASSET_DIR" ]] || { echo "Release asset directory not found: $ASSET_DIR" >&2; exit 1; }
[[ -f "$ASSET_DIR/stable.json" && -f "$ASSET_DIR/SHA256SUMS" ]] || { echo "stable.json and SHA256SUMS are required." >&2; exit 1; }

(
  cd "$ASSET_DIR"
  sha256sum -c SHA256SUMS
)

upload() {
  local name="$1" content_type="$2"
  echo "Uploading $PREFIX/$name"
  curl -fsS --retry 3 -X POST \
    "$SUPABASE_URL/storage/v1/object/$BUCKET/$PREFIX/$name" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "apikey: $SERVICE_KEY" \
    -H "x-upsert: true" \
    -H "Content-Type: $content_type" \
    --data-binary "@$ASSET_DIR/$name" >/dev/null
}

# Never publish the manifest before every file it references is available.
upload "$(jq -r '.releaseUrl | split("/") | last' "$ASSET_DIR/stable.json")" "application/gzip"
upload install.sh text/x-shellscript
upload update.sh text/x-shellscript
upload wfilemanager.service text/plain
upload 'wfilemanager-updater@.service' text/plain
upload migrate-existing-vps.sh text/x-shellscript
upload SHA256SUMS text/plain
upload stable.json application/json

PUBLIC_BASE="$SUPABASE_URL/storage/v1/object/public/$BUCKET/$PREFIX"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 "$PUBLIC_BASE/stable.json?ts=$(date +%s)" -o "$TMP/stable.json"
VERSION="$(jq -r '.version' "$TMP/stable.json")"
EXPECTED="$(jq -r '.sha256' "$TMP/stable.json")"
RELEASE_NAME="$(jq -r '.releaseUrl | split("/") | last' "$TMP/stable.json")"
curl -fsSL --retry 3 "$PUBLIC_BASE/$RELEASE_NAME" -o "$TMP/$RELEASE_NAME"
printf '%s  %s\n' "$EXPECTED" "$TMP/$RELEASE_NAME" | sha256sum -c -
echo "wFileManager $VERSION published successfully."
