#!/usr/bin/env bash
# 02c — Restaura (ou completa) só os DADOS de tabelas de log, filtrando pelos últimos N dias.
# Usa a estrutura já criada pelo 02b. Pula tabelas que já tenham linhas.
# Uso: bash 02c-restore-logs.sh /opt/myllenet/secrets/backup/arquivo.backup
# Opcional: KEEP="tabela:coluna_data:dias ..."
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP="${1:-}"
[ -n "$BACKUP" ] && [ -f "$BACKUP" ] || die "Informe o arquivo: bash 02c-restore-logs.sh /caminho/arquivo.backup"
BACKUP=$(readlink -f "$BACKUP"); BDIR=$(dirname "$BACKUP"); BFILE=$(basename "$BACKUP")
WORK="$SECRETS_DIR/restore"; mkdir -p "$WORK"
PGIMG=postgres:18-alpine
KEEP="${KEEP-pppoe_logs:logged_at:45 mikrotik_status_history:logged_at:7 wan_status_history:created_at:7 wan_logs:created_at:30}"

restore_tool() { docker run --rm -i -v "$BDIR":/b:ro -v "$WORK":/w "$PGIMG" "$@"; }
db_psql_replica() {
  docker exec -i -e PGPASSWORD="$(sb_env POSTGRES_PASSWORD)" -e PGOPTIONS="-c session_replication_role=replica" myllenet-db \
    psql -v ON_ERROR_STOP=1 -X -q -h 127.0.0.1 -U supabase_admin -d postgres
}
strip_meta() { sed -E '/^\\(un)?restrict /d'; }
filter_copy_since() {
  awk -v col="$1" -v cut="$2" 'BEGIN { FS = "\t" }
    incopy && $0 == "\\." { incopy = 0; print; next }
    incopy { if (idx == 0 || $idx >= cut || $idx == "\\N") print; next }
    /^COPY / {
      incopy = 1; idx = 0
      h = $0; sub(/^[^(]*\(/, "", h); sub(/\) FROM stdin;$/, "", h)
      n = split(h, c, ", ")
      for (i = 1; i <= n; i++) { gsub(/"/, "", c[i]); if (c[i] == col) idx = i }
      if (idx == 0) print "AVISO: coluna " col " não encontrada; tabela restaurada sem filtro" > "/dev/stderr"
    }
    { print }'
}

restore_tool pg_restore -l "/b/$BFILE" > "$WORK/toc.txt"
for spec in $KEEP; do
  IFS=: read -r kt kc kd <<<"$spec"
  line=$(grep -E "; [0-9]+ [0-9]+ TABLE DATA public $kt " "$WORK/toc.txt" || true)
  [ -n "$line" ] || { warn "$kt: sem dados no backup"; continue; }
  n=$(db_psql postgres -X -tAc "select count(*) from public.\"$kt\"")
  [ "$n" = "0" ] || { warn "$kt já tem $n linhas — pulando"; continue; }
  echo "$line" > "$WORK/only_$kt.list"
  cutoff=$(date -u -d "$kd days ago" +%Y-%m-%d)
  log "$kt: últimos $kd dias (desde $cutoff)"
  restore_tool pg_restore -L "/w/only_$kt.list" --no-owner --no-privileges -f - "/b/$BFILE" </dev/null \
    | strip_meta | filter_copy_since "$kc" "$cutoff" | db_psql_replica >/dev/null
  ok "$kt: $(db_psql postgres -X -tAc "select count(*) from public.\"$kt\"") linhas"
done
db_psql supabase_admin -X -q -c "analyze" >/dev/null 2>&1 || true
df -h / | tail -1
