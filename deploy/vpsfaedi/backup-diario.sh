#!/usr/bin/env bash
# Backup do MyLLENET
#   backup-diario.sh            → backup agendado (crontab, 03:00)
#   backup-diario.sh --pedido   → roda a cada minuto; só faz backup se alguém clicou em
#                                 "Fazer backup agora" no painel (tabela backup_pedidos)
#
# Gera um arquivo criptografado (AES-256) com:
#   banco.backup  — pg_dump formato custom do banco inteiro (restaura com o 02-restaurar-banco.sh),
#                   sem os DADOS dos logs grandes (pppoe_logs, status do roteador, snapshots, WAN)
#   arquivos.tar  — .env da stack (chaves e senhas), compose do projeto e arquivos do Storage
# Retenção: 7 diários, 4 semanais (domingo), 3 mensais (dia 1), local e no Google Drive.
# Google Drive: conectado pelo painel (Configurações → Backups). Registra em public.backup_execucoes;
# avisa os admins no WhatsApp se falhar.
set -uo pipefail
cd "$(dirname "$0")"
AQUI=$(pwd)
source ./config.env
CONF="$BASE/backup.env"
[ -f "$CONF" ] && source "$CONF"
SENHA_ARQ="$BASE/.backup-senha"
MANTER_DIARIO="${MANTER_DIARIO:-7}"; MANTER_SEMANAL="${MANTER_SEMANAL:-4}"; MANTER_MENSAL="${MANTER_MENSAL:-3}"
RCLONE_DESTINO="${RCLONE_DESTINO:-}"
DB="$PREFIXO-db"
DIR="$BASE/backups"; mkdir -p "$DIR"/{diario,semanal,mensal}

sql() { docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
log() { echo "[$(date '+%F %T')] $*"; }

# um backup por vez (o agendado e o manual não se atropelam)
exec 9>"$DIR/.lock"
flock -n 9 || { [ "${1:-}" = "--pedido" ] || log "outro backup em andamento, saindo"; exit 0; }

ORIGEM="agendado"; PEDIDO=""
if [ "${1:-}" = "--pedido" ]; then
  PEDIDO=$(sql -c "update public.backup_pedidos set status='rodando', iniciado_em=now()
    where id = (select id from public.backup_pedidos where status='pendente' order by criado_em limit 1)
    returning id" 2>/dev/null | head -n1)
  [ -n "$PEDIDO" ] || exit 0
  ORIGEM="manual"
  log "backup manual pedido pelo painel (pedido $PEDIDO)"
fi

TS=$(date +%Y%m%d-%H%M)
ARQ="$DIR/diario/$PROJETO-$TS.tar.enc"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
POSTGRES_PASSWORD=$(envget POSTGRES_PASSWORD); SERVICE=$(envget SERVICE_ROLE_KEY)
API="http://127.0.0.1:$PORTA_API/functions/v1"
INICIO=$(date +%s)

registra() { # status arquivo bytes remoto erro drive_id
  sql -v st="$1" -v arq="$2" -v bytes="$3" -v rem="$4" -v err="$5" -v drv="$6" -v org="$ORIGEM" <<'SQL' >/dev/null 2>&1 || true
insert into public.backup_execucoes (status, arquivo, tamanho_bytes, remoto, erro, drive_file_id, origem)
values (:'st', nullif(:'arq',''), nullif(:'bytes','')::bigint, nullif(:'rem',''), nullif(:'err',''), nullif(:'drv',''), :'org');
SQL
  if [ -n "$PEDIDO" ]; then
    sql -c "update public.backup_pedidos set status='$([ "$1" = ok ] && echo concluido || echo falhou)', concluido_em=now() where id=$PEDIDO" >/dev/null 2>&1 || true
  fi
}
avisa() {
  curl -s -m 30 -X POST "$API/aviso-admin" \
    -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"tipo":"admin_backup","texto":sys.argv[1]}))' "$1")" >/dev/null || true
}
falha() {
  log "FALHA: $1"
  registra "falha" "" "" "" "$1" ""
  avisa "⚠️ *BACKUP DO MYLLENET FALHOU*

Etapa: $1
Origem: $ORIGEM
Servidor: vpsfaedi
Quando: $(date '+%d/%m/%Y %H:%M')

Veja o log: $DIR/backup.log"
  exit 1
}

