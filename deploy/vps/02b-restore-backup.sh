#!/usr/bin/env bash
# 02b — Restaura no Supabase do MyLLENET um backup (pg_dump formato custom) da Lovable Cloud.
# Alternativa ao 02-migrate-data.sh quando não há acesso direto ao banco antigo.
#
# Uso: bash 02b-restore-backup.sh /opt/myllenet/secrets/backup/arquivo.backup
# Opcional: SKIP_DATA="tabela1 tabela2" pula os DADOS dessas tabelas do public (ex.: logs grandes)
#
# Restaura: estrutura e dados do schema public, auth.users/identities (mesmas senhas),
# gatilhos de auth.users, publicação realtime e crons (reapontados para a VPS).
# Não restaura: vault (cifrado com a chave da Lovable), storage, histórico de crons, realtime.messages.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP="${1:-}"
[ -n "$BACKUP" ] && [ -f "$BACKUP" ] || die "Informe o arquivo: bash 02b-restore-backup.sh /caminho/arquivo.backup"
BACKUP=$(readlink -f "$BACKUP")
BDIR=$(dirname "$BACKUP"); BFILE=$(basename "$BACKUP")
[ -f "$SB_DIR/.env" ] || die "Rode antes o 01-install-supabase.sh"
docker inspect -f '{{.State.Running}}' myllenet-db 2>/dev/null | grep -q true || die "Container myllenet-db não está rodando"

WORK="$SECRETS_DIR/restore"; mkdir -p "$WORK"; chmod 700 "$SECRETS_DIR"
PGIMG=postgres:18-alpine   # backup gerado por pg_dump 18
SKIP_DATA="${SKIP_DATA:-}"

restore_tool() { docker run --rm -i -v "$BDIR":/b:ro -v "$WORK":/w "$PGIMG" "$@"; }
db_psql_replica() {
  docker exec -i -e PGPASSWORD="$(sb_env POSTGRES_PASSWORD)" -e PGOPTIONS="-c session_replication_role=replica" myllenet-db \
    psql -v ON_ERROR_STOP=1 -X -q -h 127.0.0.1 -U supabase_admin -d postgres "$@"
}
# remove metacomandos \restrict/\unrestrict que o pg_dump 18 coloca no SQL gerado
strip_meta() { sed -E '/^\\(un)?restrict /d'; }

# ---------------------------------------------------------------- 0. checagens
log "Checando o backup e o espaço em disco"
docker image inspect "$PGIMG" >/dev/null 2>&1 || docker pull -q "$PGIMG" >/dev/null
restore_tool pg_restore -l "/b/$BFILE" > "$WORK/toc.txt"
grep -q 'Format: CUSTOM' "$WORK/toc.txt" || die "O arquivo não é um pg_dump em formato custom"
grep -m1 'Archive created at' "$WORK/toc.txt" | sed 's/^;/   /'
size_kb=$(du -k "$BACKUP" | cut -f1)
free_kb=$(df -Pk /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}')
ok "backup: $((size_kb/1024)) MB | livre no disco do Docker: $((free_kb/1024)) MB"
if [ "$free_kb" -lt $((size_kb * 6)) ]; then
  warn "Pouco espaço: os dados descomprimidos podem ocupar várias vezes o backup ($((size_kb*6/1024)) MB estimados)."
  warn "Se faltar espaço, rode com SKIP_DATA=\"pppoe_logs mikrotik_pppoe_snapshots ...\" para pular logs grandes."
  read -r -p "Continuar mesmo assim? (s/N) " a; [ "$a" = "s" ] || [ "$a" = "S" ] || exit 1
fi

existing=$(db_psql postgres -X -tAc "select count(*) from pg_tables where schemaname='public'")
if [ "$existing" != "0" ]; then
  die "O schema public do banco novo já tem $existing tabelas. Para refazer do zero: cd $SB_DIR && docker compose down && rm -rf volumes/db/data && docker compose up -d"
fi

# ---------------------------------------------------------------- 1. listas do TOC
# Linha do TOC: "ID; OID OID TIPO [TIPO...] SCHEMA NOME DONO"
log "Separando o que será restaurado"
TOC="$WORK/toc.txt"
re_public='^[0-9]+; [0-9]+ [0-9]+ ([A-Z][A-Z ]*[A-Z]) public '
grep -E "$re_public" "$TOC" \
  | grep -vE '; [0-9]+ [0-9]+ (TABLE DATA|SEQUENCE SET|ACL|DEFAULT ACL|PUBLICATION TABLE) ' > "$WORK/schema_public.list"
grep -E '; [0-9]+ [0-9]+ PUBLICATION TABLE public ' "$TOC" > "$WORK/realtime.list" || true
grep -E '; [0-9]+ [0-9]+ (TABLE DATA|SEQUENCE SET) public ' "$TOC" > "$WORK/data_public.list"
if [ -n "$SKIP_DATA" ]; then
  for t in $SKIP_DATA; do
    sed -i -E "/; [0-9]+ [0-9]+ TABLE DATA public $t /d" "$WORK/data_public.list"
    warn "dados de public.$t NÃO serão restaurados (SKIP_DATA)"
  done
