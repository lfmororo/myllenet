#!/usr/bin/env bash
# 01 — Instala um Supabase auto-hospedado ISOLADO para o MyLLENET.
# Não toca no Supabase do vigilant: nome de projeto, containers, rede e portas próprios.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

need docker docker.io
need git git
need openssl openssl
need jq jq
need curl curl
docker compose version >/dev/null 2>&1 || die "docker compose (plugin v2) não encontrado."

if [ -f "$SB_DIR/.env" ]; then
  die "$SB_DIR já existe. Para reinstalar do zero: (cd $SB_DIR && docker compose down -v) && rm -rf $SB_DIR"
fi

log "Conferindo portas locais livres"
for p in "$API_GW_LOCAL_PORT" "$EDGE_LOCAL_PORT" "$POOLER_SESSION_LOCAL_PORT" "$POOLER_TX_LOCAL_PORT"; do
  if ss -ltnH "( sport = :$p )" | grep -q .; then die "Porta $p já está em uso. Troque em config.env."; fi
done
ok "portas $API_GW_LOCAL_PORT $EDGE_LOCAL_PORT $POOLER_SESSION_LOCAL_PORT $POOLER_TX_LOCAL_PORT livres"

log "Conferindo conflitos de nomes de containers"
if docker ps -a --format '{{.Names}}' | grep -qE '^myllenet-'; then
  die "Já existem containers myllenet-*. Remova-os antes (docker ps -a | grep myllenet-)."
fi
ok "nenhum container myllenet-* existente"

log "Baixando a configuração oficial do Supabase self-hosted"
REF="${SUPABASE_REF:-}"
if [ -z "$REF" ]; then
  REF=$(git ls-remote --tags --refs https://github.com/supabase/supabase 2>/dev/null \
    | sed 's#^.*refs/tags/##' | grep -E '^self-hosted/v[0-9]' | sort -V | tail -n1 || true)
fi
[ -n "$REF" ] || die "Não encontrei a tag self-hosted/v*. Defina SUPABASE_REF em config.env."
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git clone -q --filter=blob:none --no-checkout --depth=1 --branch "$REF" https://github.com/supabase/supabase "$TMP/sb"
( cd "$TMP/sb" && git sparse-checkout init --cone && git sparse-checkout set docker && git checkout -q )
mkdir -p "$SB_DIR"
cp -a "$TMP/sb/docker/." "$SB_DIR/"
echo "$REF" > "$SB_DIR/.supabase-version"
ok "Supabase $REF copiado para $SB_DIR"

cd "$SB_DIR"
cp .env.example .env
chmod 600 .env

log "Isolando o projeto (nome, containers e portas) do Supabase do vigilant"
grep -qE '^name: supabase$' docker-compose.yml || die "docker-compose.yml sem 'name: supabase' — versão inesperada, revise manualmente."
sed -i -E 's/^name: supabase$/name: myllenet/' docker-compose.yml
sed -i -E 's/container_name: (realtime-dev\.)?supabase-/container_name: \1myllenet-/' docker-compose.yml
grep -rlZ 'realtime-dev\.supabase-realtime' docker-compose.yml volumes | xargs -0 -r sed -i 's/realtime-dev\.supabase-realtime/realtime-dev.myllenet-realtime/g'
[ -f volumes/logs/vector.yml ] && sed -i -E 's/"supabase-([a-z-]+)"/"myllenet-\1"/g; s/- supabase-vector/- myllenet-vector/' volumes/logs/vector.yml

