#!/usr/bin/env bash
# 17 — Etapa 9 do plano: manutenção do código
#   1. atualiza (código sem o backend Fastify, functions todas em supabase/functions)
#   2. testes das regras de bloqueio/aviso no banco real, dentro de transação desfeita (rollback)
#   3. testes de unidade do painel (vitest, num container Node descartável)
#   4. gera a migration base do schema (supabase/migrations) e, se você confirmar, faz commit/push
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> 1. Atualizando código, functions e painel"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)

echo "==> 2. Regras de bloqueio e aviso de corte (nada é gravado)"
psql_admin -q < "$APP_DIR/tests/sql/regras_cobranca.sql" | grep -v '^\(BEGIN\|ROLLBACK\)$'

echo "==> 3. Testes de unidade do painel (vitest)"
docker run --rm -v "$APP_DIR":/src:ro node:20-alpine sh -c \
  'cp -r /src /w && cd /w && rm -rf node_modules && npm install --no-audit --no-fund --silent >/dev/null 2>&1 && npx vitest run 2>&1 | tail -6'

echo "==> 4. Migration base do schema"
VERSAO=$(date +%Y%m%d%H%M%S)
ARQ="supabase/migrations/${VERSAO}_base_vpsfaedi.sql"
TMP=$(mktemp -d)
docker run --rm --network "${PROJETO}_default" -e PGPASSWORD="$(envget POSTGRES_PASSWORD)" -v "$TMP":/w "$PG_CLIENT_IMAGE" \
  pg_dump -h db -U supabase_admin -d postgres --schema-only -n public --no-owner -f /w/public.sql
{
  echo "-- Schema base do MyLLENET (gerado por deploy/vpsfaedi/17-manutencao.sh em $(date '+%d/%m/%Y %H:%M'))"
  echo "-- Banco de origem: Supabase auto-hospedado na vpsfaedi. Mudanças futuras: novas migrations nesta pasta."
  echo
  cat "$TMP/public.sql"
  echo
  echo "-- ===================== fora do schema public ====================="
  psql_admin -tA -c "select pg_get_triggerdef(oid) || ';' from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal"
  psql_admin -tA -c "select format('create policy %I on %I.%I for %s to %s using (%s)%s;', policyname, schemaname, tablename,
      cmd, array_to_string(roles, ', '), coalesce(qual, 'true'), coalesce(' with check (' || with_check || ')', ''))
    from pg_policies where schemaname = 'storage'"
  echo
  echo "-- Jobs do pg_cron (referência; chaves/tokens removidos — recriar com a chave do Vault):"
  psql_admin -tA -c "select '-- ' || jobname || ' [' || schedule || ']: ' ||
      regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '<SERVICE_KEY>', 'g'), '\s+', ' ', 'g')
    from cron.job order by jobname"
} > "$TMP/base.sql"
mkdir -p "$APP_DIR/supabase/migrations"
cp "$TMP/base.sql" "$APP_DIR/$ARQ"; rm -rf "$TMP"
if grep -qE 'eyJ[A-Za-z0-9_-]{20,}\.' "$APP_DIR/$ARQ"; then
  echo "  ⚠️  encontrei algo parecido com uma chave no arquivo — não vou fazer commit. Avise o Claude."; exit 1
fi
echo "  gerado: $ARQ ($(wc -l < "$APP_DIR/$ARQ") linhas)"

read -rp "  Fazer commit e push dessa migration no GitHub? (s/N): " R
if [ "${R,,}" = "s" ]; then
  git -C "$APP_DIR" add "$ARQ"
  git -C "$APP_DIR" -c user.name="vpsfaedi" -c user.email="felipemororo@vpsfaedi" \
    commit -q -m "Migration base do schema (gerada na vpsfaedi)"
  git -C "$APP_DIR" push -q origin HEAD:main && echo "  enviado para o GitHub"
fi

cat <<'MSG'

✅ Etapa 9 aplicada.
   - Regras de bloqueio/aviso e funções de apoio testadas (rode este script de novo depois de mexer nelas)
   - Daqui em diante, mudança no banco = nova migration em supabase/migrations
MSG
