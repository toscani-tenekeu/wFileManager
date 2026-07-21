#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="wfilemanager.kmerhosting.com"
APP_DIR="/opt/$DOMAIN"
ZIP_FILE="${1:-/root/wfilemanager-live-v0.6.5.zip}"
PORT="1973"
SERVICE="wfilemanager"
TMP_DIR="$(mktemp -d)"
ENV_COPY="$(mktemp)"
trap 'rm -rf "$TMP_DIR" "$ENV_COPY"' EXIT

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -f "$ZIP_FILE" ]] || { echo "ZIP not found: $ZIP_FILE" >&2; exit 1; }

if [[ -f "$APP_DIR/.env" ]]; then cp "$APP_DIR/.env" "$ENV_COPY"; else : > "$ENV_COPY"; fi
systemctl stop "$SERVICE.service" 2>/dev/null || true
unzip -q "$ZIP_FILE" -d "$TMP_DIR"
PROJECT_DIR="$(find "$TMP_DIR" -maxdepth 3 -type f -name package.json -printf '%h\n' | head -n1)"
[[ -n "$PROJECT_DIR" ]] || { echo "package.json not found in ZIP" >&2; exit 1; }
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp -a "$PROJECT_DIR"/. "$APP_DIR"/
if [[ -s "$ENV_COPY" ]]; then cp "$ENV_COPY" "$APP_DIR/.env"; else cp "$APP_DIR/.env.example" "$APP_DIR/.env"; fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3 make g++ sudo passwd util-linux
install -d -m 700 -o root -g root /var/lib/wfilemanager/trash

export PATH="/root/.bun/bin:$PATH"
command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash
export PATH="/root/.bun/bin:$PATH"
cd "$APP_DIR"
bun install
bun run build
bun run typecheck

NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/$SERVICE.service" <<SERVICEFILE
[Unit]
Description=wFileManager local Linux file manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment=WFILEMANAGER_SUPABASE_URL=https://igihzeyfgwhnuiflamvn.supabase.co
Environment=WFILEMANAGER_INSTANCE_KEY=wfilemanager-kmerhosting-com
Environment=WFILEMANAGER_ALLOW_PSEUDO_FS_WRITE=false
Environment=WFILEMANAGER_TRASH_DIR=/var/lib/wfilemanager/trash
ExecStart=$NODE_BIN $APP_DIR/.output/server/index.mjs
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
SERVICEFILE

systemctl daemon-reload
systemctl enable --now "$SERVICE.service"
sleep 4
systemctl is-active --quiet "$SERVICE.service" || { journalctl -u "$SERVICE.service" -n 120 --no-pager; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null
nginx -t
systemctl reload nginx

echo "wFileManager v0.6.5 is running at https://$DOMAIN"
systemctl status "$SERVICE.service" --no-pager
