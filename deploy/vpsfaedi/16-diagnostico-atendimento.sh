#!/usr/bin/env bash
# 16 — Etapa 8 do plano: diagnóstico — medição e atendimento
#   - velocidade medida depois do aquecimento do TCP (antes contava desde o 1º byte e subestimava)
#   - IP do cliente pelo X-Real-IP do Traefik; "na rede" só se for o IP da sessão DESTE cliente
#   - link de diagnóstico com validade: cada envio pela ficha gera um link novo (padrão 7 dias)
#   - gráfico de evolução (download × latência × plano) no detalhe do diagnóstico
#   uso: ./16-diagnostico-atendimento.sh [URL_DO_SERVIDOR_DE_TESTE]
#        URL opcional de um LibreSpeed dentro da rede do provedor (https, terminando em /backend)
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }

echo "==> Atualizando código, functions e painel"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)

echo "==> Banco: validade do link de diagnóstico"
psql_admin -q <<'SQL'
alter table public.customers add column if not exists diagnostico_token_expira timestamptz;
-- links que já foram enviados continuam valendo por mais 30 dias
update public.customers set diagnostico_token_expira = now() + interval '30 days'
  where diagnostico_token is not null and diagnostico_token_expira is null;

insert into public.settings (key, value)
select 'diagnostico_link_dias', '7'
where not exists (select 1 from public.settings where key = 'diagnostico_link_dias');

create or replace function public.renovar_link_diagnostico(p_customer uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare v_dias int; v_token uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select coalesce(nullif(value, '')::int, 7) into v_dias from public.settings where key = 'diagnostico_link_dias';
  update public.customers
     set diagnostico_token = v_token,
         diagnostico_token_expira = now() + make_interval(days => coalesce(v_dias, 7))
   where id = p_customer;
  if not found then raise exception 'cliente não encontrado'; end if;
  return v_token;
end;
$$;
revoke all on function public.renovar_link_diagnostico(uuid) from public, anon;
grant execute on function public.renovar_link_diagnostico(uuid) to authenticated;
SQL

if [ -n "${1:-}" ]; then
  echo "==> Servidor de teste de velocidade: $1"
  psql_admin -v url="$1" -c "update public.config_diagnostico set speedtest_url = :'url' where id = 1"
fi
psql_admin -c "select speedtest_url, duracao_ms, fluxos from public.config_diagnostico where id = 1"

echo "==> Teste: link expirado é recusado"
TK=$(psql_admin -tAc "select diagnostico_token from public.customers where diagnostico_token is not null limit 1")
if [ -n "$TK" ]; then
  C1=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://127.0.0.1:$PORTA_API/functions/v1/diagnostico?c=$TK")
  psql_admin -q -c "update public.customers set diagnostico_token_expira = now() - interval '1 minute' where diagnostico_token = '$TK'"
  C2=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://127.0.0.1:$PORTA_API/functions/v1/diagnostico?c=$TK")
  psql_admin -q -c "update public.customers set diagnostico_token_expira = now() + interval '30 days' where diagnostico_token = '$TK'"
  echo "  link válido: $C1 (esperado 200) · link expirado: $C2 (esperado 410)"
fi

cat <<'MSG'

✅ Etapa 8 aplicada.
   - Na ficha do cliente, "Enviar link de diagnóstico" gera um link novo válido por 7 dias
     (mude em settings.diagnostico_link_dias).
   - Teste de aceite: rode o diagnóstico 3 vezes seguidas no mesmo aparelho; os valores devem
     variar menos de 10%. Abra o link num celular no 4G: deve aparecer "não está na nossa rede".
   - Para medir só a última milha, instale um LibreSpeed dentro da rede do provedor (com HTTPS)
     e rode:  ./16-diagnostico-atendimento.sh https://speedtest.SEUDOMINIO/backend
MSG
