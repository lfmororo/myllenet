#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=/etc/systemd/system/mikrotik-agent.service

if [ "$EUID" -ne 0 ]; then
  echo "Execute como root: sudo bash install.sh"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nao encontrado. Instalando Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 ou superior e necessario (versao atual: $(node -v))"
  exit 1
fi

if [ ! -f "$DIR/.env" ]; then
  echo "Arquivo .env nao encontrado em $DIR"
  exit 1
fi

chmod 600 "$DIR/.env"

echo "Instalando servico systemd em $SERVICE ..."
sed "s|__AGENT_DIR__|$DIR|g; s|__NODE_BIN__|$(command -v node)|g" \
  "$DIR/mikrotik-agent.service" > "$SERVICE"

systemctl daemon-reload
systemctl enable mikrotik-agent
systemctl restart mikrotik-agent

sleep 2
systemctl status mikrotik-agent --no-pager || true

echo
echo "Pronto! Logs em tempo real: journalctl -u mikrotik-agent -f"
