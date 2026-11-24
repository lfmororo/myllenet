#!/usr/bin/env bash
# 08 — Repasse (relay) do host para a API REST do MikroTik
# Na vpsfaedi, a REST do roteador responde ao host mas não aos containers (testado em nov/2026:
# host → 401 ok; containers → timeout, pela rede da stack e pela bridge padrão).
# Solução: um socat em network_mode host escuta em 172.17.0.1:18090 (docker0) e repassa para
# o roteador; as Edge Functions falam com host.docker.internal:18090.
#   uso: ./08-mikrotik-relay.sh [IP_DO_MIKROTIK:PORTA]   (padrão: o host/porta salvos em Configurações)
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
RELAY_PORT=18090
RELAY_BIND=172.17.0.1
CF="$SB_DIR/docker-compose.$PROJETO.yml"
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tA "$@"); }

ip -4 addr show docker0 | grep -q "$RELAY_BIND" || { echo "docker0 não está em $RELAY_BIND — avise o Claude"; exit 1; }

ALVO="${1:-}"
if [ -z "$ALVO" ]; then
  H=$(psql_admin -c "select value from settings where key='mikrotik_host'")
  P=$(psql_admin -c "select value from settings where key='mikrotik_rest_port'")
  [ "$H" = "host.docker.internal" ] && { H=$(grep -E '^MIKROTIK_RELAY_TARGET=' "$SB_DIR/.env" | cut -d= -f2- | cut -d: -f1); }
  [ -n "$H" ] && [ -n "$P" ] || { echo "informe o destino: ./08-mikrotik-relay.sh 206.42.25.226:8090"; exit 1; }
  [ "$P" = "$RELAY_PORT" ] && P=$(grep -E '^MIKROTIK_RELAY_TARGET=' "$SB_DIR/.env" | cut -d= -f2- | cut -d: -f2)
  ALVO="$H:$P"
fi
echo "==> Destino do repasse: $ALVO"
curl -s -m 8 -o /dev/null -w "  teste pelo host: HTTP %{http_code}\n" "http://$ALVO/rest/system/resource"

echo "==> Compose: serviço mikrotik-relay + host.docker.internal nas functions"
if grep -qE '^MIKROTIK_RELAY_TARGET=' "$SB_DIR/.env"; then
  sed -i "s#^MIKROTIK_RELAY_TARGET=.*#MIKROTIK_RELAY_TARGET=$ALVO#" "$SB_DIR/.env"
else
  echo "MIKROTIK_RELAY_TARGET=$ALVO" >> "$SB_DIR/.env"
fi
python3 - "$CF" "$PREFIXO" "$RELAY_BIND" "$RELAY_PORT" <<'PY'
import sys
p, prefixo, bind, port = sys.argv[1:5]
s = open(p).read()
if "host.docker.internal:host-gateway" not in s:
    s = s.replace("  functions:\n", '  functions:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n', 1)
if "mikrotik-relay:" not in s:
    s = s.rstrip("\n") + f"""
  mikrotik-relay:
    image: alpine/socat:latest
    container_name: {prefixo}-mikrotik-relay
    network_mode: host
    restart: unless-stopped
    command: TCP-LISTEN:{port},fork,reuseaddr,bind={bind} TCP:${{MIKROTIK_RELAY_TARGET}}
"""
open(p, "w").write(s)
PY

echo "==> Firewall (ufw): containers → $RELAY_BIND:$RELAY_PORT"
if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow from 172.16.0.0/12 to "$RELAY_BIND" port "$RELAY_PORT" proto tcp comment "$PROJETO mikrotik relay" >/dev/null
fi

echo "==> Subindo"
(cd "$SB_DIR" && docker compose config -q && docker compose up -d mikrotik-relay functions)
sleep 3
docker run --rm --network "${PROJETO}_default" --add-host host.docker.internal:host-gateway curlimages/curl \
  -s -m 8 -o /dev/null -w "  teste pelo container: HTTP %{http_code} (401 = ok)\n" "http://host.docker.internal:$RELAY_PORT/rest/system/resource"

echo "==> Configurações do sistema: MikroTik via repasse"
psql_admin -c "update settings set value='host.docker.internal' where key='mikrotik_host';
  update settings set value='$RELAY_PORT' where key='mikrotik_rest_port';
  update settings set value='' where key='mikrotik_host_secondary';" >/dev/null

K=$(envget SERVICE_ROLE_KEY)
echo "==> mikrotik-sync"
curl -s -X POST "http://127.0.0.1:$PORTA_API/functions/v1/mikrotik-sync" -H "Authorization: Bearer $K" -H "apikey: $K" \
  -H "Content-Type: application/json" -d '{}' | head -c 600; echo
cat <<MSG

Pronto. Em Configurações → MikroTik o host aparece como host.docker.internal, porta $RELAY_PORT.
O endereço real do roteador fica em MIKROTIK_RELAY_TARGET no .env da stack.
Para trocar o IP/porta do roteador:  ./08-mikrotik-relay.sh NOVO_IP:PORTA
MSG
