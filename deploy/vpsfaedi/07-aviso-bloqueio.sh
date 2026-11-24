#!/usr/bin/env bash
# 07 — Avisos de bloqueio para os administradores (Evolution API)
#   - véspera: todo dia às 09:00 (Brasília), lista de quem será bloqueado hoje e amanhã às 23h
#   - na hora: assim que um cliente é bloqueado/desativado (automático ou pelo painel)
#   Administradores = Configurações → "WhatsApp dos administradores" (vários, separados por vírgula)
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
SERVICE_ROLE_KEY=$(envget SERVICE_ROLE_KEY)
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"); }

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull

echo "==> Banco: função de prévia, trigger do aviso imediato e agendamento"
psql_admin -v key="$SERVICE_ROLE_KEY" <<'SQL'
alter table public.block_alerts_sent add column if not exists admin_notified boolean default false;

create or replace function public.hoje_local() returns date
language sql stable as $$ select (now() at time zone 'America/Fortaleza')::date $$;

-- mesmos critérios do check_and_block_overdue_customers(), para uma data de execução
create or replace function public.clientes_a_bloquear(p_data_execucao date)
returns table (customer_id uuid, nome text, telefone text, usuario_pppoe text, faturas int,
               valor_centavos bigint, vencimento_mais_antigo date, dias_atraso int)
language plpgsql stable security definer set search_path to 'public'
as $fn$
declare v_dias int;
begin
  select coalesce(nullif(value, '')::int, 15) into v_dias from public.settings where key = 'blocking_days';
  v_dias := coalesce(v_dias, 15);
  return query
    select c.id, c.nome::text, c.telefone::text, c.usuario_pppoe::text, count(i.id)::int,
           coalesce(sum(i.valor_centavos), 0)::bigint, min(i.vencimento)::date,
           (p_data_execucao - min(i.vencimento)::date)::int
    from public.customers c
    join public.invoices i on i.customer_id = c.id
    where i.status in ('pending', 'overdue')
      and i.vencimento <= p_data_execucao - make_interval(days => v_dias)
      and c.block_status = 'active'
      and c.ativo = true
    group by c.id, c.nome, c.telefone, c.usuario_pppoe
    order by min(i.vencimento), c.nome;
end;
$fn$;
revoke all on function public.clientes_a_bloquear(date) from public, anon, authenticated;
grant execute on function public.clientes_a_bloquear(date) to service_role;

-- chave da API guardada no Vault (não fica em tabela legível pelo painel)
select vault.update_secret(id, :'key') from vault.secrets where name = 'myllenet_service_role_key';
select vault.create_secret(:'key', 'myllenet_service_role_key', 'usada pelos triggers que chamam Edge Functions')
  where not exists (select 1 from vault.secrets where name = 'myllenet_service_role_key');

create or replace function public.notify_admin_block_alert()
returns trigger language plpgsql security definer set search_path to 'public'
as $fn$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'myllenet_service_role_key';
  perform net.http_post(
    url := 'http://kong:8000/functions/v1/aviso-bloqueio-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('modo', 'bloqueado', 'customer_id', new.customer_id,
                               'new_status', new.new_status, 'alert_id', new.id));
  return new;
exception when others then
  -- o aviso nunca pode impedir o bloqueio
  raise warning 'notify_admin_block_alert: %', sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists notify_admin_block_alert on public.block_alerts_sent;
create trigger notify_admin_block_alert after insert on public.block_alerts_sent
  for each row when (new.new_status in ('blocked', 'deactivated'))
  execute function public.notify_admin_block_alert();

select cron.unschedule(jobid) from cron.job where jobname = 'aviso-bloqueio-admin-previa';
select cron.schedule('aviso-bloqueio-admin-previa', '0 12 * * *', $c$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/aviso-bloqueio-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'myllenet_service_role_key')),
    body := '{"modo": "previa"}'::jsonb) as request_id;
$c$);
SQL

echo "==> Quem seria bloqueado hoje e amanhã (conferência, sem enviar nada)"
psql_admin -c "select 'hoje 23h' quando, * from public.clientes_a_bloquear(public.hoje_local())
  union all select 'amanhã 23h', * from public.clientes_a_bloquear(public.hoje_local() + 1)"
psql_admin -c "select key, value from public.settings where key = 'admin_whatsapp'"

echo
read -rp "Enviar agora a prévia para os administradores, como teste? (s/N): " R
if [ "${R,,}" = "s" ]; then
  curl -s -X POST "http://127.0.0.1:$PORTA_API/functions/v1/aviso-bloqueio-admin" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d '{"modo":"previa"}'; echo
fi

cat <<'MSG'

✅ Avisos de bloqueio ativos.
   - Prévia diária às 09:00 (só envia se houver alguém para bloquear hoje ou amanhã)
   - Aviso na hora de cada bloqueio/desativação
   Para adicionar administradores: Configurações → WhatsApp → "WhatsApp dos administradores"
   (vários números separados por vírgula).
MSG
