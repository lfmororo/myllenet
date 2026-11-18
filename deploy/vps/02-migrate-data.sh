#!/usr/bin/env bash
# 02 — Copia banco, logins, crons e segredos da Lovable Cloud para o Supabase do MyLLENET.
# Pré-requisitos: 01-install-supabase.sh concluído e a função temporária
# myllenet-export publicada na Lovable Cloud (veja README.md).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker docker.io
need jq jq
need curl curl
[ -f "$SB_DIR/.env" ] || die "Rode antes o 01-install-supabase.sh"
docker inspect -f '{{.State.Running}}' myllenet-db 2>/dev/null | grep -q true || die "Container myllenet-db não está rodando"

mkdir -p "$SECRETS_DIR/dump"; chmod 700 "$SECRETS_DIR"
EXPORT_JSON="$SECRETS_DIR/lovable-export.json"
DUMP="$SECRETS_DIR/dump"
PGIMG=postgres:17-alpine

# ---------------------------------------------------------------- 1. credenciais
if [ ! -s "$EXPORT_JSON" ]; then
  log "Buscando credenciais na função temporária myllenet-export"
  if [ -s "$SECRETS_DIR/export.key" ]; then
    EXPORT_KEY=$(tr -d '[:space:]' < "$SECRETS_DIR/export.key")
  else
    read -r -s -p "Cole a chave do export (EXPORT_KEY) e tecle Enter: " EXPORT_KEY; echo
  fi
  [ -n "$EXPORT_KEY" ] || die "Chave vazia"
  code=$(curl -sS -o "$EXPORT_JSON.tmp" -w '%{http_code}' \
    "$OLD_SUPABASE_URL/functions/v1/myllenet-export" \
    -H "apikey: $OLD_ANON_KEY" -H "Authorization: Bearer $OLD_ANON_KEY" \
    -H "x-export-key: $EXPORT_KEY")
  [ "$code" = "200" ] || { cat "$EXPORT_JSON.tmp" >&2; rm -f "$EXPORT_JSON.tmp"; die "myllenet-export respondeu HTTP $code"; }
  mv "$EXPORT_JSON.tmp" "$EXPORT_JSON"; chmod 600 "$EXPORT_JSON"
  unset EXPORT_KEY
fi
jq -e '.SUPABASE_DB_URL | strings | length > 10' "$EXPORT_JSON" >/dev/null || die "SUPABASE_DB_URL ausente em $EXPORT_JSON"
ok "credenciais salvas em $EXPORT_JSON (apague depois da migração)"

SRC_URL=$(jq -r .SUPABASE_DB_URL "$EXPORT_JSON")
OLD_SERVICE_KEY=$(jq -r '.SUPABASE_SERVICE_ROLE_KEY // empty' "$EXPORT_JSON")
OLD_ANON_FROM_FN=$(jq -r '.SUPABASE_ANON_KEY // empty' "$EXPORT_JSON")

docker image inspect "$PGIMG" >/dev/null 2>&1 || docker pull -q "$PGIMG" >/dev/null

src_psql() { docker run --rm -i --network host -e SRC="$SRC_URL" "$PGIMG" sh -c 'psql "$SRC" -v ON_ERROR_STOP=1 -X -q "$@"' sh "$@"; }
src_dump() { docker run --rm -i --network host -e SRC="$SRC_URL" "$PGIMG" sh -c 'pg_dump "$SRC" "$@"' sh "$@"; }
db_psql_replica() {
  docker exec -i -e PGPASSWORD="$(sb_env POSTGRES_PASSWORD)" -e PGOPTIONS="-c session_replication_role=replica" myllenet-db \
    psql -v ON_ERROR_STOP=1 -X -q -h 127.0.0.1 -U supabase_admin -d postgres "$@"
}

# ---------------------------------------------------------------- 2. conexão com o banco antigo
log "Testando conexão com o banco da Lovable Cloud"
if ! src_psql -tAc 'select 1' >/dev/null 2>&1; then
  warn "Conexão direta falhou (o host db.*.supabase.co é só IPv6). Tentando o pooler IPv4…"
  # postgresql://usuario:senha@host:porta/banco
  if [[ "$SRC_URL" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+) ]]; then
    PASS="${BASH_REMATCH[3]}"; DBN="${BASH_REMATCH[7]}"
  else
    die "Formato inesperado de SUPABASE_DB_URL"
  fi
  found=""
  for prefix in aws-0 aws-1; do
    for region in sa-east-1 us-east-1 us-east-2 us-west-1 us-west-2 ca-central-1 eu-central-1 eu-west-1 eu-west-2 eu-west-3 eu-north-1 ap-south-1 ap-southeast-1 ap-southeast-2 ap-northeast-1 ap-northeast-2; do
      cand="postgresql://postgres.${OLD_PROJECT_REF}:${PASS}@${prefix}-${region}.pooler.supabase.com:5432/${DBN}"
      if docker run --rm --network host -e SRC="$cand" "$PGIMG" sh -c 'psql "$SRC" -X -tAc "select 1"' >/dev/null 2>&1; then
        found="$cand"; ok "pooler encontrado: ${prefix}-${region}"; break 2
      fi
    done
  done
  [ -n "$found" ] || die "Não consegui conectar ao banco antigo nem pelo pooler. Habilite IPv6 na VPS ou rode este script de outra máquina com IPv6."
  SRC_URL="$found"
