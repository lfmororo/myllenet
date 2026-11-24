#!/usr/bin/env bash
# 11 — Etapa 3 do plano: backup diário com cópia no Google Drive
#   1. senha de criptografia do backup (gera uma, se você não tiver)
#   2. rclone + Google Drive (remoto "gdrive", pasta Backups/MyLLENET)
#   3. tabela public.backup_execucoes + verificação diária (avisa se ficar >26 h sem backup)
#   4. crontab: backup todo dia às 03:00
#   5. roda o primeiro backup e testa a restauração num Postgres temporário
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
psql_admin() { (cd "$SB_DIR" && docker compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"); }
REMOTO_NOME=gdrive
PASTA_DRIVE="Backups/MyLLENET"

echo "==> Atualizando código e functions (aviso-admin)"
./04-frontend.sh --pull

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

echo "==> rclone (Google Drive)"
command -v rclone >/dev/null || sudo apt-get install -y -qq rclone >/dev/null
RCLONE_DESTINO=""
if rclone listremotes 2>/dev/null | grep -qx "$REMOTO_NOME:"; then
  rclone mkdir "$REMOTO_NOME:$PASTA_DRIVE" && RCLONE_DESTINO="$REMOTO_NOME:$PASTA_DRIVE"
  echo "  ok: $RCLONE_DESTINO"
else
  cat <<MSG
  O remoto "$REMOTO_NOME" ainda não existe. O backup vai funcionar só local por enquanto.
  Para ligar o Google Drive (uma vez):
    1. rclone config  →  n (novo)  →  nome: $REMOTO_NOME  →  tipo: drive
       client_id/secret: Enter  →  scope: 3 (drive.file, só os arquivos do rclone)
       "Use web browser to automatically authenticate?"  →  n
    2. Ele mostra um comando "rclone authorize ..." — rode no seu PC Windows
       (baixe o rclone.exe em rclone.org/downloads), entre na conta Google e cole
       o token de volta no terminal da vpsfaedi.
    3. Rode este script de novo:  ./11-backup.sh
MSG
fi

cat > "$BASE/backup.env" <<EOF
# configuração do backup-diario.sh (gerado pelo 11-backup.sh)
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
alter table public.backup_execucoes enable row level security;
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

echo "==> crontab (03:00 todo dia)"
LINHA="0 3 * * * $APP_DIR/deploy/vpsfaedi/backup-diario.sh >> $BASE/backups/backup.log 2>&1"
mkdir -p "$BASE/backups"
( crontab -l 2>/dev/null | grep -v 'backup-diario.sh' ; echo "$LINHA" ) | crontab -
crontab -l | grep backup-diario

echo "==> Primeiro backup"
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
[ -n "$RCLONE_DESTINO" ] && echo "   Google Drive: $RCLONE_DESTINO" || echo "   Google Drive: ainda não configurado (veja as instruções acima)"
