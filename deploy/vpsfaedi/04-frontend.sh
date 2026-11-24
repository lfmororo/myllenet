#!/usr/bin/env bash
# 04 — Builda e sobe o frontend do MyLLENET (também serve para atualizar)
#   ./04-frontend.sh            → build + sobe o frontend
#   ./04-frontend.sh --pull     → git pull, atualiza Edge Functions, rebuild
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
ANON_KEY=$(envget ANON_KEY)

if [ "${1:-}" = "--pull" ]; then
  git -C "$APP_DIR" pull --ff-only
  copiar_functions
  (cd "$SB_DIR" && docker compose restart functions)
  echo "Edge Functions atualizadas."
fi

docker build -t "$PROJETO-frontend" -f "$APP_DIR/deploy/vpsfaedi/Dockerfile" \
  --build-arg VITE_SUPABASE_URL="https://$DOMINIO_API" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
  "$APP_DIR"

docker rm -f "$PROJETO-frontend" >/dev/null 2>&1 || true
docker run -d --name "$PROJETO-frontend" --restart unless-stopped \
  -p "$PORTA_APP:80" "$PROJETO-frontend"

sleep 2
curl -fsS -o /dev/null -w "frontend: HTTP %{http_code}\n" "http://127.0.0.1:$PORTA_APP/"
cat <<EOF

✅ Frontend no ar em http://127.0.0.1:$PORTA_APP

Falta publicar pelo proxy da evolutionapi (arquivo /etc/easypanel/traefik/config/myllenet.yaml):
   https://$DOMINIO_APP  →  http://192.168.0.233:$PORTA_APP
   https://$DOMINIO_API  →  http://192.168.0.233:$PORTA_API
EOF
