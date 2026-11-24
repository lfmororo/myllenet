#!/usr/bin/env bash
# 01 — Sobe a stack Supabase auto-hospedada do MyLLENET na vpsfaedi
# Usa o setup.sh oficial do Supabase (última release self-hosted, Postgres 17,
# gateway Envoy) e depois isola nomes/portas para conviver com outras stacks.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker não encontrado"
docker compose version >/dev/null || die "docker compose não encontrado"
[ -d "$APP_DIR/deploy/vpsfaedi/functions" ] || die "repo não está em $APP_DIR (veja o README)"
[ -e "$SB_DIR" ] && die "$SB_DIR já existe. Para recriar do zero: cd $SB_DIR && docker compose down -v && cd .. && sudo rm -rf $SB_DIR"

say "Verificando portas livres"
for p in $PORTA_API $PORTA_PG $PORTA_POOLER; do
  ss -ltn | awk '{print $4}' | grep -qE "[:.]$p\$" && die "porta $p já está em uso — ajuste config.env"
done
for c in $PREFIXO-db realtime-dev.$PREFIXO-realtime; do
  docker ps -a --format '{{.Names}}' | grep -qx "$c" && die "já existe um container $c"
done

say "Instalando dependências (git, openssl, jq, curl)"
sudo apt-get update -qq && sudo apt-get install -y -qq git openssl jq curl ca-certificates >/dev/null

say "Baixando o Supabase self-hosted (setup.sh oficial)"
cd "$BASE"
curl -fsSL https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh -o /tmp/supabase-setup.sh
sh /tmp/supabase-setup.sh -y --skip-deps --project-dir "$(basename "$SB_DIR")" </dev/null
cd "$SB_DIR"
[ -f .env ] || die "setup.sh não gerou o .env"

set_env() { # set_env CHAVE valor (substitui ou acrescenta)
  local k="$1" v="$2"
  if grep -qE "^$k=" .env; then
    K="$k" V="$v" python3 -c '
import os,re
k,v=os.environ["K"],os.environ["V"]
s=open(".env").read()
s=re.sub(rf"^{re.escape(k)}=.*$", lambda m: f"{k}={v}", s, flags=re.M)
open(".env","w").write(s)'
  else
    echo "$k=$v" >> .env
  fi
}

say "Isolando nomes de projeto/containers (outras stacks Supabase na mesma VPS)"
for f in docker-compose*.yml; do
  sed -i -E "s/^name: supabase\$/name: $PROJETO/; s/container_name: supabase-/container_name: $PREFIXO-/" "$f"
done
grep -rl "realtime-dev.supabase-realtime" docker-compose*.yml volumes/api volumes/logs 2>/dev/null \
  | xargs -r sed -i "s/realtime-dev\.supabase-realtime/realtime-dev.$PREFIXO-realtime/g"
[ -f volumes/logs/vector.yml ] && sed -i "s/supabase-/$PREFIXO-/g" volumes/logs/vector.yml
# porta do Postgres (sessão) exposta no host — a interna continua 5432
sed -i -E "s/- \\\$\\{POSTGRES_PORT\\}:5432/- $PORTA_PG:5432/" docker-compose.yml
grep -q "container_name: supabase-" docker-compose.yml && die "sobrou container com nome supabase-* no compose"

say "Configurando URLs, portas e Auth"
set_env API_GW_HTTP_PORT "$PORTA_API"
set_env KONG_HTTP_PORT "$PORTA_API"
set_env POOLER_PROXY_PORT_TRANSACTION "$PORTA_POOLER"
set_env POOLER_TENANT_ID "$PROJETO"
set_env SUPABASE_PUBLIC_URL "https://$DOMINIO_API"
set_env API_EXTERNAL_URL "https://$DOMINIO_API/auth/v1"
set_env SITE_URL "https://$DOMINIO_APP"
set_env ADDITIONAL_REDIRECT_URLS "https://$DOMINIO_APP/**"
set_env PROXY_DOMAIN "$DOMINIO_API"
set_env STUDIO_DEFAULT_ORGANIZATION "Mororo.Tech"
set_env STUDIO_DEFAULT_PROJECT "MyLLENET"
set_env DASHBOARD_USERNAME "myllenet"
# usuários são criados pelo admin (função user-management); não há SMTP configurado
set_env DISABLE_SIGNUP "true"
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "true"
set_env ENABLE_ANONYMOUS_USERS "false"
set_env FUNCTIONS_VERIFY_JWT "true"

