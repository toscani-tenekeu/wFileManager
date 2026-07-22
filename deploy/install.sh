#!/usr/bin/env bash
set -Eeuo pipefail

MANIFEST_URL="${WFILEMANAGER_UPDATE_MANIFEST_URL:-https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/stable.json}"
PUBLIC_SUPABASE_URL="https://igihzeyfgwhnuiflamvn.supabase.co"
PORT="${PORT:-1973}"
DOMAIN="${DOMAIN:-}"
APP_ROOT="/opt/wfilemanager"
CONFIG_DIR="/etc/wfilemanager"
ENV_FILE="$CONFIG_DIR/wfilemanager.env"
ROOT_RESET_KEY_FILE="$CONFIG_DIR/root-reset.key"
STATE_ROOT="/var/lib/wfilemanager"
PACKAGES_FILE="$STATE_ROOT/installed-packages.txt"
INSTALL_STATE_FILE="$STATE_ROOT/install-state.env"

[[ $EUID -eq 0 ]] || { echo "Run this installer with sudo or as root." >&2; exit 1; }
[[ -r /etc/os-release ]] || { echo "Unable to identify the operating system." >&2; exit 1; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || { echo "wFileManager currently supports Ubuntu only." >&2; exit 1; }
dpkg --compare-versions "${VERSION_ID:-0}" ge 20.04 || { echo "Ubuntu 20.04 LTS or newer is required." >&2; exit 1; }

EXISTING_DOMAIN=""
EXISTING_MODE=""
EXISTING_INSTANCE_KEY=""
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_DOMAIN="$(sed -n 's/^WFILEMANAGER_DOMAIN=//p' "$ENV_FILE" | tail -n1)"
  EXISTING_MODE="$(sed -n 's/^WFILEMANAGER_DATABASE_MODE=//p' "$ENV_FILE" | tail -n1)"
  EXISTING_INSTANCE_KEY="$(sed -n 's/^WFILEMANAGER_INSTANCE_KEY=//p' "$ENV_FILE" | tail -n1)"
fi

DOMAIN="${DOMAIN:-$EXISTING_DOMAIN}"
if [[ -z "$DOMAIN" ]]; then
  [[ -r /dev/tty ]] || { echo "A domain is required. Run with DOMAIN=files.example.com." >&2; exit 1; }
  cat >/dev/tty <<'TEXT'
wFileManager requires a domain with an A record pointing to this server's public IPv4.
Create the DNS record before continuing. Installation stops if DNS is not ready.
TEXT
  read -r -p "Domain (example: files.example.com): " DOMAIN </dev/tty
fi
DOMAIN="${DOMAIN,,}"
python3 - "$DOMAIN" <<'PY' || { echo "The domain name is invalid." >&2; exit 1; }
import re, sys
value = sys.argv[1]
if len(value) > 253 or not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", value):
    raise SystemExit(1)
PY

DATABASE_MODE="${WFILEMANAGER_DATABASE_MODE:-$EXISTING_MODE}"
if [[ -z "$DATABASE_MODE" ]]; then
  [[ -r /dev/tty ]] || { echo "Choose WFILEMANAGER_DATABASE_MODE=supabase or sqlite." >&2; exit 1; }
  cat >/dev/tty <<'TEXT'

Choose where wFileManager stores accounts, roles, sessions and notifications:

1) KmerHosting managed Supabase
   Automatically configured. Authentication data is stored in KmerHosting's Supabase project.

2) SQLite on this VPS
   Fully local. Data is stored in /var/lib/wfilemanager/wfilemanager.db.
TEXT
  read -r -p "Database mode [1-2]: " DATABASE_CHOICE </dev/tty
  case "$DATABASE_CHOICE" in
    1) DATABASE_MODE="supabase" ;;
    2) DATABASE_MODE="sqlite" ;;
    *) echo "Invalid database choice." >&2; exit 1 ;;
  esac
fi
[[ "$DATABASE_MODE" == "supabase" || "$DATABASE_MODE" == "sqlite" ]] || { echo "Database mode must be supabase or sqlite." >&2; exit 1; }

PUBLIC_IP=""
for endpoint in https://api.ipify.org https://ipv4.icanhazip.com; do
  PUBLIC_IP="$(curl -4fsS --max-time 8 "$endpoint" 2>/dev/null | tr -d '[:space:]' || true)"
  if python3 - "$PUBLIC_IP" <<'PY' >/dev/null 2>&1
import ipaddress, sys
ipaddress.IPv4Address(sys.argv[1])
PY
  then break; fi
  PUBLIC_IP=""
