#!/usr/bin/env bash
# Backup diário do MyLLENET (instalado pelo 11-backup.sh no crontab do felipemororo, 03:00)
#
# Gera um arquivo criptografado com:
#   banco.backup  — pg_dump formato custom do banco inteiro (restaura com o 02-restaurar-banco.sh),
#                   sem os DADOS dos logs grandes (pppoe_logs, status do roteador, snapshots, WAN)
#   arquivos.tar  — .env da stack (chaves e senhas), compose do projeto e arquivos do Storage
# Retenção local: 7 diários, 4 semanais (domingo), 3 mensais (dia 1). Cópia no Google Drive (rclone).
# Registra cada execução em public.backup_execucoes; avisa os admins no WhatsApp se falhar.
set -uo pipefail
cd "$(dirname "$0")"
source ./config.env
CONF="$BASE/backup.env"
[ -f "$CONF" ] && source "$CONF"
SENHA_ARQ="$BASE/.backup-senha"
MANTER_DIARIO="${MANTER_DIARIO:-7}"; MANTER_SEMANAL="${MANTER_SEMANAL:-4}"; MANTER_MENSAL="${MANTER_MENSAL:-3}"
RCLONE_DESTINO="${RCLONE_DESTINO:-}"

DIR="$BASE/backups"; mkdir -p "$DIR"/{diario,semanal,mensal}
TS=$(date +%Y%m%d-%H%M)
ARQ="$DIR/diario/$PROJETO-$TS.tar.enc"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
POSTGRES_PASSWORD=$(envget POSTGRES_PASSWORD); SERVICE=$(envget SERVICE_ROLE_KEY)
INICIO=$(date +%s)

log() { echo "[$(date '+%F %T')] $*"; }
sql() {
  docker run --rm -i --network "${PROJETO}_default" -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CLIENT_IMAGE" \
    psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qtA "$@"
}
registra() { # status arquivo bytes remoto erro
  sql -v st="$1" -v arq="$2" -v bytes="$3" -v rem="$4" -v err="$5" <<'SQL' >/dev/null 2>&1 || true
insert into public.backup_execucoes (status, arquivo, tamanho_bytes, remoto, erro)
values (:'st', nullif(:'arq',''), nullif(:'bytes','')::bigint, nullif(:'rem',''), nullif(:'err',''));
SQL
}
avisa() {
  local texto="$1"
  curl -s -m 30 -X POST "http://127.0.0.1:$PORTA_API/functions/v1/aviso-admin" \
    -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"tipo":"admin_backup","texto":sys.argv[1]}))' "$texto")" >/dev/null || true
}
falha() {
  log "FALHA: $1"
  registra "falha" "" "" "" "$1"
  avisa "⚠️ *BACKUP DO MYLLENET FALHOU*

Etapa: $1
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

[ "$(date +%u)" = "7" ] && cp "$ARQ" "$DIR/semanal/"
[ "$(date +%d)" = "01" ] && cp "$ARQ" "$DIR/mensal/"
limpa() { ls -1t "$1"/*.tar.enc 2>/dev/null | tail -n +"$(( $2 + 1 ))" | xargs -r rm -f; }
limpa "$DIR/diario" "$MANTER_DIARIO"; limpa "$DIR/semanal" "$MANTER_SEMANAL"; limpa "$DIR/mensal" "$MANTER_MENSAL"

REMOTO=""
if [ -n "$RCLONE_DESTINO" ]; then
  log "copiando para $RCLONE_DESTINO"
  rclone sync "$DIR" "$RCLONE_DESTINO" --include "*.tar.enc" --transfers 2 --retries 3 \
    || falha "cópia para o Google Drive ($RCLONE_DESTINO)"
  REMOTO="$RCLONE_DESTINO"
fi

registra "ok" "$(basename "$ARQ")" "$BYTES" "$REMOTO" ""
log "ok: $(basename "$ARQ") ($(numfmt --to=iec "$BYTES")) em $(( $(date +%s) - INICIO ))s${REMOTO:+, copiado para $REMOTO}"
