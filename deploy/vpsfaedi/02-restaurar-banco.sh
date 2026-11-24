#!/usr/bin/env bash
# 02 — Restaura o backup da Lovable (pg_dump .backup) no Supabase do MyLLENET
#   uso: ./02-restaurar-banco.sh /caminho/backup.backup
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)
source ./config.env

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

BACKUP=$(readlink -f "${1:-}") || true
[ -f "$BACKUP" ] || die "informe o arquivo .backup: ./02-restaurar-banco.sh /caminho/backup.backup"
[ -f "$SB_DIR/.env" ] || die "rode o 01-supabase.sh primeiro"
POSTGRES_PASSWORD=$(envget POSTGRES_PASSWORD); SERVICE_ROLE_KEY=$(envget SERVICE_ROLE_KEY); CRON_SECRET=$(envget CRON_SECRET)

NET="${PROJETO}_default"
WORK="$BASE/restore"; mkdir -p "$WORK"; cp "$BACKUP" "$WORK/lovable.backup"

# cliente Postgres 17 em container, na rede da stack (host "db")
pgc() { docker run --rm -i --network "$NET" -v "$WORK":/w -v "$HERE":/s \
          -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_CLIENT_IMAGE" "$@"; }
psql_admin() { pgc psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

say "Conferindo o backup"
pgc pg_restore -l /w/lovable.backup > "$WORK/lista.txt" || die "não consegui ler o backup (é um pg_dump formato custom?)"
echo "  schemas no backup: $(grep -oE 'SCHEMA - [a-z_]+|TABLE [a-z_]+ ' "$WORK/lista.txt" | awk '{print $NF}' | sort -u | tr '\n' ' ')"
N_PUB=$(psql_admin -tAc "select count(*) from pg_tables where schemaname='public'")
[ "$N_PUB" = "0" ] || die "o schema public do destino já tem $N_PUB tabelas — restauração já foi feita? (para refazer: recrie a stack)"

say "Extensões"
psql_admin <<'SQL'
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
SQL

say "Usuários (auth.users / auth.identities) e Storage (buckets / objetos)"
psql_admin -tAc "select table_schema||'.'||table_name, column_name from information_schema.columns
  where (table_schema,table_name) in (('auth','users'),('auth','identities'),('storage','buckets'),('storage','objects'))
    and is_generated='NEVER'" -F $'\t' > "$WORK/colunas.tsv"
pgc pg_restore --data-only -n auth -t users -t identities -f /w/auth.sql /w/lovable.backup
pgc pg_restore --data-only -n storage -t buckets -t objects -f /w/storage.sql /w/lovable.backup
cat "$WORK/auth.sql" "$WORK/storage.sql" > "$WORK/dados.sql"
python3 "$HERE/filtrar_copy.py" "$WORK/dados.sql" "$WORK/colunas.tsv" "$WORK/dados-filtrados.sql" "$WORK/objetos.tsv"
psql_admin -f /w/dados-filtrados.sql

say "Schema public (tabelas, funções, RLS, dados)"
# erros como "schema public already exists" são esperados e inofensivos
pgc pg_restore -h db -U supabase_admin -d postgres --no-owner --role=postgres \
    -n public /w/lovable.backup 2> "$WORK/public-erros.log" || true
grep -E "^pg_restore: error" "$WORK/public-erros.log" | grep -v 'schema "public" already exists' \
  | grep -v 'transaction_timeout' | head -20 || true
echo "  (log completo: $WORK/public-erros.log)"

say "Triggers de auth.users, policies do Storage e settings"
psql_admin <<SQL
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
drop trigger if exists on_auth_user_created_assign_admin on auth.users;
create trigger on_auth_user_created_assign_admin after insert on auth.users
  for each row execute function public.assign_first_admin();

insert into storage.buckets (id, name, public) values ('certificates', 'certificates', false)
  on conflict (id) do nothing;
drop policy if exists "Admins can upload certificates" on storage.objects;
drop policy if exists "Admins can read certificates" on storage.objects;
drop policy if exists "Admins can update certificates" on storage.objects;
drop policy if exists "Admins can delete certificates" on storage.objects;
create policy "Admins can upload certificates" on storage.objects for insert
  with check (bucket_id = 'certificates' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can read certificates" on storage.objects for select
  using (bucket_id = 'certificates' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can update certificates" on storage.objects for update
  using (bucket_id = 'certificates' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can delete certificates" on storage.objects for delete
  using (bucket_id = 'certificates' and public.has_role(auth.uid(), 'admin'));

-- alguns jobs de cron leem a URL/chave da API na tabela settings
update public.settings set value = 'http://kong:8000' where key = 'supabase_url';
update public.settings set value = '$SERVICE_ROLE_KEY' where key = 'supabase_service_role_key';
SQL

say "Jobs agendados (cron) apontando para a API nova"
pgc pg_restore --data-only -n cron -t job -f /w/cron.sql /w/lovable.backup 2>/dev/null || true
OLD_URL="$OLD_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" CRON_SECRET="$CRON_SECRET" \
  python3 "$HERE/cron_jobs.py" "$WORK/cron.sql" "$WORK/cron-novo.sql"
psql_admin -f /w/cron-novo.sql >/dev/null
psql_admin -c "notify pgrst, 'reload schema'"

say "Conferência"
psql_admin -c "select (select count(*) from auth.users) usuarios,
  (select count(*) from pg_tables where schemaname='public') tabelas_public,
  (select count(*) from storage.buckets) buckets,
  (select count(*) from storage.objects) arquivos,
  (select string_agg(jobname, ', ') from cron.job) jobs_cron"

say "Privilégios (precisa dar 0 — se der outro número, mande a saída para o Claude)"
psql_admin -c "select count(*) as tabelas_sem_acesso from pg_tables t
  where schemaname='public' and not has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'select')"

cat <<EOF

✅ Banco restaurado.
   O certificado da Efí (bucket certificates) e outros arquivos ainda estão na Lovable:
   rode  ./03-copiar-storage.sh  para trazê-los.
EOF
