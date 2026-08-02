#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Run this command as root." >&2; exit 1; }

ENV_FILE="/etc/wfilemanager/wfilemanager.env"
STATE_FILE="/var/lib/wfilemanager/install-state.env"
PACKAGES_FILE="/var/lib/wfilemanager/installed-packages.txt"
RECOVERY_KEY_FILE="/etc/wfilemanager/root-reset.key"
INSTANCE_SECRET_FILE="/etc/wfilemanager/instance-secret.key"
TERMS_URL="${WFILEMANAGER_TERMS_URL:-https://wfilemanager.kmerhosting.com/terms}"

DATABASE_MODE="unknown"
PLAN="unknown"
DOMAIN=""
INSTANCE_KEY=""
SUPABASE_URL=""
LIFECYCLE_API_URL=""
RECOVERY_KEY=""
INSTANCE_SECRET=""
PACKAGES=()
REMOVE_PACKAGES=false
REMOTE_DELETE=false
RETIRE_PRO=false
RETIRE_AUTHORIZATION=""
RETIRE_APP_VERSION=""

while (($# > 0)); do
  case "$1" in
    --retire-pro) RETIRE_PRO=true; shift ;;
    --authorization) RETIRE_AUTHORIZATION="${2:-}"; shift 2 ;;
    --app-version) RETIRE_APP_VERSION="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  DATABASE_MODE="${WFILEMANAGER_DATABASE_MODE:-supabase}"
  PLAN="${WFILEMANAGER_PLAN:-$([[ "${WFILEMANAGER_DATABASE_MODE:-}" == "supabase" ]] && printf 'pro' || printf 'community')}"
  DOMAIN="${WFILEMANAGER_DOMAIN:-}"
  INSTANCE_KEY="${WFILEMANAGER_INSTANCE_KEY:-}"
  SUPABASE_URL="${WFILEMANAGER_SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
  LIFECYCLE_API_URL="${WFILEMANAGER_LIFECYCLE_API_URL:-${SUPABASE_URL%/}/functions/v1/wfilemanager-instance-lifecycle-api}"
fi
if [[ -f "$RECOVERY_KEY_FILE" ]]; then
  RECOVERY_KEY="$(tr -d '\r\n' <"$RECOVERY_KEY_FILE")"
fi
if [[ -f "$INSTANCE_SECRET_FILE" ]]; then
  INSTANCE_SECRET="$(tr -d '\r\n' <"$INSTANCE_SECRET_FILE")"
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

edition_label() {
  if [[ "$DATABASE_MODE" == "supabase" || "$PLAN" == "pro" ]]; then
    printf 'Pro — managed application data'
  elif [[ "$DATABASE_MODE" == "sqlite" || "$PLAN" == "community" ]]; then
    printf 'Community — SQLite on this server'
  else
    printf 'Unknown'
  fi
}

print_detected() {
  cat <<TEXT
wFileManager uninstaller

Detected edition: $(edition_label)
Domain: ${DOMAIN:-unknown}
Instance key: ${INSTANCE_KEY:-unknown}

Terms of Use: $TERMS_URL
TEXT
}

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

delete_remote_pro_data() {
  local response_file http_status message
  [[ "$DATABASE_MODE" == "supabase" || "$PLAN" == "pro" ]] || return 0

  if [[ -z "$LIFECYCLE_API_URL" || -z "$INSTANCE_KEY" ]]; then
    echo "Pro remote deletion cannot run because the lifecycle URL or instance key is missing." >&2
    return 1
  fi
  if [[ -z "$RECOVERY_KEY" ]]; then
    echo "Pro remote deletion requires the saved Recovery Kit recovery key." >&2
    echo "Use local-only uninstall if you want to preserve managed data for recovery." >&2
    return 1
  fi

  echo "Deleting Pro managed application data and instance account..."
  response_file="$(mktemp)"
  http_status="$(curl -sS --connect-timeout 10 --max-time 60 -o "$response_file" -w '%{http_code}' \
    -X POST "${LIFECYCLE_API_URL%/}/delete" \
    -H 'Content-Type: application/json' \
    -H "x-wfilemanager-instance: $INSTANCE_KEY" \
    -H "x-wfilemanager-recovery-key: $RECOVERY_KEY" \
    --data '{}' || true)"
  if [[ "$http_status" != "200" ]]; then
    message="$(jq -r '.error // empty' "$response_file" 2>/dev/null || true)"
    rm -f "$response_file"
    echo "Remote Pro deletion failed (HTTP ${http_status:-unknown}${message:+: $message})." >&2
    echo "Local files were not removed because you selected remote Pro deletion." >&2
    echo "Choose a local-only uninstall, or recover the correct Recovery Kit and retry deletion." >&2
    return 1
  fi
  if ! jq -e '.success == true and ((.deleted == true) or (.alreadyAbsent == true))' "$response_file" >/dev/null 2>&1; then
    rm -f "$response_file"
    echo "Remote Pro deletion response was not valid." >&2
    return 1
  fi
  if jq -e '.alreadyAbsent == true' "$response_file" >/dev/null 2>&1; then
    echo "No remote Pro managed application-data account exists for this instance key. Continuing local removal."
  fi
  rm -f "$response_file"
}

