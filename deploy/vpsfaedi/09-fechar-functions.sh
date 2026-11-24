#!/usr/bin/env bash
# 09 — Etapa 1 do plano: fechar as Edge Functions abertas
#   - functions de cron/internas só aceitam a service key (ou x-cron-secret)
#   - functions que o painel chama exigem usuário logado
#   - whatsapp-send / satisfaction-survey deixam de aceitar token forjado
#   - nova fatura-publica (página /fatura/:id voltou a funcionar)
#   Ao final, testa: anon key → 401; token forjado → recusado; service key → ok
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
ANON=$(envget ANON_KEY); SERVICE=$(envget SERVICE_ROLE_KEY)
API="http://127.0.0.1:$PORTA_API/functions/v1"
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> Funções sem checagem de JWT no gateway (lista do config.env)"
sed -i "s#^NO_VERIFY_JWT_FUNCTIONS=.*#NO_VERIFY_JWT_FUNCTIONS=$NO_VERIFY_JWT_FUNCTIONS#" "$SB_DIR/.env"

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)
sleep 5

echo "==> Jobs de cron que chamam functions sem a service key (precisam de ajuste)"
psql_admin -c "select jobname, left(regexp_replace(command, '\s+', ' ', 'g'), 110) comando from cron.job
  where command like '%/functions/v1/%'
    and command not like '%$SERVICE%'
    and command not like '%supabase_service_role_key%'
    and command not like '%myllenet_service_role_key%'
    and command not ilike '%x-cron-secret%'"

echo "==> Teste 1: chave anônima deve ser recusada (esperado 401)"
falhas=0
for fn in auto-block-30d cutoff-warning due-reminder daily-report monthly-invoice-sender mikrotik-alerts \
          mikrotik-sync-logs evolution-monitor mikrotik-speedtest mikrotik-status mikrotik-sync generate-invoice-pdf \
          aviso-bloqueio-admin; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 -X POST "$API/$fn" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}')
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then echo "  ok    $fn ($code)"; else echo "  FALHA $fn ($code)"; falhas=$((falhas+1)); fi
done

echo "==> Teste 2: token forjado com papel service_role deve ser recusado"
FORJADO="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.$(printf '{"role":"service_role","iss":"supabase"}' | base64 | tr -d '=\n' | tr '/+' '_-')."
for rota in whatsapp-send/test satisfaction-survey; do
  code=$(curl -s -o /tmp/forjado.json -w "%{http_code}" -m 15 -X POST "$API/$rota" \
    -H "apikey: $ANON" -H "Authorization: Bearer $FORJADO" -H "Content-Type: application/json" -d '{}')
  if grep -qi '"success": *true' /tmp/forjado.json; then echo "  FALHA $rota aceitou o token forjado"; falhas=$((falhas+1));
  else echo "  ok    $rota recusou ($code)"; fi
done

echo "==> Teste 3: service key continua funcionando (mikrotik-status, só leitura)"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 30 -X POST "$API/mikrotik-status" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" -d '{}')
echo "  mikrotik-status com service key: $code (esperado 200)"; [ "$code" = "200" ] || falhas=$((falhas+1))

echo "==> Teste 4: página pública da fatura"
FID=$(psql_admin -tAc "select id from public.invoices order by created_at desc limit 1")
code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 "$API/fatura-publica?id=$FID" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
echo "  fatura-publica ($FID): $code (esperado 200)  →  https://$DOMINIO_APP/fatura/$FID"; [ "$code" = "200" ] || falhas=$((falhas+1))

echo
if [ "$falhas" = "0" ]; then
  echo "✅ Etapa 1 concluída: todos os testes passaram. Confira o painel logado (Dashboard, Mikrotik, Cobranças)."
else
  echo "⚠️  $falhas teste(s) falharam — cole a saída para o Claude."
fi