# Portas: só em 127.0.0.1 e com números próprios
sed -i -E 's#^(\s*)- \$\{API_GW_HTTP_PORT:-\$\{KONG_HTTP_PORT:-8000\}\}:8000/tcp#\1- 127.0.0.1:${MYLLENET_API_GW_PORT}:8000/tcp#' docker-compose.yml
sed -i -E 's#^(\s*)- \$\{POSTGRES_PORT\}:5432$#\1- 127.0.0.1:${MYLLENET_POOLER_SESSION_PORT}:5432#' docker-compose.yml
sed -i -E 's#^(\s*)- \$\{POOLER_PROXY_PORT_TRANSACTION\}:6543$#\1- 127.0.0.1:${MYLLENET_POOLER_TX_PORT}:6543#' docker-compose.yml
grep -q 'MYLLENET_API_GW_PORT' docker-compose.yml || die "Não consegui ajustar a porta do api-gw no docker-compose.yml"
grep -q 'MYLLENET_POOLER_SESSION_PORT' docker-compose.yml || die "Não consegui ajustar as portas do pooler no docker-compose.yml"
if grep -nE 'container_name: supabase-' docker-compose.yml; then die "Sobrou container com nome supabase-*"; fi
ok "projeto 'myllenet', containers myllenet-*, portas em 127.0.0.1"

log "Gerando segredos e chaves"
sh utils/generate-keys.sh --update-env >/dev/null
rm -f .env.old
set_env .env MYLLENET_API_GW_PORT "$API_GW_LOCAL_PORT"
set_env .env MYLLENET_POOLER_SESSION_PORT "$POOLER_SESSION_LOCAL_PORT"
set_env .env MYLLENET_POOLER_TX_PORT "$POOLER_TX_LOCAL_PORT"
set_env .env SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
set_env .env API_EXTERNAL_URL "https://$API_DOMAIN/auth/v1"
set_env .env SITE_URL "https://$APP_DOMAIN"
set_env .env ADDITIONAL_REDIRECT_URLS "https://$APP_DOMAIN/**"
set_env .env PROXY_DOMAIN "$API_DOMAIN"
set_env .env POOLER_TENANT_ID "myllenet"
set_env .env DASHBOARD_USERNAME "mororo"
# Usuários são criados pelo admin (user-management); cadastro público desligado
set_env .env DISABLE_SIGNUP "true"
set_env .env ENABLE_EMAIL_AUTOCONFIRM "true"
set_env .env ENABLE_ANONYMOUS_USERS "false"
# A verificação de JWT por função é feita no main/index.ts (abaixo)
set_env .env FUNCTIONS_VERIFY_JWT "false"
ok "segredos gerados em $SB_DIR/.env"

log "Ajustando o roteador de Edge Functions (verify_jwt por função)"
MAIN=volumes/functions/main/index.ts
grep -q "const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'" "$MAIN" || die "main/index.ts em formato inesperado"
grep -q "if (req.method !== 'OPTIONS' && VERIFY_JWT) {" "$MAIN" || die "main/index.ts em formato inesperado"
perl -0pi -e "s/const VERIFY_JWT = Deno.env.get\('VERIFY_JWT'\) === 'true'\n/const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'\n\/\/ MyLLENET: funções que exigem JWT válido (verify_jwt = true no projeto original)\nconst JWT_REQUIRED = new Set(['api-diagnostic-report', 'evolution-monitor', 'mikrotik-customer', 'mikrotik-speedtest', 'monthly-invoice-sender'])\n/" "$MAIN"
perl -0pi -e "s/if \(req.method !== 'OPTIONS' && VERIFY_JWT\) \{/const __svc = new URL(req.url).pathname.split('\/')[1] ?? ''\n  if (req.method !== 'OPTIONS' && (VERIFY_JWT || JWT_REQUIRED.has(__svc))) {/" "$MAIN"
grep -q "JWT_REQUIRED.has(__svc)" "$MAIN" || die "Falha ao ajustar main/index.ts"
rm -rf volumes/functions/hello
ok "main/index.ts ajustado"

log "Criando override: segredos das funções + container myllenet-web"
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
[ -f "$SB_DIR/functions.env" ] || { printf '# Segredos das Edge Functions (preenchido pelo 02-migrate-data.sh)\nAPP_PUBLIC_URL=https://%s\n' "$APP_DOMAIN" > "$SB_DIR/functions.env"; chmod 600 "$SB_DIR/functions.env"; }
mkdir -p "$SB_DIR/web"
sed -e "s/__APP_DOMAIN__/$APP_DOMAIN/g" -e "s/__API_DOMAIN__/$API_DOMAIN/g" "$SCRIPT_DIR/templates/nginx-edge.conf" > "$SB_DIR/web/default.conf"

