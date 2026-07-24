#!/usr/bin/env bash
set -Eeuo pipefail

MANIFEST_URL="${WFILEMANAGER_UPDATE_MANIFEST_URL:-https://igihzeyfgwhnuiflamvn.supabase.co/storage/v1/object/public/releases.kmerhosting.com/wfilemanager/stable.json}"
PUBLIC_SUPABASE_URL="https://igihzeyfgwhnuiflamvn.supabase.co"
LIFECYCLE_API_URL="${WFILEMANAGER_LIFECYCLE_API_URL:-${PUBLIC_SUPABASE_URL}/functions/v1/wfilemanager-instance-lifecycle-api}"
PORT="${PORT:-1973}"
DOMAIN="${DOMAIN:-}"
APP_ROOT="/opt/wfilemanager"
CONFIG_DIR="/etc/wfilemanager"
ENV_FILE="$CONFIG_DIR/wfilemanager.env"
ROOT_RESET_KEY_FILE="$CONFIG_DIR/root-reset.key"
STATE_ROOT="/var/lib/wfilemanager"
PACKAGES_FILE="$STATE_ROOT/installed-packages.txt"
INSTALL_STATE_FILE="$STATE_ROOT/install-state.env"
RECOVERY_KIT_FILE="/root/wfilemanager-recovery-kit.txt"
HEALTH_URL="http://127.0.0.1:$PORT/api/health"

[[ $EUID -eq 0 ]] || { echo "Run this installer with sudo or as root." >&2; exit 1; }
[[ -r /etc/os-release ]] || { echo "Unable to identify the operating system." >&2; exit 1; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || { echo "wFileManager currently supports Ubuntu only." >&2; exit 1; }
dpkg --compare-versions "${VERSION_ID:-0}" ge 20.04 || { echo "Ubuntu 20.04 LTS or newer is required." >&2; exit 1; }

systemd_failure() {
  local phase="$1" state="${2:-unknown}"
  cat >&2 <<TEXT

The server system manager is not healthy ($phase; state: $state).
wFileManager cannot safely install or manage services while systemd is unavailable.
Reboot the server, wait for SSH to return, then run the same official install command again.
The installer is idempotent and reuses the selected domain, application-data plan and instance identity.
TEXT
  exit 1
}

check_systemd() {
  local phase="$1" state=""
  [[ "$(ps -p 1 -o comm= 2>/dev/null | tr -d '[:space:]')" == "systemd" ]] || systemd_failure "$phase" "PID 1 is not systemd"
  timeout 12 systemctl show-environment >/dev/null 2>&1 || systemd_failure "$phase" "unresponsive"
  state="$(timeout 12 systemctl is-system-running 2>/dev/null || true)"
  if [[ "$state" == "starting" ]]; then
    for _ in $(seq 1 15); do
      sleep 2
      state="$(timeout 12 systemctl is-system-running 2>/dev/null || true)"
      [[ "$state" != "starting" ]] && break
    done
  fi
  case "$state" in
    running|degraded) ;;
    *) systemd_failure "$phase" "${state:-unresponsive}" ;;
  esac
}

run_systemctl() {
  local description="$1"
  shift
  timeout 45 systemctl "$@" || systemd_failure "$description" "unresponsive"
}

valid_domain() {
  python3 - "$1" <<'PY' >/dev/null 2>&1
import re, sys
value = sys.argv[1]
if len(value) > 253 or not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", value):
    raise SystemExit(1)
PY
}

