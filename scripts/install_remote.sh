#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/koru-dashboard}"
PORT="${PORT:-10101}"
ARCHIVE="${ARCHIVE:-/tmp/koru-dashboard.tar.gz}"
SERVICE_NAME="${SERVICE_NAME:-koru-dashboard}"
SUDO_PASS="${SUDO_PASS:-}"

sudo_cmd() {
  if [ -n "$SUDO_PASS" ]; then
    printf '%s\n' "$SUDO_PASS" | sudo -S "$@"
  else
    sudo "$@"
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  sudo_cmd apt-get update
  sudo_cmd apt-get install -y python3 python3-venv python3-pip
fi

if ! python3 -m venv --help >/dev/null 2>&1; then
  sudo_cmd apt-get update
  sudo_cmd apt-get install -y python3-venv
fi

sudo_cmd mkdir -p "$APP_DIR"
sudo_cmd chown -R "$USER:$USER" "$APP_DIR"
tar -xzf "$ARCHIVE" -C "$APP_DIR"

cd "$APP_DIR"
mkdir -p data uploads
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

cat > "/tmp/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=KORU eClub Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo_cmd mv "/tmp/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo_cmd systemctl daemon-reload
sudo_cmd systemctl enable --now "$SERVICE_NAME"
sudo_cmd systemctl restart "$SERVICE_NAME"
sudo_cmd systemctl --no-pager --full status "$SERVICE_NAME"

if command -v ufw >/dev/null 2>&1; then
  sudo_cmd ufw allow "$PORT"/tcp >/dev/null || true
fi