fi
grep -E '; [0-9]+ [0-9]+ TABLE (DATA )?auth (users|identities) ' "$TOC" > "$WORK/auth_tables.list"
grep -E '; [0-9]+ [0-9]+ TRIGGER auth ' "$TOC" > "$WORK/auth_triggers.list" || true
grep -E '; [0-9]+ [0-9]+ TABLE DATA cron job ' "$TOC" > "$WORK/cron.list" || true
ok "public: $(wc -l < "$WORK/schema_public.list") objetos, $(grep -c 'TABLE DATA' "$WORK/data_public.list") tabelas com dados"
ok "auth: $(wc -l < "$WORK/auth_tables.list") itens, $(wc -l < "$WORK/auth_triggers.list") gatilhos | realtime: $(wc -l < "$WORK/realtime.list") | crons: $(wc -l < "$WORK/cron.list")"

# ---------------------------------------------------------------- 2. extensões
log "Extensões"
for ext in $(grep -E '; [0-9]+ [0-9]+ EXTENSION - ' "$TOC" | awk '{print $6}' | sort -u); do
  case "$ext" in plpgsql|supabase_vault|pg_graphql|pgsodium) continue ;; esac
  if db_psql supabase_admin -X -tAc "select 1 from pg_extension where extname='$ext'" | grep -q 1; then continue; fi
  db_psql supabase_admin -X -q -c "create extension if not exists \"$ext\" with schema extensions" >/dev/null 2>&1 \
    || db_psql supabase_admin -X -q -c "create extension if not exists \"$ext\"" >/dev/null 2>&1 \
    || warn "extensão $ext não pôde ser criada"
done
ok "extensões conferidas"

# ---------------------------------------------------------------- 3. estrutura do public
log "Recriando a estrutura do public (tabelas, funções, RLS)"
restore_tool pg_restore -L /w/schema_public.list --no-owner --no-privileges -f - "/b/$BFILE" \
  | strip_meta | sed -E '/^CREATE SCHEMA public;$/d; /^COMMENT ON SCHEMA public IS/d' > "$WORK/01_schema_public.sql"
db_psql supabase_admin -X -q -c "grant usage on schema auth to postgres; grant select, references on auth.users to postgres"
db_psql postgres -X -q < "$WORK/01_schema_public.sql"
db_psql postgres -X -q <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
SQL
ok "$(db_psql postgres -X -tAc "select count(*) from pg_tables where schemaname='public'") tabelas criadas"

# ---------------------------------------------------------------- 4. usuários (auth)
log "Copiando usuários (logins e senhas)"
restore_tool pg_restore -L /w/auth_tables.list --no-owner --no-privileges -f - "/b/$BFILE" \
  | strip_meta \
  | sed -E '/^(CREATE|ALTER|COPY|COMMENT)/ s/\bauth\.(users|identities)\b/mig_auth.\1/g' > "$WORK/02_auth.sql"