EP_NET_BLOCK=""
if docker network inspect "$EASYPANEL_NETWORK" >/dev/null 2>&1; then
  if [ "$(docker network inspect "$EASYPANEL_NETWORK" -f '{{.Attachable}}')" = "true" ] || \
     [ "$(docker network inspect "$EASYPANEL_NETWORK" -f '{{.Driver}}')" = "bridge" ]; then
    EP_NET_BLOCK="yes"
    ok "rede '$EASYPANEL_NETWORK' encontrada — myllenet-web vai entrar nela"
  else
    warn "rede '$EASYPANEL_NETWORK' não é attachable; o Traefik precisará alcançar a porta $EDGE_LOCAL_PORT por outro caminho (veja README)."
  fi
else
  warn "rede '$EASYPANEL_NETWORK' não existe; ajuste EASYPANEL_NETWORK em config.env (docker network ls)."
fi

{
  echo "# Gerado por 01-install-supabase.sh — específico do MyLLENET"
  echo "services:"
  echo "  functions:"
  echo "    env_file:"
  echo "      - ./functions.env"
  echo "  web:"
  echo "    container_name: myllenet-web"
  echo "    image: nginx:1.27-alpine"
  echo "    restart: unless-stopped"
  echo "    depends_on:"
  echo "      api-gw:"
  echo "        condition: service_healthy"
  echo "    volumes:"
  echo "      - ./web/default.conf:/etc/nginx/conf.d/default.conf:ro"
  echo "      - $APP_DIR/dist:/usr/share/nginx/html:ro"
  echo "    ports:"
  echo "      - 127.0.0.1:\${MYLLENET_EDGE_PORT}:80"
  if [ -n "$EP_NET_BLOCK" ]; then
    echo "    networks:"
    echo "      - default"
    echo "      - easypanel"
    echo "networks:"
    echo "  easypanel:"
    echo "    name: $EASYPANEL_NETWORK"
    echo "    external: true"
  fi
} > docker-compose.myllenet.yml
set_env .env MYLLENET_EDGE_PORT "$EDGE_LOCAL_PORT"
set_env .env COMPOSE_FILE "docker-compose.yml:docker-compose.myllenet.yml"
mkdir -p "$APP_DIR/dist"
[ -f "$APP_DIR/dist/index.html" ] || echo '<!doctype html><title>MyLLENET</title><p>Em migração…</p>' > "$APP_DIR/dist/index.html"

log "Validando o docker compose"
compose config -q || die "docker compose config falhou"
if compose config | grep -E 'published: "?(8000|5432|6543)"?$' >/dev/null; then die "Alguma porta padrão (8000/5432/6543) ficou publicada"; fi
ok "configuração válida"

log "Baixando imagens (pode levar alguns minutos)"
compose pull -q

log "Subindo o Supabase do MyLLENET"
compose up -d
for _ in $(seq 1 60); do
  unhealthy=$(compose ps --format '{{.Name}} {{.Health}}' | awk '$2!="healthy" && $2!="" {print $1}')
  [ -z "$unhealthy" ] && break
  sleep 5
done
compose ps
[ -z "${unhealthy:-}" ] || warn "Ainda sem healthy: $unhealthy (confira com: cd $SB_DIR && docker compose logs <serviço>)"

log "Teste local da API"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_GW_LOCAL_PORT/auth/v1/health" -H "apikey: $(sb_env ANON_KEY)")
[ "$code" = "200" ] && ok "auth respondendo (HTTP 200)" || warn "auth/v1/health respondeu HTTP $code"

cat <<EOF

Pronto. Supabase do MyLLENET rodando em $SB_DIR
  API local:        http://127.0.0.1:$API_GW_LOCAL_PORT
  Studio:           https://$API_DOMAIN  (depois do Traefik) — usuário: mororo / senha: DASHBOARD_PASSWORD em $SB_DIR/.env
Próximo passo:      bash 02-migrate-data.sh
EOF
