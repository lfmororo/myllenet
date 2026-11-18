#!/usr/bin/env bash
# 04 — Gera o build do front apontando para o Supabase da VPS e publica no myllenet-web.
# Pode ser rodado de novo a cada atualização do front (depois de git pull).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -f "$APP_DIR/package.json" ] || die "Não achei $APP_DIR/package.json"
ANON=$(sb_env ANON_KEY)
[ -n "$ANON" ] || die "ANON_KEY vazio em $SB_DIR/.env"

log "Build do front (Node 20 em container — não instala nada na VPS)"
# Variáveis de ambiente do processo têm prioridade sobre o .env do repo no Vite
docker run --rm -v "$APP_DIR":/app -w /app \
  -e VITE_BACKEND=supabase \
  -e VITE_SUPABASE_URL="https://$API_DOMAIN" \
  -e VITE_SUPABASE_PUBLISHABLE_KEY="$ANON" \
  -e VITE_SUPABASE_PROJECT_ID=myllenet \
  -e VITE_API_URL="" \
  node:20-alpine sh -c '
    set -e
    rm -rf dist.new
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund; else npm install --no-audit --no-fund; fi
    npx vite build --outDir dist.new --emptyOutDir
  '

log "Conferindo o build"
[ -f "$APP_DIR/dist.new/index.html" ] || die "Build não gerou index.html"
if grep -rq "$OLD_PROJECT_REF" "$APP_DIR/dist.new"; then die "O build ainda referencia o projeto antigo ($OLD_PROJECT_REF)"; fi
grep -rq "$API_DOMAIN" "$APP_DIR/dist.new/assets" || die "O build não contém $API_DOMAIN"
ok "build aponta para https://$API_DOMAIN"

log "Publicando"
# Troca o conteúdo de dist sem recriar a pasta (o container monta dist por bind)
mkdir -p "$APP_DIR/dist"
find "$APP_DIR/dist" -mindepth 1 -delete
cp -a "$APP_DIR/dist.new/." "$APP_DIR/dist/"
rm -rf "$APP_DIR/dist.new"
compose up -d web
docker exec myllenet-web nginx -s reload >/dev/null 2>&1 || true

code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $APP_DOMAIN" "http://127.0.0.1:$EDGE_LOCAL_PORT/")
[ "$code" = "200" ] && ok "front respondendo localmente (HTTP 200)" || warn "front respondeu HTTP $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $API_DOMAIN" -H "apikey: $ANON" "http://127.0.0.1:$EDGE_LOCAL_PORT/auth/v1/health")
[ "$code" = "200" ] && ok "API via myllenet-web respondendo (HTTP 200)" || warn "API via myllenet-web respondeu HTTP $code"
