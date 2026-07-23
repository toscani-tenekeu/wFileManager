#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run this command as root." >&2; exit 1; }

ENV_FILE="/etc/wfilemanager/wfilemanager.env"
STATE_FILE="/var/lib/wfilemanager/install-state.env"
PACKAGES_FILE="/var/lib/wfilemanager/installed-packages.txt"
DATABASE_MODE="unknown"
DOMAIN=""
INSTANCE_KEY=""
SUPABASE_URL=""
LIFECYCLE_API_URL=""
RECOVERY_KEY=""
PACKAGES=()

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  DATABASE_MODE="${WFILEMANAGER_DATABASE_MODE:-supabase}"
  DOMAIN="${WFILEMANAGER_DOMAIN:-}"
  INSTANCE_KEY="${WFILEMANAGER_INSTANCE_KEY:-}"
  SUPABASE_URL="${WFILEMANAGER_SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
  LIFECYCLE_API_URL="${WFILEMANAGER_LIFECYCLE_API_URL:-${SUPABASE_URL%/}/functions/v1/wfilemanager-instance-lifecycle-api}"
fi
if [[ -f /etc/wfilemanager/root-reset.key ]]; then
  RECOVERY_KEY="$(tr -d '\r\n' </etc/wfilemanager/root-reset.key)"
fi
if [[ -f "$STATE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  set +a
fi
if [[ -f "$PACKAGES_FILE" ]]; then
  mapfile -t PACKAGES < <(grep -E '^[a-zA-Z0-9.+:-]+$' "$PACKAGES_FILE" || true)
fi

cat <<'TEXT'
wFileManager uninstaller

1) Remove wFileManager, all application data and configuration.
   Keep Ubuntu packages such as Nginx, Node.js, Bun and SQLite.

2) Remove wFileManager, all application data and configuration,
   then remove packages that were installed only by wFileManager.

3) Cancel.
TEXT

read -r -p "Choose [1-3]: " CHOICE </dev/tty
case "$CHOICE" in
  1) REMOVE_PACKAGES=false ;;
  2) REMOVE_PACKAGES=true ;;
  3) echo "Cancelled."; exit 0 ;;
  *) echo "Invalid choice." >&2; exit 1 ;;
esac

read -r -p "Type REMOVE to permanently delete wFileManager and its data: " CONFIRM </dev/tty
[[ "$CONFIRM" == "REMOVE" ]] || { echo "Cancelled."; exit 0; }

if [[ "$DATABASE_MODE" == "supabase" && -n "$LIFECYCLE_API_URL" && -n "$INSTANCE_KEY" && -n "$RECOVERY_KEY" ]]; then
  echo "Deleting managed Supabase data for this installation..."
  RESPONSE_FILE="$(mktemp)"
  HTTP_STATUS="$(curl -sS --connect-timeout 10 --max-time 60 -o "$RESPONSE_FILE" -w '%{http_code}' \
    -X POST "${LIFECYCLE_API_URL%/}/delete" \
    -H 'Content-Type: application/json' \
    -H "x-wfilemanager-instance: $INSTANCE_KEY" \
    -H "x-wfilemanager-recovery-key: $RECOVERY_KEY" \
    --data '{}' || true)"
  if [[ "$HTTP_STATUS" != "200" ]]; then
    MESSAGE="$(jq -r '.error // empty' "$RESPONSE_FILE" 2>/dev/null || true)"
    echo "Warning: remote data deletion returned HTTP ${HTTP_STATUS:-unknown}${MESSAGE:+: $MESSAGE}. Local removal will continue." >&2
  fi
  rm -f "$RESPONSE_FILE"
elif [[ "$DATABASE_MODE" == "supabase" ]]; then
  echo "Warning: the Recovery Kit credentials are incomplete, so managed Supabase data could not be deleted." >&2
  echo "Use the official installer with the saved Recovery Kit and choose remote deletion." >&2
fi

systemctl disable --now wfilemanager-heartbeat.timer 2>/dev/null || true
systemctl stop wfilemanager-heartbeat.service 2>/dev/null || true
systemctl disable --now wfilemanager.service 2>/dev/null || true
systemctl disable --now wfilemanager-updater@install.service 2>/dev/null || true
systemctl disable --now wfilemanager-updater@rollback.service 2>/dev/null || true
rm -f \
  /etc/systemd/system/wfilemanager.service \
  /etc/systemd/system/wfilemanager-updater@.service \
  /etc/systemd/system/wfilemanager-heartbeat.service \
  /etc/systemd/system/wfilemanager-heartbeat.timer
systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

rm -f /etc/nginx/sites-enabled/wfilemanager /etc/nginx/sites-available/wfilemanager
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi
if [[ -n "$DOMAIN" ]] && command -v certbot >/dev/null 2>&1; then
  certbot delete --cert-name "$DOMAIN" --non-interactive >/dev/null 2>&1 || true
fi

rm -rf /opt/wfilemanager /etc/wfilemanager /var/lib/wfilemanager /usr/local/lib/wfilemanager
rm -f \
  /usr/local/sbin/wfilemanager-reset-admin-password \
  /usr/local/sbin/wfilemanager-uninstall \
  /usr/local/sbin/wfilemanager-recovery-kit \
  /root/wfilemanager-recovery-kit.txt

if [[ "$REMOVE_PACKAGES" == "true" ]]; then
  if ((${#PACKAGES[@]} > 0)); then
    DEBIAN_FRONTEND=noninteractive apt-get purge -y "${PACKAGES[@]}" || true
    DEBIAN_FRONTEND=noninteractive apt-get autoremove -y || true
  fi
  if [[ "${WFILEMANAGER_INSTALLED_BUN:-false}" == "true" ]]; then rm -rf /root/.bun; fi
  if [[ "${WFILEMANAGER_ADDED_NODESOURCE:-false}" == "true" ]]; then
    rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg
  fi
fi

echo
if [[ "$REMOVE_PACKAGES" == "true" ]]; then
  echo "wFileManager, its data, configuration and installer-added packages were removed."
else
  echo "wFileManager, its data and configuration were removed. System packages were kept."
fi