verify_retirement_authorization() {
  local key expected payload
  [[ "$DATABASE_MODE" == "supabase" || "$PLAN" == "pro" ]] || {
    echo "Automated Pro retirement refused: this is not a legacy Pro installation." >&2
    return 1
  }
  [[ "$RETIRE_APP_VERSION" == 0.10.* && "$RETIRE_AUTHORIZATION" =~ ^[a-f0-9]{64}$ ]] || {
    echo "Automated Pro retirement refused: invalid version or authorization." >&2
    return 1
  }
  if [[ -n "$INSTANCE_SECRET" ]]; then
    key="$INSTANCE_SECRET"
  elif [[ -n "$RECOVERY_KEY" ]]; then
    key="$RECOVERY_KEY"
  else
    echo "Automated Pro retirement refused: no local instance credential." >&2
    return 1
  fi
  payload="retire-pro:${INSTANCE_KEY}:${RETIRE_APP_VERSION}"
  expected="$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$key" | awk '{print $NF}')"
  [[ "$expected" == "$RETIRE_AUTHORIZATION" ]] || {
    echo "Automated Pro retirement refused: authorization did not match this instance." >&2
    return 1
  }
}

local_remove() {
  systemctl disable --now wfilemanager-heartbeat.timer 2>/dev/null || true
  if [[ "$RETIRE_PRO" != "true" ]]; then
    systemctl stop wfilemanager-heartbeat.service 2>/dev/null || true
  fi
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

print_detected

if [[ "$RETIRE_PRO" == "true" ]]; then
  verify_retirement_authorization
  REMOVE_PACKAGES=false
  REMOTE_DELETE=true
  delete_remote_pro_data
  local_remove
  echo "wFileManager Pro was retired after authenticated remote deletion. System packages were kept."
  exit 0
fi

if [[ "$DATABASE_MODE" == "supabase" || "$PLAN" == "pro" ]]; then
  cat <<'TEXT'

Pro uninstall options:

1) Remove local installation only.
   Keep the paid Pro subscription, managed application data and Recovery Kit identity for a future reinstall.

2) Remove local installation and installer-added packages.
   Keep the paid Pro subscription, managed application data and Recovery Kit identity.

3) Permanently delete Pro managed application data and the remote instance account,
   then remove the local installation. Ubuntu packages are kept.

4) Permanently delete Pro managed application data and the remote instance account,
   then remove the local installation and installer-added packages.

5) Cancel.
TEXT
  CHOICE="$(read_choice "Choose [1-5]: ")"
  case "$CHOICE" in
    1) REMOVE_PACKAGES=false; REMOTE_DELETE=false ;;
    2) REMOVE_PACKAGES=true; REMOTE_DELETE=false ;;
    3) REMOVE_PACKAGES=false; REMOTE_DELETE=true ;;
    4) REMOVE_PACKAGES=true; REMOTE_DELETE=true ;;
    5) echo "Cancelled."; exit 0 ;;
    *) echo "Invalid choice." >&2; exit 1 ;;
  esac

  if [[ "$REMOTE_DELETE" == "true" ]]; then
    cat <<'TEXT'

This permanently deletes the Pro managed application data used by wFileManager:
users, roles, sessions, authentication records, notifications, settings, backups and recovery metadata.
It does not delete server filesystem files outside wFileManager application records.
TEXT
    confirm_text "Type DELETE PRO DATA to continue: " "DELETE PRO DATA" || { echo "Cancelled."; exit 0; }
    delete_remote_pro_data
  else
    confirm_text "Type REMOVE LOCAL to remove only the local installation: " "REMOVE LOCAL" || { echo "Cancelled."; exit 0; }
  fi
else
  cat <<'TEXT'

Community uninstall options:

1) Remove wFileManager, local SQLite data and configuration.
   Keep Ubuntu packages such as Nginx, Node.js, Bun and SQLite.

2) Remove wFileManager, local SQLite data and configuration,
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
  confirm_text "Type REMOVE to permanently delete the local Community installation: " "REMOVE" || { echo "Cancelled."; exit 0; }
fi

local_remove
remove_packages_if_requested

echo
if [[ "$REMOTE_DELETE" == "true" ]]; then
  echo "wFileManager was removed locally and the Pro managed application data/account was deleted or was already absent."
elif [[ "$DATABASE_MODE" == "supabase" || "$PLAN" == "pro" ]]; then
  echo "wFileManager was removed locally. Pro managed application data and subscription were kept for recovery."
else
  echo "wFileManager Community, local SQLite data and configuration were removed."
fi
if [[ "$REMOVE_PACKAGES" == "true" ]]; then
  echo "Installer-added packages were removed where possible."
else
  echo "System packages were kept."
fi
