#!/usr/bin/env bash
# 10 — Etapa 2 do plano: aviso de corte × bloqueio e fuso horário
#   - public.hoje_local(): data de hoje em America/Fortaleza
#   - check_and_block_overdue_customers() passa a usar hoje_local() (antes: CURRENT_DATE em UTC,
#     que às 23h de Brasília já era o dia seguinte → bloqueava com 14 dias, não 15)
#   - cutoff-warning avisa o cliente N dias antes (settings.aviso_corte_dias_antes, padrão 5)
#     com a data exata do bloqueio, pela mesma regra do bloqueio
#   - aviso de véspera aos admins usa a mesma data
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
SERVICE=$(envget SERVICE_ROLE_KEY)
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull

echo "==> Banco"
psql_admin -q <<'SQL'
create or replace function public.hoje_local() returns date
language sql stable as $$ select (now() at time zone 'America/Fortaleza')::date $$;
grant execute on function public.hoje_local() to service_role, authenticated;

insert into public.settings (key, value)
select 'aviso_corte_dias_antes', '5'
where not exists (select 1 from public.settings where key = 'aviso_corte_dias_antes');

create or replace function public.check_and_block_overdue_customers()
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
    v_customer_id uuid;
    v_blocking_days text;
    v_days_interval interval;
    v_hoje date := public.hoje_local();   -- data de Brasília/Fortaleza, não UTC
begin
    select value into v_blocking_days from public.settings where key = 'blocking_days';
    if v_blocking_days is null or v_blocking_days = '' then
        v_blocking_days := '15';
    end if;
    v_days_interval := (v_blocking_days || ' days')::interval;

    -- 1. bloquear
    for v_customer_id in
        select distinct c.id
        from public.customers c
        join public.invoices i on i.customer_id = c.id
        where i.status in ('pending', 'overdue')
          and i.vencimento <= v_hoje - v_days_interval
          and c.block_status = 'active'
          and c.ativo = true
    loop
        insert into public.block_history (customer_id, old_status, new_status, reason)
        values (v_customer_id, 'active', 'blocked', 'Bloqueio automático por faturas vencidas (' || v_blocking_days || ' dias)');
        update public.customers set block_status = 'blocked' where id = v_customer_id;
    end loop;

    -- 2. desbloquear
    for v_customer_id in
        select c.id
        from public.customers c
        where c.block_status = 'blocked'
          and not exists (
            select 1 from public.invoices i
            where i.customer_id = c.id
              and i.status in ('pending', 'overdue')
              and i.vencimento <= v_hoje - v_days_interval
          )
    loop
        insert into public.block_history (customer_id, old_status, new_status, reason)
        values (v_customer_id, 'blocked', 'active', 'Desbloqueio automático (faturas regularizadas)');
        update public.customers set block_status = 'active' where id = v_customer_id;
    end loop;
end;
$function$;
SQL

echo "==> Conferência"
psql_admin -c "select public.hoje_local() hoje_local, current_date data_utc,
  (select value from settings where key='blocking_days') dias_bloqueio,
  (select value from settings where key='aviso_corte_dias_antes') aviso_dias_antes"
psql_admin -c "select jobname, schedule from cron.job where command ilike '%check_and_block%' or command ilike '%cutoff-warning%' or command ilike '%aviso-bloqueio-admin%'"
psql_admin -c "select 'hoje 23h' quando, nome, faturas, valor_centavos, dias_atraso from public.clientes_a_bloquear(public.hoje_local())
  union all select 'amanhã 23h', nome, faturas, valor_centavos, dias_atraso from public.clientes_a_bloquear(public.hoje_local() + 1)"

echo "==> Simulação do aviso ao cliente (não envia nada)"
curl -s -X POST "http://127.0.0.1:$PORTA_API/functions/v1/cutoff-warning" \
  -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" -H "Content-Type: application/json" \
  -d '{"simular": true}' | head -c 1500; echo

cat <<'MSG'

✅ Etapa 2 aplicada.
   - Bloqueio: 23h, com exatamente "blocking_days" dias de atraso (data de Fortaleza)
   - Aviso ao cliente: "aviso_corte_dias_antes" dias antes, com a data do bloqueio (meio-dia)
   - Ajuste os dois em Configurações → MikroTik
MSG
