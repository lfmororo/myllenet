#!/usr/bin/env bash
# 12 — Etapa 4 do plano: diagnóstico cruzado com o MikroTik e o plano
#   - a function diagnostico passa a gerar a "Visão do provedor" sozinha (sem agente):
#     sessão PPPoE, ping do concentrador até o cliente, tráfego da sessão, limite da fila,
#     quedas em 24 h / 7 dias, % do plano e uma leitura para o atendimento
#   - aviso ao admin no WhatsApp com essa visão e link direto para o diagnóstico
#   - página do cliente mostra a velocidade como % do plano
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)

echo "==> Conferindo os comandos da API REST usados no diagnóstico"
LOGIN=$(psql_admin -tAc "select u from (select jsonb_array_elements_text(usernames) u from public.mikrotik_pppoe_snapshots
  where collection_ok order by collected_at desc limit 1) x limit 1" | head -n1)
H=$(psql_admin -tAc "select value from settings where key='mikrotik_host'")
P=$(psql_admin -tAc "select value from settings where key='mikrotik_rest_port'")
U=$(psql_admin -tAc "select value from settings where key='mikrotik_username'")
S=$(psql_admin -tAc "select value from settings where key='mikrotik_password'")
if [ -z "$LOGIN" ]; then
  echo "  nenhum cliente conectado no último snapshot (o mikrotik-sync-logs está rodando?)"
else
  echo "  cliente de teste: $LOGIN   via $H:$P"
  rest() { docker run --rm --network "${PROJETO}_default" --add-host host.docker.internal:host-gateway curlimages/curl \
    -s -m 20 -u "$U:$S" -H "Content-Type: application/json" "$@"; }
  IP=$(rest "http://$H:$P/rest/ppp/active?name=$LOGIN" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["address"] if d else "")')
  echo "  /ppp/active ............ ${IP:-sem sessão}"
  if [ -n "$IP" ]; then
    rest -X POST "http://$H:$P/rest/ping" -d "{\"address\":\"$IP\",\"count\":\"5\",\"interval\":\"0.2\"}" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); u=d[-1]; print("  /ping .................. perda", u.get("packet-loss"), "% · média", u.get("avg-rtt"))'
    rest -X POST "http://$H:$P/rest/interface/monitor-traffic" -d "{\"interface\":\"<pppoe-$LOGIN>\",\"once\":\"\"}" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); t=d[0] if isinstance(d,list) else d; print("  /monitor-traffic ....... ↓", round(int(t.get("tx-bits-per-second",0))/1e6,2), "Mbps ↑", round(int(t.get("rx-bits-per-second",0))/1e6,2), "Mbps")' \
      || echo "  /monitor-traffic ....... não respondeu (o nome da interface pode ser diferente)"
    rest "http://$H:$P/rest/queue/simple?name=%3Cpppoe-$LOGIN%3E" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  /queue/simple .......... max-limit", d[0].get("max-limit") if d else "sem fila dinâmica para este cliente")'
  fi
fi
unset S

cat <<'MSG'

✅ Etapa 4 aplicada.
   Teste de aceite: peça a um cliente (ou faça você, pelo link de diagnóstico de um cliente)
   um teste por Wi-Fi e outro por cabo. Em Diagnósticos, abra o teste: a "Visão do provedor"
   aparece em alguns segundos, com ping até o cliente, quedas, tráfego, limite e % do plano.
   O aviso no WhatsApp dos admins traz o mesmo resumo e o link direto.
MSG