fi
SRC_VER=$(src_psql -tAc 'show server_version')
ok "conectado (Postgres $SRC_VER)"

# ---------------------------------------------------------------- 3. o banco novo precisa estar vazio
existing=$(db_psql postgres -X -tAc "select count(*) from pg_tables where schemaname='public'")
if [ "$existing" != "0" ]; then
  die "O schema public do banco novo já tem $existing tabelas. Para refazer do zero: cd $SB_DIR && docker compose down && rm -rf volumes/db/data && docker compose up -d"
fi

# ---------------------------------------------------------------- 4. exportação
log "Exportando estrutura do schema public"
src_dump --schema=public --schema-only --no-owner --no-privileges --no-publications --no-subscriptions > "$DUMP/01_schema_public.sql"
sed -i -E '/^CREATE SCHEMA public;$/d; /^COMMENT ON SCHEMA public IS/d; /^ALTER SCHEMA public OWNER/d' "$DUMP/01_schema_public.sql"
ok "$(grep -c '^CREATE TABLE' "$DUMP/01_schema_public.sql") tabelas, $(grep -c '^CREATE FUNCTION\|^CREATE OR REPLACE FUNCTION' "$DUMP/01_schema_public.sql") funções, $(grep -c '^CREATE POLICY' "$DUMP/01_schema_public.sql") políticas RLS"

log "Exportando dados do schema public"
src_dump --schema=public --data-only --no-owner --no-privileges > "$DUMP/03_data_public.sql"
ok "$(du -h "$DUMP/03_data_public.sql" | cut -f1) de dados"

log "Exportando extensões, gatilhos de auth.users, publicações realtime e crons"
src_psql -tAc "select extname from pg_extension where extname not in ('plpgsql') order by 1" > "$DUMP/extensions.txt"
src_psql -tAc "set search_path = ''; select pg_get_triggerdef(t.oid) || ';' from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal" > "$DUMP/04_auth_triggers.sql"
src_psql -tAc "select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename) from pg_publication_tables where pubname = 'supabase_realtime'" > "$DUMP/05_realtime.sql" || true
if src_psql -tAc "select 1 from pg_extension where extname='pg_cron'" | grep -q 1; then
  src_psql -tAc "select format('select cron.schedule(%L, %L, %L);', coalesce(jobname, 'job_' || jobid), schedule, command) from cron.job where active order by jobid" > "$DUMP/06_cron.sql"
else
  : > "$DUMP/06_cron.sql"
fi
vault_count=$(src_psql -tAc "select count(*) from vault.secrets" 2>/dev/null || echo 0)
ok "extensões: $(tr '\n' ' ' < "$DUMP/extensions.txt")"
ok "gatilhos em auth.users: $(grep -c . "$DUMP/04_auth_triggers.sql" || true) | tabelas realtime: $(grep -c . "$DUMP/05_realtime.sql" || true) | crons: $(grep -c . "$DUMP/06_cron.sql" || true)"
[ "${vault_count:-0}" != "0" ] && warn "Há $vault_count segredo(s) no Vault do banco antigo; eles NÃO são copiados (crons que usem vault.decrypted_secrets precisarão de ajuste)."

# Crons: URL antiga -> gateway interno; chaves antigas -> novas
NEW_ANON=$(sb_env ANON_KEY); NEW_SERVICE=$(sb_env SERVICE_ROLE_KEY)
sed -i "s|$OLD_SUPABASE_URL|http://kong:8000|g" "$DUMP/06_cron.sql"
sed -i "s|$OLD_ANON_KEY|$NEW_ANON|g" "$DUMP/06_cron.sql"
[ -n "$OLD_ANON_FROM_FN" ] && sed -i "s|$OLD_ANON_FROM_FN|$NEW_ANON|g" "$DUMP/06_cron.sql"
[ -n "$OLD_SERVICE_KEY" ] && sed -i "s|$OLD_SERVICE_KEY|$NEW_SERVICE|g" "$DUMP/06_cron.sql"
if grep -q "$OLD_PROJECT_REF" "$DUMP/06_cron.sql"; then warn "Ainda há referências a $OLD_PROJECT_REF nos crons — revise $DUMP/06_cron.sql"; fi

