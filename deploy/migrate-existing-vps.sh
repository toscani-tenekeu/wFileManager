#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${DOMAIN:-wfilemanager.kmerhosting.com}"
PORT="${PORT:-1973}"
OLD_APP="${OLD_APP:-/opt/$DOMAIN}"
APP_ROOT="/opt/wfilemanager"
CONFIG_DIR="/etc/wfilemanager"
ENV_FILE="$CONFIG_DIR/wfilemanager.env"
MANIFEST_URL="${WFILEMANAGER_UPDATE_MANIFEST_URL:-https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/stable.json}"
SUPABASE_URL="https://igihzeyfgwhnuiflamvn.supabase.co"
INSTANCE_KEY="wfilemanager-kmerhosting-com"

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates jq tar gzip xz-utils build-essential python3 make g++ sudo passwd util-linux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

install -d -m 755 "$APP_ROOT/releases" "$CONFIG_DIR" /usr/local/lib/wfilemanager
install -d -m 700 /var/lib/wfilemanager/trash /var/lib/wfilemanager/update

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [[ -f "$OLD_APP/.env" ]]; then cp "$OLD_APP/.env" "$TMP/old.env"; fi
if [[ -f /etc/systemd/system/wfilemanager.service ]]; then
  cp -a /etc/systemd/system/wfilemanager.service "$TMP/wfilemanager.service.old"
fi

cat > "$ENV_FILE" <<ENV
PORT=$PORT
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
WFILEMANAGER_SUPABASE_URL=$SUPABASE_URL
WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=false
WFILEMANAGER_TRASH_DIR=/var/lib/wfilemanager/trash
WFILEMANAGER_UPDATE_MANIFEST_URL=$MANIFEST_URL
WFILEMANAGER_UPDATE_STATE_FILE=/var/lib/wfilemanager/update/state.json
WFILEMANAGER_UPDATE_SCRIPT=/usr/local/lib/wfilemanager/update.sh
WFILEMANAGER_HEALTH_URL=http://127.0.0.1:$PORT/
WFILEMANAGER_SERVICE=wfilemanager.service
ENV
if [[ -f "$TMP/old.env" ]]; then
  while IFS= read -r line; do
    key="${line%%=*}"
    case "$key" in VITE_SUPABASE_URL|VITE_WFILEMANAGER_INSTANCE_KEY|WFILEMANAGER_SUPABASE_URL|WFILEMANAGER_INSTANCE_KEY) sed -i "/^${key}=/d" "$ENV_FILE"; echo "$line" >> "$ENV_FILE";; esac
  done < "$TMP/old.env"
fi
chmod 600 "$ENV_FILE"

curl -fsSL --retry 3 "$MANIFEST_URL" -o "$TMP/stable.json"
for item in updater updaterService appService; do
  url="$(jq -r ".assets.$item // empty" "$TMP/stable.json")"
  sha="$(jq -r ".assets.${item}Sha256 // empty" "$TMP/stable.json")"
  [[ "$url" == https://* && "$sha" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "Invalid $item asset in stable manifest" >&2; exit 1; }
  case "$item" in updater) dest=/usr/local/lib/wfilemanager/update.sh;; updaterService) dest=/etc/systemd/system/wfilemanager-updater@.service;; appService) dest=/etc/systemd/system/wfilemanager.service;; esac
  curl -fsSL --retry 3 "$url" -o "$dest"
  printf '%s  %s\n' "${sha,,}" "$dest" | sha256sum -c -
done
chmod 750 /usr/local/lib/wfilemanager/update.sh

systemctl stop wfilemanager.service 2>/dev/null || true
LEGACY=""
if [[ -d "$OLD_APP" && ! -L "$OLD_APP" ]]; then
  LEGACY="$APP_ROOT/legacy-$(date +%Y%m%d-%H%M%S)"
  mv "$OLD_APP" "$LEGACY"
fi
ln -sfn "$APP_ROOT/current" "$OLD_APP"
systemctl daemon-reload
systemctl enable wfilemanager.service

if ! /usr/local/lib/wfilemanager/update.sh install; then
  echo "Initial release installation failed; restoring the previous deployment." >&2
  rm -f "$OLD_APP"
  if [[ -n "$LEGACY" && -d "$LEGACY" ]]; then mv "$LEGACY" "$OLD_APP"; fi
  if [[ -f "$TMP/wfilemanager.service.old" ]]; then
    cp -a "$TMP/wfilemanager.service.old" /etc/systemd/system/wfilemanager.service
  fi
  systemctl daemon-reload
  systemctl restart wfilemanager.service 2>/dev/null || true
  exit 1
fi

systemctl restart wfilemanager.service
sleep 3
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null
nginx -t && systemctl reload nginx

echo "Migration completed. wFileManager is running at https://$DOMAIN"
echo "Release root: $APP_ROOT"
echo "Persistent configuration: $ENV_FILE"