db_psql supabase_admin -X -q -c "set client_min_messages=warning; drop schema if exists mig_auth cascade; create schema mig_auth"
db_psql supabase_admin -X -q < "$WORK/02_auth.sql"
for t in users identities; do
  common=$(db_psql supabase_admin -X -tAc "
    select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
    from information_schema.columns c
    where c.table_schema='auth' and c.table_name='$t' and c.is_generated='NEVER'
      and exists (select 1 from information_schema.columns s
                  where s.table_schema='mig_auth' and s.table_name='$t' and s.column_name=c.column_name)")
  [ -n "$common" ] || die "Sem colunas em comum para auth.$t"
  db_psql_replica -c "insert into auth.$t ($common) select $common from mig_auth.$t"
  ok "auth.$t: $(db_psql supabase_admin -X -tAc "select count(*) from auth.$t") registros"
done
db_psql supabase_admin -X -q -c "set client_min_messages=warning; drop schema mig_auth cascade"

# ---------------------------------------------------------------- 5. dados do public
log "Restaurando os dados (pode demorar bastante com logs grandes)"
restore_tool pg_restore -L /w/data_public.list --no-owner --no-privileges -f - "/b/$BFILE" \
  | strip_meta | db_psql_replica
ok "dados importados"

# ---------------------------------------------------------------- 6. gatilhos, realtime, crons
log "Gatilhos de auth.users e realtime"
if [ -s "$WORK/auth_triggers.list" ]; then
  restore_tool pg_restore -L /w/auth_triggers.list --no-owner -f - "/b/$BFILE" | strip_meta > "$WORK/03_auth_triggers.sql"
  db_psql supabase_admin -X -q < "$WORK/03_auth_triggers.sql"
  ok "$(grep -c '^CREATE TRIGGER' "$WORK/03_auth_triggers.sql") gatilho(s)"
fi
if [ -s "$WORK/realtime.list" ]; then
  restore_tool pg_restore -L /w/realtime.list --no-owner -f - "/b/$BFILE" | strip_meta > "$WORK/04_realtime.sql"
  db_psql supabase_admin -X -q -v ON_ERROR_STOP=0 < "$WORK/04_realtime.sql" || true
  ok "publicação realtime ajustada"
fi

if [ -s "$WORK/cron.list" ]; then
  log "Crons"
  restore_tool pg_restore -L /w/cron.list --no-owner -f - "/b/$BFILE" | strip_meta > "$WORK/05_cron_raw.sql"
  header=$(grep -m1 '^COPY cron\.job ' "$WORK/05_cron_raw.sql") || die "Não achei os dados de cron.job"
  cols=$(sed -E 's/^COPY cron\.job \((.*)\) FROM stdin;$/\1/' <<<"$header")
  coldefs=$(tr ',' '\n' <<<"$cols" | sed -E 's/^ *//; s/$/ text/' | paste -sd, -)
  db_psql supabase_admin -X -q -c "set client_min_messages=warning; drop schema if exists mig_cron cascade; create schema mig_cron; create table mig_cron.job ($coldefs)"
  sed -E 's/^COPY cron\.job /COPY mig_cron.job /' "$WORK/05_cron_raw.sql" | db_psql supabase_admin -X -q
  db_psql supabase_admin -X -tAc "select format('select cron.schedule(%L, %L, %L);', coalesce(nullif(jobname,''), 'job_' || jobid), schedule, command) from mig_cron.job where active in ('t','true') order by jobid::bigint" > "$WORK/06_cron.sql"
  db_psql supabase_admin -X -q -c "set client_min_messages=warning; drop schema mig_cron cascade"

  # URL antiga -> gateway interno; JWTs antigos -> chave nova do mesmo papel
  NEW_ANON=$(sb_env ANON_KEY); NEW_SERVICE=$(sb_env SERVICE_ROLE_KEY)
  sed -i "s|$OLD_SUPABASE_URL|http://kong:8000|g" "$WORK/06_cron.sql"
  for tok in $(grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' "$WORK/06_cron.sql" | sort -u); do
    p=$(cut -d. -f2 <<<"$tok" | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
    role=$(base64 -d <<<"$p" 2>/dev/null | jq -r '.role // empty' 2>/dev/null || true)
    case "$role" in
      service_role) sed -i "s|$tok|$NEW_SERVICE|g" "$WORK/06_cron.sql" ;;
      anon|authenticated) sed -i "s|$tok|$NEW_ANON|g" "$WORK/06_cron.sql" ;;
      *) warn "token JWT com papel desconhecido num cron (mantido): ${tok:0:20}…" ;;
    esac
  done
  grep -q "$OLD_PROJECT_REF" "$WORK/06_cron.sql" && warn "Ainda há referências a $OLD_PROJECT_REF nos crons — revise $WORK/06_cron.sql"
  grep -q 'vault\.' "$WORK/06_cron.sql" && warn "Algum cron usa o vault; ele precisará de ajuste manual ($WORK/06_cron.sql)"
  db_psql postgres -X -q < "$WORK/06_cron.sql" >/dev/null
  ok "$(grep -c 'cron.schedule' "$WORK/06_cron.sql") cron(s) recriado(s):"
  db_psql postgres -X -tAc "select '      ' || jobname || '  [' || schedule || ']' from cron.job order by jobid"
fi

db_psql postgres -X -q -c "notify pgrst, 'reload schema'"

# ---------------------------------------------------------------- 7. segredos das funções
FENV="$SB_DIR/functions.env"
if ! grep -q '^EFI_CLIENT_ID=' "$FENV" 2>/dev/null; then
  log "Criando modelo de segredos das Edge Functions"
  cat > "$FENV" <<EOF
# Segredos das Edge Functions do MyLLENET — preencha e rode: bash 03-deploy-functions.sh
# (os valores ficam só nesta VPS; os mesmos que estavam em Lovable > Cloud > Secrets)
APP_PUBLIC_URL=https://$APP_DOMAIN
WHATSAPP_PROVIDER=uazapi
UAZAPI_TOKEN=
EVOLUTION_BASE_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=
EFI_CLIENT_ID=
EFI_CLIENT_SECRET=
MERCADOPAGO_ACCESS_TOKEN=
AGENTE_TOKEN=
AGENTE_WEBHOOK_URL=
CRON_SECRET=
EOF
  chmod 600 "$FENV"
  ok "modelo criado em $FENV"
fi

# ---------------------------------------------------------------- 8. resumo
log "Contagem de linhas no banco novo"
db_psql supabase_admin -X -q -c "analyze" >/dev/null 2>&1 || true
db_psql postgres -X -tAc "
  select rpad(relname, 34) || lpad(n_live_tup::text, 12)
  from pg_stat_user_tables where schemaname = 'public' order by n_live_tup desc" 2>/dev/null || true
printf '%-34s%12s\n' "auth.users" "$(db_psql supabase_admin -X -tAc 'select count(*) from auth.users')"

cat <<EOF

Restauração concluída.
Próximos passos:
  1. Preencha os segredos em $FENV (nano $FENV)
  2. bash 03-deploy-functions.sh
  3. bash 04-build-frontend.sh
EOF
