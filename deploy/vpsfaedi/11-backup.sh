#!/usr/bin/env bash
# 11 — Etapa 3 do plano: backup diário com cópia no Google Drive (pode rodar de novo quando quiser)
#   1. senha de criptografia do backup (gera uma, se você não tiver)
#   2. tabelas: backup_execucoes (histórico), backup_pedidos ("Fazer backup agora" no painel),
#      integracoes (conexão do Google Drive; o painel não lê)
#   3. verificação diária (avisa se ficar >26 h sem backup)
#   4. crontab: backup às 03:00 + checagem de pedido manual a cada minuto
#   5. roda um backup e testa a restauração num Postgres temporário
# O Google Drive é conectado pelo painel: Configurações → Backups.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }
echo "==> Atualizando código, functions (aviso-admin, google-drive) e painel"
sed -i "s#^NO_VERIFY_JWT_FUNCTIONS=.*#NO_VERIFY_JWT_FUNCTIONS=$NO_VERIFY_JWT_FUNCTIONS#" "$SB_DIR/.env"
./04-frontend.sh --pull
(cd "$SB_DIR" && docker compose up -d functions)

echo "==> Senha de criptografia do backup"
if [ -s "$BASE/.backup-senha" ]; then
  echo "  já existe ($BASE/.backup-senha)"
else
  read -rsp "  Digite uma senha (Enter = gerar uma forte): " S; echo
  [ -n "$S" ] || S=$(openssl rand -base64 30 | tr -d '\n')
  umask 077; printf '%s' "$S" > "$BASE/.backup-senha"
  echo
  echo "  ┌──────────────────────────────────────────────────────────────┐"
  echo "  │ GUARDE ESTA SENHA FORA DO SERVIDOR (gerenciador de senhas).   │"
  echo "  │ Sem ela, nenhum backup pode ser aberto.                       │"
  echo "  └──────────────────────────────────────────────────────────────┘"
  echo "  senha: $S"
  read -rp "  Já guardou? (Enter para continuar) " _
fi

# mantém um destino rclone só se você já tinha configurado um (o Drive agora é pelo painel)
RCLONE_DESTINO=$(grep -E '^RCLONE_DESTINO=' "$BASE/backup.env" 2>/dev/null | cut -d= -f2- || true)

cat > "$BASE/backup.env" <<EOF
# configuração do backup-diario.sh (gerado pelo 11-backup.sh)
# Google Drive: conectado pelo painel. RCLONE_DESTINO só se você configurou um remoto rclone.
RCLONE_DESTINO=$RCLONE_DESTINO
MANTER_DIARIO=7
MANTER_SEMANAL=4
MANTER_MENSAL=3
EOF

echo "==> Banco: registro das execuções e verificação diária"
psql_admin -q <<'SQL'
create table if not exists public.backup_execucoes (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  status text not null,
  arquivo text,
  tamanho_bytes bigint,
  remoto text,
  erro text
);
alter table public.backup_execucoes add column if not exists drive_file_id text;
alter table public.backup_execucoes add column if not exists origem text default 'agendado';
alter table public.backup_execucoes enable row level security;
grant select on public.backup_execucoes to authenticated;
grant all on public.backup_execucoes to service_role, postgres;

create table if not exists public.backup_pedidos (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  status text not null default 'pendente' check (status in ('pendente', 'rodando', 'concluido', 'falhou')),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
alter table public.backup_pedidos enable row level security;
drop policy if exists "Admins pedem backup" on public.backup_pedidos;
create policy "Admins pedem backup" on public.backup_pedidos for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and status = 'pendente');
drop policy if exists "Admins veem pedidos" on public.backup_pedidos;
create policy "Admins veem pedidos" on public.backup_pedidos for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
grant select, insert on public.backup_pedidos to authenticated;
grant usage on sequence public.backup_pedidos_id_seq to authenticated;
grant all on public.backup_pedidos to service_role, postgres;