# ---------------------------------------------------------------- 5. importação
log "Criando extensões no banco novo"
while read -r ext; do
  [ -z "$ext" ] && continue
  if db_psql supabase_admin -X -tAc "select 1 from pg_extension where extname='$ext'" | grep -q 1; then continue; fi
  db_psql supabase_admin -X -q -c "create extension if not exists \"$ext\" with schema extensions" >/dev/null 2>&1 \
    || db_psql supabase_admin -X -q -c "create extension if not exists \"$ext\"" >/dev/null 2>&1 \
    || warn "extensão $ext não pôde ser criada"
done < "$DUMP/extensions.txt"

log "Recriando a estrutura (tabelas, funções, RLS)"
# FKs/funções do public referenciam auth.users; garante o privilégio ao dono (postgres)
db_psql supabase_admin -X -q -c "grant usage on schema auth to postgres; grant select, references on auth.users to postgres"
db_psql postgres -X -q < "$DUMP/01_schema_public.sql"
db_psql postgres -X -q <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
SQL
ok "estrutura criada"

log "Copiando usuários (logins e senhas)"
for t in users identities; do
  cols=$(db_psql supabase_admin -X -tAc "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema='auth' and table_name='$t' and is_generated='NEVER'")
  srccols=$(src_psql -tAc "select string_agg(column_name, ',') from information_schema.columns where table_schema='auth' and table_name='$t'")
  common=$(tr ',' '\n' <<<"$cols" | tr -d '"' | grep -Fxf <(tr ',' '\n' <<<"$srccols") | sed 's/.*/"&"/' | paste -sd, -)
  [ -n "$common" ] || die "Sem colunas em comum para auth.$t"
  src_psql -c "copy (select $common from auth.$t) to stdout" | db_psql_replica -c "copy auth.$t ($common) from stdin"
  ok "auth.$t: $(db_psql supabase_admin -X -tAc "select count(*) from auth.$t") registros"
done

log "Copiando os dados (pode demorar conforme o volume de logs)"
db_psql_replica < "$DUMP/03_data_public.sql"
ok "dados importados"

log "Gatilhos, realtime e crons"
[ -s "$DUMP/04_auth_triggers.sql" ] && db_psql supabase_admin -X -q < "$DUMP/04_auth_triggers.sql"
[ -s "$DUMP/05_realtime.sql" ] && { db_psql supabase_admin -X -q < "$DUMP/05_realtime.sql" || warn "falha ao configurar realtime"; }
if [ -s "$DUMP/06_cron.sql" ]; then
  db_psql supabase_admin -X -q -c "create extension if not exists pg_cron" >/dev/null 2>&1 || true
  db_psql postgres -X -q < "$DUMP/06_cron.sql"
fi
db_psql postgres -X -q -c "notify pgrst, 'reload schema'"
ok "concluído"

# ---------------------------------------------------------------- 6. segredos das Edge Functions
log "Gravando segredos das Edge Functions em $SB_DIR/functions.env"
{
  echo "# Gerado por 02-migrate-data.sh em $(date -Iseconds)"
  echo "APP_PUBLIC_URL=https://$APP_DOMAIN"
  jq -r 'to_entries[] | select(.key | startswith("SUPABASE_") | not) | select(.value != null and .value != "") | "\(.key)=\(.value)"' "$EXPORT_JSON"
} > "$SB_DIR/functions.env"
chmod 600 "$SB_DIR/functions.env"
ok "$(grep -vc '^#' "$SB_DIR/functions.env") variáveis"

# ---------------------------------------------------------------- 7. conferência
log "Conferindo contagem de linhas (antigo x novo)"
tables=$(db_psql postgres -X -tAc "select tablename from pg_tables where schemaname='public' order by 1")
printf '%-34s %10s %10s\n' TABELA ANTIGO NOVO
diff_found=0
for t in $tables auth.users; do
  if [[ "$t" == *.* ]]; then q="select count(*) from $t"; else q="select count(*) from public.\"$t\""; fi
  a=$(src_psql -tAc "$q"); b=$(db_psql supabase_admin -X -tAc "$q")
  flag=""; [ "$a" != "$b" ] && { flag="  <-- diferente"; diff_found=1; }
  printf '%-34s %10s %10s%s\n' "$t" "$a" "$b" "$flag"
done
[ "$diff_found" = "0" ] && ok "todas as tabelas batem" || warn "Há diferenças (normal em tabelas de log que continuam recebendo dados na Lovable)."

cat <<EOF

Migração dos dados concluída.
Próximos passos:
  bash 03-deploy-functions.sh
  bash 04-build-frontend.sh
EOF
