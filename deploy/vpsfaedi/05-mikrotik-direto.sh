#!/usr/bin/env bash
# 05 — MikroTik só pela API REST (sem agente local)
#   - mikrotik-sync-logs passa a rodar a cada minuto (gera os eventos de conexão/desconexão
#     que o agente gerava)
#   - agenda os jobs que faltarem (alertas, monitor da Evolution, lembretes, faturas do mês),
#     sem duplicar os que já vieram do backup
#   - desativa os tokens do agente (evita alerta de "agente offline")
#   - atualiza as functions e o painel (./04-frontend.sh --pull)
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
POSTGRES_PASSWORD=$(envget POSTGRES_PASSWORD); SERVICE_ROLE_KEY=$(envget SERVICE_ROLE_KEY)
psql_admin() { docker run --rm -i --network "${PROJETO}_default" -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$PG_CLIENT_IMAGE" psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull

echo "==> Jobs de cron"
psql_admin <<SQL
do \$\$
declare
  j record;
  k text := '$SERVICE_ROLE_KEY';
  jid bigint;
begin
  for j in select * from (values
    ('mikrotik-sync-logs',     '* * * * *',  'mikrotik-sync-logs'),
    ('mikrotik-alerts',        '*/5 * * * *','mikrotik-alerts'),
    ('evolution-monitor',      '*/5 * * * *','evolution-monitor'),
    ('daily-report',           '0 10 * * *', 'daily-report'),
    ('due-reminder',           '0 11 * * *', 'due-reminder'),
    ('cutoff-warning',         '0 12 * * *', 'cutoff-warning'),
    ('monthly-invoice-sender', '0 9 1 * *',  'monthly-invoice-sender')
  ) as t(nome, agenda, fn)
  loop
    select jobid into jid from cron.job where command like '%/functions/v1/' || j.fn || '''%'
      or command like '%/functions/v1/' || j.fn || '"%' limit 1;
    if jid is not null then
      if j.fn = 'mikrotik-sync-logs' then
        perform cron.alter_job(jid, schedule := '* * * * *');
        raise notice 'ajustado para cada minuto: %', j.fn;
      else
        raise notice 'já existia: %', j.fn;
      end if;
    else
      perform cron.schedule(j.nome, j.agenda, format(
        'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb) as request_id;',
        'http://kong:8000/functions/v1/' || j.fn,
        json_build_object('Content-Type','application/json','Authorization','Bearer ' || k)::text,
        '{}'));
      raise notice 'agendado: % [%]', j.fn, j.agenda;
    end if;
  end loop;
end \$\$;

update public.agent_tokens set active = false where active;
SQL
psql_admin -c "select jobname, schedule from cron.job order by jobname"

cat <<'MSG'

✅ MikroTik agora só pela API REST.
   Já pode parar o agente local (serviço Node.js).
   Em 2 minutos, confira se os eventos estão chegando:
     docker exec myllenet-db psql -U postgres -c "select event_type, count(*), max(logged_at) from pppoe_logs where logged_at > now() - interval '10 min' group by 1"
MSG
