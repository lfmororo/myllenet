#!/usr/bin/env bash
# 13 — Etapa 5 do plano: segredos fora do navegador
#   - RLS da tabela settings: usuários do painel leem só configurações comuns; credenciais
#     (Efí, Mercado Pago, UAZAPI, Evolution, senha do MikroTik) ficam invisíveis para eles
#   - credenciais passam a ser gravadas pela function settings-segredos (só admin), sem voltar à tela
#   - jobs de cron antigos deixam de ler a service key da settings e passam a usar o Vault
#   - a service key é apagada da tabela settings
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
SERVICE=$(envget SERVICE_ROLE_KEY)
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }
SEGREDOS="'efi_client_id','efi_client_secret','mercadopago_access_token','uazapi_token','evolution_api_key','mikrotik_password'"

echo "==> Atualizando código, functions (settings-segredos) e painel"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)

echo "==> Policies atuais da settings (antes)"
psql_admin -c "select polname, polcmd, polroles::regrole[] from pg_policy where polrelid='public.settings'::regclass"

echo "==> Vault: service key (para os jobs de cron)"
psql_admin -q -v key="$SERVICE" <<'SQL'
select vault.update_secret(id, :'key') from vault.secrets where name = 'myllenet_service_role_key';
select vault.create_secret(:'key', 'myllenet_service_role_key', 'usada pelos jobs de cron e triggers')
  where not exists (select 1 from vault.secrets where name = 'myllenet_service_role_key');
SQL

echo "==> Jobs de cron: settings → Vault"
psql_admin -q <<'SQL'
do $$
declare j record; novo text;
begin
  for j in select jobid, command from cron.job where command ~* 'supabase_service_role_key|supabase_url' loop
    novo := regexp_replace(j.command,
      '\(\s*select\s+value\s+from\s+(public\.)?settings\s+where\s+key\s*=\s*''+supabase_service_role_key''+\s*\)',
      '(select decrypted_secret from vault.decrypted_secrets where name = ''myllenet_service_role_key'')', 'gi');
    novo := regexp_replace(novo,
      '\(\s*select\s+value\s+from\s+(public\.)?settings\s+where\s+key\s*=\s*''+supabase_url''+\s*\)',
      '''http://kong:8000''', 'gi');
    if novo <> j.command then
      perform cron.alter_job(j.jobid, command := novo);
      raise notice 'job % ajustado', j.jobid;
    end if;
  end loop;
end $$;
SQL
RESTO=$(psql_admin -tAc "select count(*) from cron.job where command ilike '%supabase_service_role_key%'")
if [ "$RESTO" != "0" ]; then
  echo "  ⚠️  ainda há $RESTO job(s) lendo a service key da settings — não vou apagá-la. Cole a saída para o Claude:"
  psql_admin -c "select jobname, left(regexp_replace(command,'\s+',' ','g'),160) from cron.job where command ilike '%supabase_service_role_key%'"
else
  psql_admin -c "delete from public.settings where key = 'supabase_service_role_key'"
fi

echo "==> RLS da settings"
psql_admin -q <<SQL
alter table public.settings enable row level security;
do \$\$ declare p record; begin
  for p in select polname from pg_policy where polrelid = 'public.settings'::regclass loop
    execute format('drop policy %I on public.settings', p.polname);
  end loop;
end \$\$;
create policy settings_ler on public.settings for select to authenticated
  using (key <> all (array[$SEGREDOS]) and key <> 'supabase_service_role_key');
create policy settings_admin_inserir on public.settings for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and key <> all (array[$SEGREDOS]));
create policy settings_admin_alterar on public.settings for update to authenticated
  using (public.has_role(auth.uid(), 'admin') and key <> all (array[$SEGREDOS]))
  with check (public.has_role(auth.uid(), 'admin') and key <> all (array[$SEGREDOS]));
create policy settings_admin_apagar on public.settings for delete to authenticated
  using (public.has_role(auth.uid(), 'admin') and key <> all (array[$SEGREDOS]));
revoke all on public.settings from anon;
grant select, insert, update, delete on public.settings to authenticated;
SQL

echo "==> Outras chaves com cara de segredo na settings (conferir)"
psql_admin -c "select key from public.settings
  where key ~* '(token|secret|senha|password|apikey|api_key|private)' and key <> all (array[$SEGREDOS]) order by 1"

echo "==> Teste de aceite"
falhas=0
VISTO=$(psql_admin -tAc "begin; set local role authenticated; select count(*) from public.settings where key in ($SEGREDOS, 'supabase_service_role_key'); rollback;" | grep -E '^[0-9]+$' | head -n1)
echo "  credenciais visíveis para um usuário do painel: ${VISTO:-?} (esperado 0)"; [ "$VISTO" = "0" ] || falhas=$((falhas+1))
COMUNS=$(psql_admin -tAc "begin; set local role authenticated; select count(*) from public.settings; rollback;" | grep -E '^[0-9]+$' | head -n1)
echo "  configurações comuns visíveis: ${COMUNS:-?} (esperado > 0)"; [ "${COMUNS:-0}" -gt 0 ] || falhas=$((falhas+1))
ANON=$(curl -s -m 10 "http://127.0.0.1:$PORTA_API/rest/v1/settings?select=key,value" -H "apikey: $(envget ANON_KEY)")
echo "  leitura anônima pela API: $(printf '%s' "$ANON" | head -c 120)"
printf '%s' "$ANON" | grep -qi '"value"' && { echo "  FALHA: anônimo leu a settings"; falhas=$((falhas+1)); }
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 15 -X POST "http://127.0.0.1:$PORTA_API/functions/v1/mikrotik-status" \
  -H "Authorization: Bearer $SERVICE" -H "apikey: $SERVICE" -H "Content-Type: application/json" -d '{}')
echo "  functions continuam lendo as credenciais (mikrotik-status): $CODE (esperado 200)"; [ "$CODE" = "200" ] || falhas=$((falhas+1))

echo
[ "$falhas" = "0" ] && echo "✅ Etapa 5 concluída. No painel, as credenciais aparecem como \"••• configurado\"; preencha só para trocar." \
  || echo "⚠️  $falhas teste(s) falharam — cole a saída para o Claude."