-- segredos de integrações (Google Drive): só a service role lê/escreve
create table if not exists public.integracoes (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.integracoes enable row level security;
revoke all on public.integracoes from anon, authenticated;
grant all on public.integracoes to service_role;

drop policy if exists "Admins leem backups" on public.backup_execucoes;
create policy "Admins leem backups" on public.backup_execucoes for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

select cron.unschedule(jobid) from cron.job where jobname = 'backup-verificacao';
-- 09:30 em Brasília: avisa se não houve backup ok nas últimas 26 h
select cron.schedule('backup-verificacao', '30 12 * * *', $c$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/aviso-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'myllenet_service_role_key')),
    body := jsonb_build_object('tipo', 'admin_backup_atrasado', 'texto',
      '⚠️ *BACKUP DO MYLLENET ATRASADO*' || chr(10) || chr(10) ||
      'Não há backup concluído nas últimas 26 horas. Último ok: ' ||
      coalesce((select to_char(max(criado_em) at time zone 'America/Fortaleza', 'DD/MM/YYYY HH24:MI')
                from public.backup_execucoes where status = 'ok'), 'nunca') ||
      chr(10) || 'Verifique a vpsfaedi (crontab e /opt/myllenet/backups/backup.log).'))
  where not exists (select 1 from public.backup_execucoes
                    where status = 'ok' and criado_em > now() - interval '26 hours');
$c$);
SQL
psql_admin -tAc "select count(*) from vault.secrets where name = 'myllenet_service_role_key'" | grep -q '^1$' \
  || echo "  atenção: segredo myllenet_service_role_key não está no Vault — rode o 07-aviso-bloqueio.sh"

echo "==> crontab (03:00 todo dia + pedido manual a cada minuto)"
SCRIPT="$APP_DIR/deploy/vpsfaedi/backup-diario.sh"
mkdir -p "$BASE/backups"
( crontab -l 2>/dev/null | grep -v 'backup-diario.sh'
  echo "0 3 * * * $SCRIPT >> $BASE/backups/backup.log 2>&1"
  echo "* * * * * $SCRIPT --pedido >> $BASE/backups/backup.log 2>&1" ) | crontab -
crontab -l | grep backup-diario

echo "==> Backup agora"
"$APP_DIR/deploy/vpsfaedi/backup-diario.sh" | tee -a "$BASE/backups/backup.log"
ULT=$(ls -1t "$BASE/backups/diario/"*.tar.enc | head -n1)

echo "==> Teste de restauração (Postgres temporário, apagado no fim)"
T=$(mktemp -d); trap 'rm -rf "$T"; docker rm -f myllenet-teste-restore >/dev/null 2>&1 || true' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BASE/.backup-senha" -in "$ULT" | tar -C "$T" -xf -
docker run -d --name myllenet-teste-restore -e POSTGRES_PASSWORD=teste -v "$T":/w "$PG_CLIENT_IMAGE" >/dev/null
for i in $(seq 1 30); do docker exec myllenet-teste-restore pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec myllenet-teste-restore pg_restore -U postgres -d postgres -n public --no-owner --no-acl /w/banco.backup >/dev/null 2>&1 || true
RESTAURADO=$(docker exec myllenet-teste-restore psql -U postgres -tAc "select (select count(*) from public.customers)||' clientes, '||(select count(*) from public.invoices)||' faturas'")
ATUAL=$(psql_admin -tAc "select (select count(*) from public.customers)||' clientes, '||(select count(*) from public.invoices)||' faturas'")
echo "  no backup:   $RESTAURADO"
echo "  no sistema:  $ATUAL"
tar -tf "$T/arquivos.tar" | sed 's/^/  arquivos: /'

if [ "$RESTAURADO" = "$ATUAL" ]; then
  echo; echo "✅ Etapa 3 concluída: backup criado, criptografado e restaurado com os mesmos números."
else
  echo; echo "⚠️  Os números não bateram — cole a saída para o Claude."
fi
echo "   Arquivo: $ULT ($(du -h "$ULT" | cut -f1))"
DRV=$(curl -s -m 30 -X POST "http://127.0.0.1:$PORTA_API/functions/v1/google-drive/token" \
  -H "Authorization: Bearer $(envget SERVICE_ROLE_KEY)" -H "apikey: $(envget SERVICE_ROLE_KEY)" -H "Content-Type: application/json" -d '{}')
if printf '%s' "$DRV" | grep -q '"conectado":true'; then echo "   Google Drive: conectado (cópia enviada)"
else echo "   Google Drive: não conectado ainda → painel: Configurações → Backups → Conectar Google Drive"; fi