done
[[ -n "$PUBLIC_IP" ]] || { echo "Unable to detect this server's public IPv4." >&2; exit 1; }

DNS_ADDRESSES="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
if ! grep -Fxq "$PUBLIC_IP" <<<"$DNS_ADDRESSES"; then
  echo "DNS validation failed." >&2
  echo "$DOMAIN must have an A record pointing to $PUBLIC_IP." >&2
  echo "Currently resolved IPv4 addresses: ${DNS_ADDRESSES:-none}" >&2
  echo "Update DNS, wait for propagation, then run the same install command again." >&2
  exit 1
fi

echo "Domain verified: $DOMAIN -> $PUBLIC_IP"
echo "Database mode: $DATABASE_MODE"

BASE_PACKAGES=(curl ca-certificates jq tar gzip xz-utils unzip openssl nginx certbot python3-certbot-nginx build-essential python3 make g++ sudo passwd util-linux)
[[ "$DATABASE_MODE" == "sqlite" ]] && BASE_PACKAGES+=(sqlite3)
NODE_WAS_AVAILABLE=false
BUN_WAS_AVAILABLE=false
command -v node >/dev/null 2>&1 && NODE_WAS_AVAILABLE=true
command -v bun >/dev/null 2>&1 && BUN_WAS_AVAILABLE=true

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
: >"$TMP/packages-to-remove.txt"
for package in "${BASE_PACKAGES[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' || echo "$package" >>"$TMP/packages-to-remove.txt"
done

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y "${BASE_PACKAGES[@]}"

ADDED_NODESOURCE=false
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  if ! dpkg-query -W -f='${Status}' nodejs 2>/dev/null | grep -q 'install ok installed'; then
    echo nodejs >>"$TMP/packages-to-remove.txt"
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  ADDED_NODESOURCE=true
fi
INSTALLED_BUN=false
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  INSTALLED_BUN=true
fi
export PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

install -d -m 755 "$APP_ROOT/releases" "$CONFIG_DIR" /usr/local/lib/wfilemanager
install -d -m 700 "$STATE_ROOT/trash" "$STATE_ROOT/update"
if [[ "$DATABASE_MODE" == "sqlite" ]]; then install -d -m 700 "$STATE_ROOT"; fi

INSTANCE_KEY="${WFILEMANAGER_INSTANCE_KEY:-$EXISTING_INSTANCE_KEY}"
if [[ -z "$INSTANCE_KEY" ]]; then
  INSTANCE_SLUG="$(printf '%s' "$DOMAIN" | sed 's/[^a-z0-9-]/-/g' | sed 's/-\+/-/g' | cut -c1-48)"
  INSTANCE_KEY="wfm-${INSTANCE_SLUG}-$(openssl rand -hex 6)"
fi

if [[ ! -s "$ROOT_RESET_KEY_FILE" ]]; then
  umask 077
  openssl rand -hex 48 >"$ROOT_RESET_KEY_FILE"
fi
chmod 600 "$ROOT_RESET_KEY_FILE"
ROOT_RESET_HASH="$(tr -d '\r\n' <"$ROOT_RESET_KEY_FILE" | sha256sum | awk '{print $1}')"

SERVER_AUTH_URL="$PUBLIC_SUPABASE_URL"
[[ "$DATABASE_MODE" == "sqlite" ]] && SERVER_AUTH_URL="http://127.0.0.1:$PORT/api/sqlite-proxy"

cat >"$ENV_FILE" <<ENV
PORT=$PORT
WFILEMANAGER_DOMAIN=$DOMAIN
WFILEMANAGER_PUBLIC_BASE_URL=https://$DOMAIN
WFILEMANAGER_DATABASE_MODE=$DATABASE_MODE
VITE_WFILEMANAGER_DATABASE_MODE=$DATABASE_MODE
VITE_SUPABASE_URL=$PUBLIC_SUPABASE_URL
VITE_WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
VITE_WFILEMANAGER_ROOT_RESET_TOKEN_HASH=$ROOT_RESET_HASH
WFILEMANAGER_SUPABASE_URL=$SERVER_AUTH_URL
WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
WFILEMANAGER_SQLITE_PATH=$STATE_ROOT/wfilemanager.db
WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=false
WFILEMANAGER_TRASH_DIR=$STATE_ROOT/trash
WFILEMANAGER_UPDATE_MANIFEST_URL=$MANIFEST_URL
WFILEMANAGER_UPDATE_STATE_FILE=$STATE_ROOT/update/state.json
WFILEMANAGER_UPDATE_SCRIPT=/usr/local/lib/wfilemanager/update.sh
WFILEMANAGER_HEALTH_URL=http://127.0.0.1:$PORT/
WFILEMANAGER_SERVICE=wfilemanager.service
ENV
chmod 600 "$ENV_FILE"