say "Checagem de JWT por função (igual ao verify_jwt do config.toml da Lovable)"
MAIN=volumes/functions/main/index.ts
grep -q "const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'" "$MAIN" || die "main/index.ts mudou — avise o Claude"
python3 - "$MAIN" <<'PYX'
import sys
p=sys.argv[1]; s=open(p).read()
a="const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'"
s=s.replace(a, a+"\nconst NO_VERIFY_JWT = new Set((Deno.env.get('NO_VERIFY_JWT_FUNCTIONS') ?? '').split(',').map((x) => x.trim()).filter(Boolean))",1)
b="if (req.method !== 'OPTIONS' && VERIFY_JWT) {"
assert b in s, "trecho do VERIFY_JWT não encontrado"
s=s.replace(b,"if (req.method !== 'OPTIONS' && VERIFY_JWT && !NO_VERIFY_JWT.has(new URL(req.url).pathname.split('/')[1])) {",1)
open(p,"w").write(s)
PYX
set_env NO_VERIFY_JWT_FUNCTIONS "$NO_VERIFY_JWT_FUNCTIONS"

say "Segredos das Edge Functions"
echo "Copie os valores de Cloud → Secrets do projeto na Lovable."
echo "Quase tudo (Efí, Mercado Pago, UAZAPI, Evolution) também fica na tela de Configurações"
echo "do sistema; se um segredo não existir na Lovable, só aperte Enter."
SEGREDOS="EFI_CLIENT_ID EFI_CLIENT_SECRET MERCADOPAGO_ACCESS_TOKEN WHATSAPP_PROVIDER UAZAPI_TOKEN EVOLUTION_BASE_URL EVOLUTION_API_KEY EVOLUTION_INSTANCE AGENTE_TOKEN AGENTE_WEBHOOK_URL CRON_SECRET"
for k in $SEGREDOS; do
  read -rp "  $k: " v
  if [ "$k" = "CRON_SECRET" ] && [ -z "$v" ]; then v=$(openssl rand -hex 24); echo "    (gerado um CRON_SECRET novo)"; fi
  set_env "$k" "$v"
done

{
  echo "# Ajustes do MyLLENET (carregado via COMPOSE_FILE no .env)"
  echo "services:"
  echo "  functions:"
  echo "    environment:"
  echo "      NO_VERIFY_JWT_FUNCTIONS: \${NO_VERIFY_JWT_FUNCTIONS}"
  for k in $SEGREDOS; do echo "      $k: \${$k}"; done
} > docker-compose.$PROJETO.yml
CF=$(grep -E '^COMPOSE_FILE=' .env | cut -d= -f2-)
set_env COMPOSE_FILE "${CF:-docker-compose.yml}:docker-compose.$PROJETO.yml"

say "Copiando as Edge Functions"
copiar_functions
ls volumes/functions | tr '\n' ' '; echo

say "Subindo a stack"
docker compose config -q || die "docker compose config falhou"
docker compose up -d

ANON_KEY=$(envget ANON_KEY); DASHBOARD_PASSWORD=$(envget DASHBOARD_PASSWORD)
say "Aguardando banco e Auth"
ok=
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1 \
     && curl -fsS "http://127.0.0.1:$PORTA_API/auth/v1/health" -H "apikey: $ANON_KEY" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 5
done
[ -n "$ok" ] || die "stack não respondeu em 5 min — veja: cd $SB_DIR && docker compose ps"

docker compose ps --format 'table {{.Name}}\t{{.Status}}'
chmod 600 .env
cat <<EOF

✅ Supabase do MyLLENET no ar em http://127.0.0.1:$PORTA_API  (externo: https://$DOMINIO_API)
   Studio: https://$DOMINIO_API   usuário: myllenet   senha: $DASHBOARD_PASSWORD
   Todos os segredos estão em $SB_DIR/.env — guarde uma cópia em local seguro.

Próximo passo:  ./02-restaurar-banco.sh /caminho/do/backup.backup
EOF
