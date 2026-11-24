#!/usr/bin/env bash
# 15 — Etapa 7 do plano: configurações centralizadas (Configurações → Empresa)
#   nome do provedor, WhatsApp de atendimento, endereço do painel e frase da fatura saem do código
#   e passam a vir da tabela settings (cache de 60 s nas functions)
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)

echo "==> Valores iniciais (só cria o que não existe)"
psql_admin -q <<SQL
insert into public.settings (key, value) select k, v from (values
  ('provedor_nome', 'Mororo.Tech'),
  ('atendimento_telefone', '85986801458'),
  ('url_painel', 'https://$DOMINIO_APP'),
  ('fatura_slogan', 'MylleNet agora é Mororo.Tech')
) as t(k, v)
where not exists (select 1 from public.settings s where s.key = t.k);
SQL
psql_admin -c "select key, value from public.settings where key in ('provedor_nome','atendimento_telefone','url_painel','fatura_slogan','admin_whatsapp') order by 1"

echo "==> Sobrou algum valor fixo nas functions publicadas?"
grep -rln "85986801458\|98680-1458\|Mororo\.Tech\|myllenet\.mororo\.tech" "$SB_DIR/volumes/functions" --include=index.ts \
  | grep -v "_shared/config.ts" | sed 's/^/  /' || echo "  nenhum (fora os valores padrão em _shared/config.ts)"

echo "==> Teste: fatura pública traz os dados da empresa"
FID=$(psql_admin -tAc "select id from public.invoices order by created_at desc limit 1")
curl -s -m 15 "http://127.0.0.1:$PORTA_API/functions/v1/fatura-publica?id=$FID" -H "apikey: $(envget ANON_KEY)" \
  | python3 -c 'import json,sys; s=json.load(sys.stdin)["settings"]; print("  provedor:", s.get("provedor_nome"), "| atendimento:", s.get("atendimento_telefone_fmt"), "| frase:", s.get("fatura_slogan"))'

cat <<MSG

✅ Etapa 7 aplicada. Ajuste os dados em Configurações → Empresa (vale para as próximas mensagens,
   em até 1 minuto). A lista de administradores continua em Configurações → WhatsApp.
MSG
