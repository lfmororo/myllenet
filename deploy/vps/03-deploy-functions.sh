#!/usr/bin/env bash
# 03 — Publica as Edge Functions do repositório no Supabase do MyLLENET.
# Pode ser rodado de novo sempre que as funções mudarem (depois de git pull).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -d "$APP_DIR/supabase/functions" ] || die "Não achei $APP_DIR/supabase/functions (clone o repo em APP_DIR)"
FN_DIR="$SB_DIR/volumes/functions"
[ -f "$FN_DIR/main/index.ts" ] || die "Rode antes o 01-install-supabase.sh"

log "Copiando funções de $APP_DIR/supabase/functions"
count=0
for d in "$APP_DIR"/supabase/functions/*/; do
  name=$(basename "$d")
  [ "$name" = "main" ] && { warn "ignorando pasta 'main' do repo (nome reservado)"; continue; }
  rm -rf "${FN_DIR:?}/$name"
  cp -a "$d" "$FN_DIR/$name"
  [ "$name" = "_shared" ] || count=$((count+1))
done
ok "$count funções copiadas"

grep -q '^EFI_CLIENT_ID=\|^UAZAPI_TOKEN=\|^EVOLUTION_API_KEY=' "$SB_DIR/functions.env" \
  || warn "functions.env ainda sem segredos de integração (rode o 02-migrate-data.sh)."

log "Reiniciando o runtime de funções"
compose up -d --force-recreate --no-deps functions
sleep 5

log "Teste rápido (deve responder algo diferente de 404/503)"
ANON=$(sb_env ANON_KEY)
for fn in diagnostico mikrotik-status whatsapp-send; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "http://127.0.0.1:$API_GW_LOCAL_PORT/functions/v1/$fn" -H "apikey: $ANON")
  printf '    %-22s OPTIONS -> HTTP %s\n' "$fn" "$code"
done
echo "Logs: cd $SB_DIR && docker compose logs -f functions"