verify_asset() {
  local url="$1" sha="$2" destination="$3"
  [[ "$url" == https://* && "$sha" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "The stable manifest contains an invalid asset." >&2; exit 1; }
  curl -fsSL --retry 3 --connect-timeout 15 "$url" -o "$destination"
  printf '%s  %s\n' "${sha,,}" "$destination" | sha256sum -c -
}

health_ready() {
  local response=""
  response="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  [[ -n "$response" ]] && jq -e '.ok == true and .status == "healthy"' >/dev/null 2>&1 <<<"$response"
}

generate_recovery_key() {
  local raw
  raw="$(openssl rand -hex 20 | tr '[:lower:]' '[:upper:]')"
  printf 'WFM-%s\n' "$(printf '%s' "$raw" | fold -w4 | paste -sd- -)"
}

read_secret() {
  local prompt="$1" variable=""
  [[ -r /dev/tty ]] || { echo "$prompt must be supplied through an environment variable." >&2; exit 1; }
  read -r -s -p "$prompt: " variable </dev/tty
  echo >/dev/tty
  printf '%s' "$variable"
}

lifecycle_delete() {
  local instance_key="$1" recovery_key="$2" response_file status message
  response_file="$(mktemp)"
  status="$(curl -sS --connect-timeout 10 --max-time 60 -o "$response_file" -w '%{http_code}' \
    -X POST "${LIFECYCLE_API_URL%/}/delete" \
    -H 'Content-Type: application/json' \
    -H "x-wfilemanager-instance: $instance_key" \
    -H "x-wfilemanager-recovery-key: $recovery_key" \
    --data '{}' || true)"
  if [[ "$status" != "200" ]]; then
    message="$(python3 - "$response_file" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("error", ""))
except Exception:
    pass
PY
)"
    rm -f "$response_file"
    echo "Remote deletion failed (HTTP ${status:-unknown}${message:+: $message})." >&2
    exit 1
  fi
  rm -f "$response_file"
}

lifecycle_recover() {
  local instance_key="$1" old_key="$2" new_hash="$3" response_file status message body
  response_file="$(mktemp)"
  body="$(jq -cn \
    --arg newRecoveryTokenHash "$new_hash" \
    --arg hostname "$(hostname -f 2>/dev/null || hostname)" \
    --arg baseUrl "https://$DOMAIN" \
    '{newRecoveryTokenHash:$newRecoveryTokenHash,hostname:$hostname,baseUrl:$baseUrl}')"
  status="$(curl -sS --connect-timeout 10 --max-time 60 -o "$response_file" -w '%{http_code}' \
    -X POST "${LIFECYCLE_API_URL%/}/recover" \
    -H 'Content-Type: application/json' \
    -H "x-wfilemanager-instance: $instance_key" \
    -H "x-wfilemanager-recovery-key: $old_key" \
    --data "$body" || true)"
  if [[ "$status" != "200" ]]; then
    message="$(jq -r '.error // empty' "$response_file" 2>/dev/null || true)"
    rm -f "$response_file"
    echo "Recovery failed (HTTP ${status:-unknown}${message:+: $message})." >&2
    exit 1
  fi
  jq -e '.success == true and .recoveryKeyRotated == true' "$response_file" >/dev/null || {
    rm -f "$response_file"
    echo "Recovery response was invalid." >&2
    exit 1
  }
  rm -f "$response_file"
}

write_recovery_kit() {
  local recovery_key="$1"
  [[ "$DATABASE_MODE" == "supabase" ]] || return 0
  umask 077
  cat >"$RECOVERY_KIT_FILE" <<TEXT
wFileManager Recovery Kit

Instance key: $INSTANCE_KEY
Recovery key: $recovery_key
Domain: $DOMAIN
Application-data plan: Pro — managed application data

Keep this file outside the server. It can recover or permanently delete the managed application data after the server is reinstalled or lost. A successful recovery
rotates this key, so replace every old copy.

Lifecycle policy:
- A valid server heartbeat keeps the instance marked active.
- Missing heartbeats may freeze remote sessions for security.
- Active paid Pro application data is not deleted solely because the server is offline.
- Permanent deletion requires an explicit removal request or the applicable service-retention policy after cancellation or expiration.
TEXT
  chmod 600 "$RECOVERY_KIT_FILE"
}

check_systemd "before installation"

EXISTING_DOMAIN=""
EXISTING_MODE=""
EXISTING_INSTANCE_KEY=""
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_DOMAIN="$(sed -n 's/^WFILEMANAGER_DOMAIN=//p' "$ENV_FILE" | tail -n1)"
  EXISTING_MODE="$(sed -n 's/^WFILEMANAGER_DATABASE_MODE=//p' "$ENV_FILE" | tail -n1)"
  EXISTING_INSTANCE_KEY="$(sed -n 's/^WFILEMANAGER_INSTANCE_KEY=//p' "$ENV_FILE" | tail -n1)"
fi

DATABASE_MODE="${WFILEMANAGER_DATABASE_MODE:-$EXISTING_MODE}"
while [[ "$DATABASE_MODE" != "supabase" && "$DATABASE_MODE" != "sqlite" ]]; do
  [[ -r /dev/tty ]] || { echo "Choose WFILEMANAGER_DATABASE_MODE=supabase or sqlite." >&2; exit 1; }
  cat >/dev/tty <<'TEXT'

