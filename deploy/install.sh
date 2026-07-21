#!/usr/bin/env bash
set -Eeuo pipefail

MANIFEST_URL="${WFILEMANAGER_UPDATE_MANIFEST_URL:-https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/stable.json}"
SUPABASE_URL="${WFILEMANAGER_SUPABASE_URL:-https://igihzeyfgwhnuiflamvn.supabase.co}"
PORT="${PORT:-1973}"
DOMAIN="${DOMAIN:-}"
ENABLE_SSL="${ENABLE_SSL:-auto}"
APP_ROOT="/opt/wfilemanager"
CONFIG_DIR="/etc/wfilemanager"
ENV_FILE="$CONFIG_DIR/wfilemanager.env"
STATE_ROOT="/var/lib/wfilemanager"

[[ $EUID -eq 0 ]] || { echo "Run this installer with sudo or as root." >&2; exit 1; }
[[ -r /etc/os-release ]] || { echo "Unable to identify the operating system." >&2; exit 1; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || { echo "wFileManager currently supports Ubuntu only." >&2; exit 1; }
dpkg --compare-versions "${VERSION_ID:-0}" ge 20.04 || { echo "Ubuntu 20.04 LTS or newer is required." >&2; exit 1; }

if [[ -z "$DOMAIN" && -r /dev/tty ]]; then
  read -r -p "Public domain (leave blank for server IP): " DOMAIN </dev/tty || true
fi
HOST_KEY="${DOMAIN:-$(hostname -f 2>/dev/null || hostname)}"
INSTANCE_KEY="${WFILEMANAGER_INSTANCE_KEY:-wfm-$(printf '%s' "$HOST_KEY" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/-\+/-/g' | cut -c1-70)}"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl ca-certificates jq tar gzip xz-utils unzip openssl nginx certbot python3-certbot-nginx \
  build-essential python3 make g++ sudo passwd util-linux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

install -d -m 755 "$APP_ROOT/releases" "$CONFIG_DIR" /usr/local/lib/wfilemanager
install -d -m 700 "$STATE_ROOT/trash" "$STATE_ROOT/update"

cat > "$ENV_FILE" <<ENV
PORT=$PORT
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
WFILEMANAGER_SUPABASE_URL=$SUPABASE_URL
WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=false
WFILEMANAGER_TRASH_DIR=$STATE_ROOT/trash
WFILEMANAGER_UPDATE_MANIFEST_URL=$MANIFEST_URL
WFILEMANAGER_UPDATE_STATE_FILE=$STATE_ROOT/update/state.json
WFILEMANAGER_UPDATE_SCRIPT=/usr/local/lib/wfilemanager/update.sh
WFILEMANAGER_HEALTH_URL=http://127.0.0.1:$PORT/
WFILEMANAGER_SERVICE=wfilemanager.service
ENV
chmod 600 "$ENV_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 "$MANIFEST_URL" -o "$TMP/stable.json"
INSTALLER_ASSET="$(jq -r '.assets.updater // empty' "$TMP/stable.json")"
UPDATER_SHA="$(jq -r '.assets.updaterSha256 // empty' "$TMP/stable.json")"
[[ "$INSTALLER_ASSET" == https://* && "$UPDATER_SHA" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "The stable manifest does not contain a valid updater asset." >&2; exit 1; }
curl -fsSL --retry 3 "$INSTALLER_ASSET" -o /usr/local/lib/wfilemanager/update.sh
printf '%s  %s\n' "${UPDATER_SHA,,}" /usr/local/lib/wfilemanager/update.sh | sha256sum -c -
chmod 750 /usr/local/lib/wfilemanager/update.sh

UPDATER_SERVICE_URL="$(jq -r '.assets.updaterService // empty' "$TMP/stable.json")"
APP_SERVICE_URL="$(jq -r '.assets.appService // empty' "$TMP/stable.json")"
curl -fsSL --retry 3 "$UPDATER_SERVICE_URL" -o /etc/systemd/system/wfilemanager-updater@.service
curl -fsSL --retry 3 "$APP_SERVICE_URL" -o /etc/systemd/system/wfilemanager.service
systemctl daemon-reload
systemctl enable wfilemanager.service

/usr/local/lib/wfilemanager/update.sh install

SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/wfilemanager <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;
    client_max_body_size 10G;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
NGINX
ln -sfn /etc/nginx/sites-available/wfilemanager /etc/nginx/sites-enabled/wfilemanager
nginx -t
systemctl reload nginx

if [[ -n "$DOMAIN" && "$ENABLE_SSL" != "false" ]]; then
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    echo "HTTPS enabled for $DOMAIN"
  elif [[ "$ENABLE_SSL" == "true" ]]; then
    echo "SSL setup failed. Verify that $DOMAIN points to this server." >&2
    exit 1
  else
    echo "SSL was not enabled. Point $DOMAIN to this server, then run: certbot --nginx -d $DOMAIN" >&2
  fi
fi

echo
echo "wFileManager installation completed."
if [[ -n "$DOMAIN" ]]; then echo "Open: https://$DOMAIN (or http://$DOMAIN until SSL is active)"; else echo "Open this server's IP address in a browser."; fi
echo "Instance key: $INSTANCE_KEY"
