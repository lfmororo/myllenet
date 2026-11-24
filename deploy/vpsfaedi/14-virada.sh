#!/usr/bin/env bash
# 14 — Etapa 6 do plano: conferência da virada definitiva (Lovable pausada em 24/11/2026)
#   1. últimos registros no banco da VPS (para comparar com o que foi lançado na Lovable)
#   2. referências que ainda apontam para a Lovable (myllenet.lovable.app / projeto antigo)
#   3. agente local e fila antiga de comandos
#   4. sincronização com o MikroTik (a VPS controla o roteador sozinha)
#   5. URLs de webhook para trocar no Mercado Pago
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
SERVICE=$(envget SERVICE_ROLE_KEY)
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> 1. Últimos registros no banco da VPS (horário de Fortaleza)"
psql_admin -c "
select 'cliente cadastrado' o_que, to_char(max(created_at) at time zone 'America/Fortaleza','DD/MM HH24:MI') quando from public.customers
union all select 'fatura criada', to_char(max(created_at) at time zone 'America/Fortaleza','DD/MM HH24:MI') from public.invoices
union all select 'fatura paga', to_char(max(paid_at) at time zone 'America/Fortaleza','DD/MM HH24:MI') from public.invoices
union all select 'notificação enviada', to_char(max(created_at) at time zone 'America/Fortaleza','DD/MM HH24:MI') from public.notification_logs
union all select 'bloqueio/desbloqueio', to_char(max(created_at) at time zone 'America/Fortaleza','DD/MM HH24:MI') from public.block_history"
echo "  Tudo o que foi lançado na Lovable DEPOIS desses horários precisa ser lançado de novo no painel novo."

echo "==> 2. Referências à Lovable que sobraram no banco (sem os logs e o histórico de mensagens)"
psql_admin -tA <<'SQL' | sed 's/^/  /'
select format(
  'select %L || ''.'' || %L || '': '' || count(*) from public.%I where %I::text ~ ''lovable\.app|bleenvuqsrvkmxwaoswb'' having count(*) > 0',
  table_name, column_name, table_name, column_name)
from information_schema.columns
where table_schema = 'public'
  and data_type in ('text', 'character varying', 'jsonb', 'json')
  and table_name not in ('pppoe_logs', 'mikrotik_status_history', 'mikrotik_pppoe_snapshots', 'wan_logs',
                         'wan_status_history', 'notification_logs', 'efi_api_logs', 'diagnosticos', 'backup_execucoes')
  and table_name in (select tablename from pg_tables where schemaname = 'public')
\gexec
SQL
echo "  (nada listado acima = nenhuma referência)"

echo "==> 3. Agente local e fila antiga"
psql_admin -c "select name agente, active ativo, to_char(last_seen_at at time zone 'America/Fortaleza','DD/MM HH24:MI') visto_por_ultimo from public.agent_tokens order by last_seen_at desc nulls last"
psql_admin -c "update public.mikrotik_commands set status = 'error', error_message = 'Cancelado na virada para a VPS (a sincronização via API REST aplica o estado atual)'
  where status in ('pending', 'running')"
echo "  O agente não é mais usado: pode desligar o serviço Node.js dele na máquina onde roda."

echo "==> 4. Sincronização com o MikroTik"
curl -s -m 120 -X POST "http://127.0.0.1:$PORTA_API/functions/v1/mikrotik-sync" \
  -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" -H "Content-Type: application/json" -d '{}' | head -c 700; echo
psql_admin -c "select block_status situacao, count(*) clientes from public.customers where ativo group by 1 order by 1"

cat <<MSG

==> 5. Webhook do Mercado Pago (painel do Mercado Pago → Suas integrações → Webhooks)
   URL de produção: https://$DOMINIO_API/functions/v1/mercadopago/webhook
   Evento: Pagamentos
   (o webhook só serve para dar baixa na hora; sem ele a baixa acontece na consulta a cada hora.
    A função consulta o pagamento direto na API do Mercado Pago, então não confia no conteúdo do aviso.)
   Efí: o sistema confere os pagamentos por consulta a cada 15 min; não há webhook para trocar.

==> Falta fazer à mão
   [ ] Lançar no painel novo o que entrou na Lovable depois dos horários do item 1
   [ ] Desligar o serviço do agente local
   [ ] Trocar o webhook do Mercado Pago (item 5)
   [ ] Atualizar links fixos com myllenet.lovable.app (bio do Instagram, materiais, QR codes)
   [ ] Daqui a 7 dias sem problemas: apagar o projeto na Lovable
MSG