Choose where wFileManager stores accounts, roles, sessions and notifications:

1) Pro — managed application data
   Managed by KmerHosting for paid Pro service and recovery.

2) Community — SQLite on your server
   Fully local. Data is stored in /var/lib/wfilemanager/wfilemanager.db.
TEXT
  read -r -p "Application-data plan [1-2]: " DATABASE_CHOICE </dev/tty
  case "$DATABASE_CHOICE" in
    1) DATABASE_MODE="supabase" ;;
    2) DATABASE_MODE="sqlite" ;;
    *) echo "Choose 1 or 2." >/dev/tty ;;
  esac
done

SUPABASE_ACTION="continue"
RECOVERY_INSTANCE_KEY="${WFILEMANAGER_RECOVERY_INSTANCE_KEY:-}"
OLD_RECOVERY_KEY="${WFILEMANAGER_RECOVERY_KEY:-}"
if [[ "$DATABASE_MODE" == "supabase" && -z "$EXISTING_INSTANCE_KEY" ]]; then
  SUPABASE_ACTION="${WFILEMANAGER_SUPABASE_ACTION:-}"
  while [[ "$SUPABASE_ACTION" != "new" && "$SUPABASE_ACTION" != "recover" && "$SUPABASE_ACTION" != "delete" ]]; do
    [[ -r /dev/tty ]] || { echo "Choose WFILEMANAGER_SUPABASE_ACTION=new, recover or delete." >&2; exit 1; }
    cat >/dev/tty <<'TEXT'

Pro managed application data installation:

1) Create a new installation
2) Recover an existing installation with a Recovery Kit
3) Permanently delete an existing remote installation
TEXT
    read -r -p "Action [1-3]: " ACTION_CHOICE </dev/tty
    case "$ACTION_CHOICE" in
      1) SUPABASE_ACTION="new" ;;
      2) SUPABASE_ACTION="recover" ;;
      3) SUPABASE_ACTION="delete" ;;
      *) echo "Choose 1, 2 or 3." >/dev/tty ;;
    esac
  done

  if [[ "$SUPABASE_ACTION" == "recover" || "$SUPABASE_ACTION" == "delete" ]]; then
    if [[ -z "$RECOVERY_INSTANCE_KEY" ]]; then
      [[ -r /dev/tty ]] || { echo "WFILEMANAGER_RECOVERY_INSTANCE_KEY is required." >&2; exit 1; }
      read -r -p "Instance key: " RECOVERY_INSTANCE_KEY </dev/tty
    fi
    [[ -n "$OLD_RECOVERY_KEY" ]] || OLD_RECOVERY_KEY="$(read_secret "Recovery key")"
  fi

  if [[ "$SUPABASE_ACTION" == "delete" ]]; then
    [[ -r /dev/tty ]] || { echo "Interactive confirmation is required for deletion." >&2; exit 1; }
    read -r -p "Type DELETE to permanently remove the managed application data: " DELETE_CONFIRM </dev/tty
    [[ "$DELETE_CONFIRM" == "DELETE" ]] || { echo "Cancelled."; exit 0; }
    lifecycle_delete "$RECOVERY_INSTANCE_KEY" "$OLD_RECOVERY_KEY"
    echo "The Pro managed application data was permanently deleted."
    exit 0
  fi
fi

