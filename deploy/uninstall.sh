#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run this command as root." >&2; exit 1; }
[[ $# -eq 0 ]] || { echo "This uninstaller does not accept arguments." >&2; exit 2; }

ENV_FILE="/etc/wfilemanager/wfilemanager.env"
STATE_FILE="/var/lib/wfilemanager/install-state.env"
PACKAGES_FILE="/var/lib/wfilemanager/installed-packages.txt"
TERMS_URL="${WFILEMANAGER_TERMS_URL:-https://wfilemanager.kmerhosting.com/terms}"

DOMAIN=""
PACKAGES=()
REMOVE_PACKAGES=false

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  DOMAIN="${WFILEMANAGER_DOMAIN:-}"
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

read_choice() {
  local prompt="$1"
  local value=""
  read -r -p "$prompt" value </dev/tty
  printf '%s' "$value"
}

confirm_text() {
  local prompt="$1" expected="$2" value=""
  read -r -p "$prompt" value </dev/tty
  [[ "$value" == "$expected" ]]
}

local_remove() {
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
}

remove_packages_if_requested() {
  if [[ "$REMOVE_PACKAGES" != "true" ]]; then return 0; fi
  if ((${#PACKAGES[@]} > 0)); then
    DEBIAN_FRONTEND=noninteractive apt-get purge -y "${PACKAGES[@]}" || true
    DEBIAN_FRONTEND=noninteractive apt-get autoremove -y || true
  fi
  if [[ "${WFILEMANAGER_INSTALLED_BUN:-false}" == "true" ]]; then rm -rf /root/.bun; fi
  if [[ "${WFILEMANAGER_ADDED_NODESOURCE:-false}" == "true" ]]; then
    rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg
  fi
}

cat <<TEXT
wFileManager uninstaller

Domain: ${DOMAIN:-unknown}
Terms of Use: $TERMS_URL

1) Remove wFileManager, application data and configuration.
   Keep Ubuntu packages such as Nginx, Node.js, Bun and SQLite.

2) Remove wFileManager, application data and configuration,
   then remove packages that were installed only by wFileManager.

3) Cancel.
TEXT

CHOICE="$(read_choice "Choose [1-3]: ")"
case "$CHOICE" in
  1) REMOVE_PACKAGES=false ;;
  2) REMOVE_PACKAGES=true ;;
  3) echo "Cancelled."; exit 0 ;;
  *) echo "Invalid choice." >&2; exit 1 ;;
esac
confirm_text "Type REMOVE to permanently delete this wFileManager installation: " "REMOVE" || {
  echo "Cancelled."
  exit 0
}

local_remove
remove_packages_if_requested

echo
echo "wFileManager application data and configuration were removed."
if [[ "$REMOVE_PACKAGES" == "true" ]]; then
  echo "Installer-added packages were removed where possible."
else
  echo "System packages were kept."
fi
