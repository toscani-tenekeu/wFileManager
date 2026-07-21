#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${DOMAIN:-wfilemanager.kmerhosting.com}"
APP_DIR="${APP_DIR:-/opt/$DOMAIN}"
PORT="${PORT:-1973}"
SERVICE="${SERVICE:-wfilemanager}"
NODE_BIN="$(command -v node || true)"

if [[ $EUID -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

apt-get update
apt-get install -y curl ca-certificates nginx build-essential python3 make g++ sudo passwd util-linux

if [[ -z "$NODE_BIN" ]] || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || echo 0)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
  NODE_BIN="$(command -v node)"
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="/root/.bun/bin:$PATH"

cd "$APP_DIR"
[[ -f .env ]] || cp .env.example .env
bun install
bun run build

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
ExecStart=$NODE_BIN $APP_DIR/.output/server/index.mjs
Restart=always
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
SERVICEFILE

systemctl daemon-reload
systemctl enable --now "$SERVICE.service"
sleep 3
systemctl is-active --quiet "$SERVICE.service" || {
  journalctl -u "$SERVICE.service" -n 100 --no-pager
  exit 1
}

nginx -t
systemctl reload nginx
curl -fsS "http://127.0.0.1:$PORT/" >/dev/null

echo "wFileManager is running on 127.0.0.1:$PORT"