DOMAIN="${DOMAIN:-$EXISTING_DOMAIN}"
while true; do
  DOMAIN="${DOMAIN,,}"
  DOMAIN="${DOMAIN#"${DOMAIN%%[![:space:]]*}"}"
  DOMAIN="${DOMAIN%"${DOMAIN##*[![:space:]]}"}"
  [[ -n "$DOMAIN" ]] && valid_domain "$DOMAIN" && break
  [[ -r /dev/tty ]] || { echo "A valid domain is required. Run with DOMAIN=files.example.com." >&2; exit 1; }
  if [[ -z "$DOMAIN" ]]; then
    cat >/dev/tty <<'TEXT'
wFileManager requires a domain with an A record pointing to this server's public IPv4.
Create the DNS record before continuing. Installation stops if DNS is not ready.
TEXT
  else
    echo "The domain '$DOMAIN' is invalid. Enter a complete domain such as files.example.com." >/dev/tty
  fi
  read -r -p "Domain (example: files.example.com): " DOMAIN </dev/tty
done

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
echo "Application-data backend: $DATABASE_MODE"
[[ "$DATABASE_MODE" == "supabase" ]] && echo "Pro action: $SUPABASE_ACTION"

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

APT_OPTIONS=(-o Acquire::Retries=5 -o Acquire::http::Timeout=60 -o Acquire::https::Timeout=60)
apt-get "${APT_OPTIONS[@]}" update
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get "${APT_OPTIONS[@]}" install -y "${BASE_PACKAGES[@]}"
check_systemd "after package installation"

ADDED_NODESOURCE=false
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  dpkg-query -W -f='${Status}' nodejs 2>/dev/null | grep -q 'install ok installed' || echo nodejs >>"$TMP/packages-to-remove.txt"
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get "${APT_OPTIONS[@]}" install -y nodejs
  ADDED_NODESOURCE=true
  check_systemd "after Node.js installation"
fi

INSTALLED_BUN=false
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  INSTALLED_BUN=true
fi
export PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

install -d -m 755 "$APP_ROOT/releases" "$CONFIG_DIR" /usr/local/lib/wfilemanager
install -d -m 700 "$STATE_ROOT" "$STATE_ROOT/trash" "$STATE_ROOT/update"

INSTANCE_KEY="${WFILEMANAGER_INSTANCE_KEY:-$EXISTING_INSTANCE_KEY}"
if [[ "$SUPABASE_ACTION" == "recover" ]]; then
  INSTANCE_KEY="$RECOVERY_INSTANCE_KEY"
elif [[ -z "$INSTANCE_KEY" ]]; then
  INSTANCE_SLUG="$(printf '%s' "$DOMAIN" | sed 's/[^a-z0-9-]/-/g' | sed 's/-\+/-/g' | cut -c1-48)"
  INSTANCE_KEY="wfm-${INSTANCE_SLUG}-$(openssl rand -hex 6)"
fi

RECOVERY_KEY=""
if [[ "$SUPABASE_ACTION" == "continue" && -s "$ROOT_RESET_KEY_FILE" ]]; then
  RECOVERY_KEY="$(tr -d '\r\n' <"$ROOT_RESET_KEY_FILE")"
else
  RECOVERY_KEY="$(generate_recovery_key)"
fi

if [[ "$DATABASE_MODE" == "supabase" && "$SUPABASE_ACTION" == "continue" && ! -s "$ROOT_RESET_KEY_FILE" ]]; then
  [[ -n "$OLD_RECOVERY_KEY" ]] || OLD_RECOVERY_KEY="${WFILEMANAGER_RECOVERY_KEY:-}"
  [[ -n "$OLD_RECOVERY_KEY" ]] || OLD_RECOVERY_KEY="$(read_secret "Recovery key from the saved Recovery Kit")"
  SUPABASE_ACTION="recover"
  RECOVERY_INSTANCE_KEY="$INSTANCE_KEY"
fi

ROOT_RESET_HASH="$(printf '%s' "$RECOVERY_KEY" | sha256sum | awk '{print $1}')"
if [[ "$DATABASE_MODE" == "supabase" && "$SUPABASE_ACTION" == "recover" ]]; then
  lifecycle_recover "$INSTANCE_KEY" "$OLD_RECOVERY_KEY" "$ROOT_RESET_HASH"
  echo "Pro managed application data installation recovered. Previous sessions and the old recovery key are now invalid."
fi

umask 077
printf '%s\n' "$RECOVERY_KEY" >"$ROOT_RESET_KEY_FILE"
chmod 600 "$ROOT_RESET_KEY_FILE"

cat >"$ENV_FILE" <<ENV
PORT=$PORT
WFILEMANAGER_DOMAIN=$DOMAIN
WFILEMANAGER_PUBLIC_BASE_URL=https://$DOMAIN
WFILEMANAGER_DATABASE_MODE=$DATABASE_MODE
VITE_WFILEMANAGER_DATABASE_MODE=$DATABASE_MODE
VITE_SUPABASE_URL=$PUBLIC_SUPABASE_URL
VITE_WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
VITE_WFILEMANAGER_ROOT_RESET_TOKEN_HASH=$ROOT_RESET_HASH
WFILEMANAGER_SUPABASE_URL=$PUBLIC_SUPABASE_URL
WFILEMANAGER_LIFECYCLE_API_URL=$LIFECYCLE_API_URL
WFILEMANAGER_RECOVERY_KEY_FILE=$ROOT_RESET_KEY_FILE
WFILEMANAGER_INSTANCE_KEY=$INSTANCE_KEY
WFILEMANAGER_SQLITE_PATH=$STATE_ROOT/wfilemanager.db
WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=false
WFILEMANAGER_TRASH_DIR=$STATE_ROOT/trash
WFILEMANAGER_STATE_ROOT=$STATE_ROOT
WFILEMANAGER_UPDATE_MANIFEST_URL=$MANIFEST_URL
WFILEMANAGER_UPDATE_STATE_FILE=$STATE_ROOT/update/state.json
WFILEMANAGER_UPDATE_SCRIPT=/usr/local/lib/wfilemanager/update.sh
WFILEMANAGER_HEALTH_URL=$HEALTH_URL
WFILEMANAGER_SERVICE=wfilemanager.service
ENV
chmod 600 "$ENV_FILE"
write_recovery_kit "$RECOVERY_KEY"

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
UPDATER_SERVICE_URL="$(jq -r '.assets.updaterService // empty' "$TMP/stable.json")"
UPDATER_SERVICE_SHA="$(jq -r '.assets.updaterServiceSha256 // empty' "$TMP/stable.json")"
APP_SERVICE_URL="$(jq -r '.assets.appService // empty' "$TMP/stable.json")"
APP_SERVICE_SHA="$(jq -r '.assets.appServiceSha256 // empty' "$TMP/stable.json")"

verify_asset "$UPDATER_ASSET" "$UPDATER_SHA" /usr/local/lib/wfilemanager/update.sh
verify_asset "$UPDATER_SERVICE_URL" "$UPDATER_SERVICE_SHA" /etc/systemd/system/wfilemanager-updater@.service
verify_asset "$APP_SERVICE_URL" "$APP_SERVICE_SHA" /etc/systemd/system/wfilemanager.service
chmod 750 /usr/local/lib/wfilemanager/update.sh

check_systemd "before service registration"
run_systemctl "while reloading systemd" daemon-reload
run_systemctl "while enabling wFileManager" enable wfilemanager.service
/usr/local/lib/wfilemanager/update.sh install || {
  check_systemd "while installing the application release"
  echo "The application release could not be installed. Rerun the same command after correcting the reported error." >&2
  exit 1
}

CURRENT_RELEASE="$(readlink -f "$APP_ROOT/current")"
install -m 700 "$CURRENT_RELEASE/deploy/wfilemanager-reset-admin-password" /usr/local/sbin/wfilemanager-reset-admin-password
install -m 700 "$CURRENT_RELEASE/deploy/uninstall.sh" /usr/local/sbin/wfilemanager-uninstall
[[ -f "$CURRENT_RELEASE/deploy/wfilemanager-recovery-kit" ]] && install -m 700 "$CURRENT_RELEASE/deploy/wfilemanager-recovery-kit" /usr/local/sbin/wfilemanager-recovery-kit

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
run_systemctl "while starting Nginx" enable --now nginx
run_systemctl "while reloading Nginx" reload nginx

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
  echo "HTTPS setup failed. Verify ports 80/443 and the A record, then rerun the installer." >&2
  exit 1
}