sort -u "$TMP/packages-to-remove.txt" >"$PACKAGES_FILE"
cat >"$INSTALL_STATE_FILE" <<STATE
WFILEMANAGER_INSTALLED_BUN=$INSTALLED_BUN
WFILEMANAGER_ADDED_NODESOURCE=$ADDED_NODESOURCE
WFILEMANAGER_NODE_WAS_AVAILABLE=$NODE_WAS_AVAILABLE
WFILEMANAGER_BUN_WAS_AVAILABLE=$BUN_WAS_AVAILABLE
STATE
chmod 600 "$PACKAGES_FILE" "$INSTALL_STATE_FILE"

curl -fsSL --retry 3 "$MANIFEST_URL" -o "$TMP/stable.json"
UPDATER_ASSET="$(jq -r '.assets.updater // empty' "$TMP/stable.json")"
UPDATER_SHA="$(jq -r '.assets.updaterSha256 // empty' "$TMP/stable.json")"
[[ "$UPDATER_ASSET" == https://* && "$UPDATER_SHA" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "The stable manifest does not contain a valid updater asset." >&2; exit 1; }
curl -fsSL --retry 3 "$UPDATER_ASSET" -o /usr/local/lib/wfilemanager/update.sh
printf '%s  %s\n' "${UPDATER_SHA,,}" /usr/local/lib/wfilemanager/update.sh | sha256sum -c -
chmod 750 /usr/local/lib/wfilemanager/update.sh

UPDATER_SERVICE_URL="$(jq -r '.assets.updaterService // empty' "$TMP/stable.json")"
UPDATER_SERVICE_SHA="$(jq -r '.assets.updaterServiceSha256 // empty' "$TMP/stable.json")"
APP_SERVICE_URL="$(jq -r '.assets.appService // empty' "$TMP/stable.json")"
APP_SERVICE_SHA="$(jq -r '.assets.appServiceSha256 // empty' "$TMP/stable.json")"
[[ "$UPDATER_SERVICE_URL" == https://* && "$UPDATER_SERVICE_SHA" =~ ^[a-fA-F0-9]{64}$ ]] || exit 1
[[ "$APP_SERVICE_URL" == https://* && "$APP_SERVICE_SHA" =~ ^[a-fA-F0-9]{64}$ ]] || exit 1
curl -fsSL --retry 3 "$UPDATER_SERVICE_URL" -o /etc/systemd/system/wfilemanager-updater@.service
curl -fsSL --retry 3 "$APP_SERVICE_URL" -o /etc/systemd/system/wfilemanager.service
printf '%s  %s\n' "${UPDATER_SERVICE_SHA,,}" /etc/systemd/system/wfilemanager-updater@.service | sha256sum -c -
printf '%s  %s\n' "${APP_SERVICE_SHA,,}" /etc/systemd/system/wfilemanager.service | sha256sum -c -
systemctl daemon-reload
systemctl enable wfilemanager.service
/usr/local/lib/wfilemanager/update.sh install

CURRENT_RELEASE="$(readlink -f "$APP_ROOT/current")"
install -m 700 "$CURRENT_RELEASE/deploy/wfilemanager-reset-admin-password" /usr/local/sbin/wfilemanager-reset-admin-password
install -m 700 "$CURRENT_RELEASE/deploy/uninstall.sh" /usr/local/sbin/wfilemanager-uninstall

cat >/etc/nginx/sites-available/wfilemanager <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 10G;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
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
systemctl enable --now nginx
systemctl reload nginx

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
  echo "HTTPS setup failed. The application was installed but will not be considered ready without TLS." >&2
  echo "Verify ports 80/443 and the A record, then rerun the installer." >&2
  exit 1
}

READY=false
for attempt in $(seq 1 40); do
  if systemctl is-active --quiet wfilemanager.service && curl -fsS --max-time 3 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then READY=true; break; fi
  sleep 1
done
[[ "$READY" == "true" ]] || { journalctl -u wfilemanager.service -n 100 --no-pager >&2; exit 1; }

echo
echo "wFileManager installation completed."
echo "Open: https://$DOMAIN/setup"
echo "Database: $DATABASE_MODE"
echo "Instance key: $INSTANCE_KEY"
echo
echo "You can permanently remove the application and its data at any time with:"
echo "  sudo wfilemanager-uninstall"