[ -s "$SENHA_ARQ" ] || falha "senha do backup não encontrada ($SENHA_ARQ)"

log "pg_dump"
docker run --rm --network "${PROJETO}_default" -e PGPASSWORD="$POSTGRES_PASSWORD" -v "$TMP":/w "$PG_CLIENT_IMAGE" \
  pg_dump -h db -U supabase_admin -d postgres -Fc -f /w/banco.backup \
  --exclude-table-data=public.pppoe_logs \
  --exclude-table-data=public.mikrotik_status_history \
  --exclude-table-data=public.mikrotik_pppoe_snapshots \
  --exclude-table-data=public.wan_logs \
  --exclude-table-data=public.wan_status_history \
  --exclude-table-data=cron.job_run_details \
  --exclude-table-data=net._http_response \
  || falha "pg_dump"
[ -s "$TMP/banco.backup" ] || falha "pg_dump gerou arquivo vazio"

log "arquivos (.env, compose, storage)"
mkdir -p "$TMP/stack"
cp "$SB_DIR/.env" "$SB_DIR/docker-compose.$PROJETO.yml" "$TMP/stack/" 2>/dev/null || falha "copiar .env/compose"
docker run --rm -v "$SB_DIR/volumes/storage":/s:ro alpine:3 tar -C /s -cf - . > "$TMP/stack/storage.tar" 2>/dev/null \
  || falha "copiar arquivos do Storage"
tar -C "$TMP/stack" -cf "$TMP/arquivos.tar" . || falha "tar dos arquivos"

log "criptografando"
tar -C "$TMP" -cf - banco.backup arquivos.tar \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$SENHA_ARQ" -out "$ARQ" \
  || falha "criptografia"
chmod 600 "$ARQ"
BYTES=$(stat -c %s "$ARQ")

PREFIXOS="diario"
if [ "$(date +%u)" = "7" ]; then cp "$ARQ" "$DIR/semanal/"; PREFIXOS="$PREFIXOS,semanal"; fi
if [ "$(date +%d)" = "01" ]; then cp "$ARQ" "$DIR/mensal/"; PREFIXOS="$PREFIXOS,mensal"; fi
limpa() { ls -1t "$1"/*.tar.enc 2>/dev/null | tail -n +"$(( $2 + 1 ))" | xargs -r rm -f; }
limpa "$DIR/diario" "$MANTER_DIARIO"; limpa "$DIR/semanal" "$MANTER_SEMANAL"; limpa "$DIR/mensal" "$MANTER_MENSAL"

REMOTO=""; DRIVE_ID=""
DRV=$(curl -s -m 60 -X POST "$API/google-drive/token" -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" \
  -H "Content-Type: application/json" -d '{}')
if printf '%s' "$DRV" | grep -q '"conectado":true'; then
  log "enviando para o Google Drive"
  export DRIVE_TOKEN DRIVE_PASTA MANTER_DIARIO MANTER_SEMANAL MANTER_MENSAL
  DRIVE_TOKEN=$(printf '%s' "$DRV" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  DRIVE_PASTA=$(printf '%s' "$DRV" | python3 -c 'import json,sys; print(json.load(sys.stdin)["folder_id"])')
  DRIVE_ID=$(python3 -I "$AQUI/drive_backup.py" "$ARQ" "$PREFIXOS") || falha "envio para o Google Drive"
  REMOTO="Google Drive"
elif printf '%s' "$DRV" | grep -q '"conectado":false'; then
  log "Google Drive não conectado (Configurações → Backups); backup ficou só local"
else
  log "não consegui consultar a conexão do Google Drive: $(printf '%s' "$DRV" | head -c 200)"
fi
if [ -n "$RCLONE_DESTINO" ]; then
  log "copiando para $RCLONE_DESTINO (rclone)"
  rclone sync "$DIR" "$RCLONE_DESTINO" --include "*.tar.enc" --transfers 2 --retries 3 || falha "cópia rclone ($RCLONE_DESTINO)"
  REMOTO="${REMOTO:+$REMOTO + }$RCLONE_DESTINO"
fi

registra "ok" "$(basename "$ARQ")" "$BYTES" "$REMOTO" "" "$DRIVE_ID"
log "ok: $(basename "$ARQ") ($(numfmt --to=iec "$BYTES")) em $(( $(date +%s) - INICIO ))s${REMOTO:+, enviado para $REMOTO}"