READY=false
for _ in $(seq 1 40); do
  if timeout 5 systemctl is-active --quiet wfilemanager.service && health_ready; then READY=true; break; fi
  sleep 1
done
if [[ "$READY" != "true" ]]; then
  timeout 15 journalctl -u wfilemanager.service -n 100 --no-pager >&2 || true
  check_systemd "during the final health check"
  exit 1
fi

if [[ "$DATABASE_MODE" == "supabase" && "$SUPABASE_ACTION" != "new" ]]; then
  systemctl start wfilemanager-heartbeat.service 2>/dev/null || true
fi

OPEN_PATH="setup"
[[ -n "$EXISTING_INSTANCE_KEY" || "$SUPABASE_ACTION" == "recover" ]] && OPEN_PATH="login"

echo
echo "wFileManager installation completed."
echo "Open: https://$DOMAIN/$OPEN_PATH"
echo "Database: $DATABASE_MODE"
echo "Instance key: $INSTANCE_KEY"
if [[ "$DATABASE_MODE" == "supabase" ]]; then
  echo "Recovery Kit: $RECOVERY_KIT_FILE"
  echo "Copy this root-only file outside the server. It is required after a system reinstall."
fi
echo
echo "You can permanently remove the application and its data at any time with:"
echo "  sudo wfilemanager-uninstall"
