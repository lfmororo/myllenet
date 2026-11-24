#!/usr/bin/env bash
# 06 — Controla o crescimento do banco do MyLLENET
#   1. mostra o tamanho e a idade dos logs
#   2. troca a limpeza noturna (cleanup_old_logs) por uma com retenção por tabela,
#      incluindo as tabelas que não tinham limpeza (snapshots, status do roteador)
#   3. agenda a limpeza do histórico do próprio pg_cron
#   4. (opcional) faz a limpeza agora e devolve o espaço ao disco (VACUUM FULL)
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env

# ---- retenção (dias) ----
DIAS_PPPOE=30          # pppoe_logs: consumo (stats) e conexões/desconexões
DIAS_STATUS=7          # mikrotik_status_history: status do roteador a cada chamada
DIAS_SNAPSHOT=2        # mikrotik_pppoe_snapshots: só o último é usado
DIAS_WAN=30            # wan_logs / wan_status_history
DIAS_CRON=3            # cron.job_run_details

psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> Situação atual"
psql_admin -c "
select 'pppoe_logs' tabela, count(*) total, count(*) filter (where logged_at < now() - interval '$DIAS_PPPOE days') a_apagar, min(logged_at)::date mais_antigo from public.pppoe_logs
union all select 'mikrotik_status_history', count(*), count(*) filter (where logged_at < now() - interval '$DIAS_STATUS days'), min(logged_at)::date from public.mikrotik_status_history
union all select 'mikrotik_pppoe_snapshots', count(*), count(*) filter (where collected_at < now() - interval '$DIAS_SNAPSHOT days'), min(collected_at)::date from public.mikrotik_pppoe_snapshots
union all select 'wan_logs', count(*), count(*) filter (where created_at < now() - interval '$DIAS_WAN days'), min(created_at)::date from public.wan_logs"
psql_admin -c "
select logged_at::date dia, count(*) linhas, count(*) filter (where event_type='stats') stats
from public.pppoe_logs where logged_at > now() - interval '7 days' group by 1 order by 1"

echo "==> Índices por data (deixam a limpeza rápida; pode levar alguns minutos na primeira vez)"
psql_admin <<'SQL'
create index if not exists pppoe_logs_logged_at_idx on public.pppoe_logs (logged_at);
create index if not exists mikrotik_status_history_logged_at_idx on public.mikrotik_status_history (logged_at);
create index if not exists mikrotik_pppoe_snapshots_collected_at_idx on public.mikrotik_pppoe_snapshots (collected_at);
create index if not exists wan_logs_created_at_idx on public.wan_logs (created_at);
create index if not exists wan_status_history_created_at_idx on public.wan_status_history (created_at);
SQL

echo "==> Nova limpeza noturna"
psql_admin <<SQL
create or replace function public.cleanup_old_logs()
returns void language plpgsql security definer
set search_path to 'public' set statement_timeout to '25min'
as \$fn\$
declare n int; i int;
begin
  i := 0;
  loop
    delete from public.pppoe_logs where id in (select id from public.pppoe_logs
      where logged_at < now() - interval '$DIAS_PPPOE days' limit 50000);
    get diagnostics n = row_count; i := i + 1;
    exit when n = 0 or i >= 400;
  end loop;
  i := 0;
  loop
    delete from public.mikrotik_status_history where id in (select id from public.mikrotik_status_history
      where logged_at < now() - interval '$DIAS_STATUS days' limit 50000);
    get diagnostics n = row_count; i := i + 1;
    exit when n = 0 or i >= 200;
  end loop;
  i := 0;
  loop
    delete from public.mikrotik_pppoe_snapshots where id in (select id from public.mikrotik_pppoe_snapshots
      where collected_at < now() - interval '$DIAS_SNAPSHOT days' limit 50000);
    get diagnostics n = row_count; i := i + 1;
    exit when n = 0 or i >= 200;
  end loop;
  delete from public.wan_logs where created_at < now() - interval '$DIAS_WAN days';
  delete from public.wan_status_history where created_at < now() - interval '$DIAS_WAN days';
end;
\$fn\$;
revoke all on function public.cleanup_old_logs() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('nightly-log-cleanup', 'cron-history-cleanup');
-- 03:30 em Brasília
select cron.schedule('nightly-log-cleanup', '30 6 * * *', 'select public.cleanup_old_logs();');
select cron.schedule('cron-history-cleanup', '0 7 * * *',
  \$c\$delete from cron.job_run_details where end_time < now() - interval '$DIAS_CRON days'\$c\$);
SQL
echo "  limpeza noturna agendada para 03:30 (pppoe $DIAS_PPPOE d, status $DIAS_STATUS d, snapshots $DIAS_SNAPSHOT d, wan $DIAS_WAN d, cron $DIAS_CRON d)"

echo
read -rp "Fazer a limpeza AGORA e devolver o espaço ao disco? Trava os logs por alguns minutos (s/N): " R
[ "${R,,}" = "s" ] || { echo "Ok, a limpeza roda sozinha às 03:30 (sem devolver espaço ao disco; ele é reaproveitado)."; exit 0; }

echo "==> Apagando o que passou da retenção (em lotes)"
until [ "$(psql_admin -tAc "select public.cleanup_old_logs(); select (select count(*) from (select 1 from public.pppoe_logs where logged_at < now() - interval '$DIAS_PPPOE days' limit 1) a)
  + (select count(*) from (select 1 from public.mikrotik_status_history where logged_at < now() - interval '$DIAS_STATUS days' limit 1) b)
  + (select count(*) from (select 1 from public.mikrotik_pppoe_snapshots where collected_at < now() - interval '$DIAS_SNAPSHOT days' limit 1) c)" | tail -n1)" = "0" ]; do
  echo "  ... ainda há linhas antigas, mais uma rodada"
done
psql_admin -c "delete from cron.job_run_details where end_time < now() - interval '$DIAS_CRON days'"

echo "==> VACUUM FULL (devolve o espaço ao disco)"
for t in mikrotik_pppoe_snapshots mikrotik_status_history wan_logs wan_status_history pppoe_logs; do
  echo "  $t"; psql_admin -c "vacuum (full, analyze) public.$t"
done
psql_admin -c "vacuum (full, analyze) cron.job_run_details"
psql_admin -c "select pg_size_pretty(pg_database_size('postgres')) banco_agora"
