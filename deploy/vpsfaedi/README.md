# Migração do MyLLENET: Lovable Cloud → vpsfaedi

Stack Supabase auto-hospedada só do MyLLENET + frontend em nginx, publicados pelo
Traefik da evolutionapi.

| O quê | Onde |
|---|---|
| Painel | https://myllenet.mororo.tech → vpsfaedi:8041 |
| API + Studio | https://api-myllenet.mororo.tech → vpsfaedi:8040 |
| Postgres (Supavisor) | vpsfaedi:5482 (sessão) / 6593 (transação) |
| Arquivos | `/opt/myllenet/{app,supabase,restore}` |

## Passo a passo (na vpsfaedi, como felipemororo)

```bash
git clone git@github.com:lfmororo/myllenet.git /tmp/myllenet
sudo mkdir -p /opt/myllenet && sudo chown felipemororo:felipemororo /opt/myllenet
mv /tmp/myllenet /opt/myllenet/app
cd /opt/myllenet/app/deploy/vpsfaedi

./01-supabase.sh                            # sobe o Supabase (pede os Secrets da Lovable)
./02-restaurar-banco.sh ~/myllenet.backup   # restaura o backup da Lovable
./03-copiar-storage.sh                      # traz o certificado da Efí e outros arquivos
./04-frontend.sh                            # builda e sobe o painel
```

Depois: DNS de `myllenet` e `api-myllenet` (mororo.tech) para a evolutionapi e o
arquivo `/etc/easypanel/traefik/config/myllenet.yaml` no Traefik de lá.

## Atualizar depois de mudanças no código

```bash
cd /opt/myllenet/app/deploy/vpsfaedi && ./04-frontend.sh --pull
```

## Edge Functions

- `functions/` (nesta pasta): as funções de Efí, Mercado Pago, WhatsApp, MikroTik,
  usuários, fatura em PDF etc. Elas foram apagadas do repo em 05/out/2026
  (commit `c6945c1`, "migracao postgres + remove supabase"), mas continuam publicadas
  na Lovable Cloud e o painel ainda as chama. Foram recuperadas dessa versão, com os
  links `myllenet.lovable.app` trocados por `myllenet.mororo.tech`. A `migrate-helper`
  ficou de fora porque devolvia a service key.
- `supabase/functions/` (do repo): `diagnostico` e `diagnostico-provedor`. Elas têm
  prioridade sobre as da pasta acima.
- O `main/index.ts` da stack recebe uma lista de funções sem checagem de JWT
  (`NO_VERIFY_JWT_FUNCTIONS` no `config.env`), igual ao `verify_jwt = false` da Lovable.

## O que o 02 faz com o backup

- `auth.users` / `auth.identities` → mesmos IDs e senhas (login continua igual)
- schema `public` completo (tabelas, dados, funções, RLS, triggers)
- `storage.buckets` / `storage.objects` (metadados; os arquivos vêm no 03)
- recria os triggers `on_auth_user_created` e `on_auth_user_created_assign_admin`,
  as policies do bucket `certificates` e atualiza `supabase_url` /
  `supabase_service_role_key` na tabela `settings`
- recria os jobs do pg_cron (do backup, ou da lista das migrations) apontando para
  `http://kong:8000` com a service key nova

## MikroTik só pela API REST (sem agente)

`./05-mikrotik-direto.sh` (depois de um `git pull`):

- as functions param de usar o agente (fila `mikrotik_commands`, dados enviados pelo agente,
  alerta de "agente offline"). Para voltar a ligar: `MIKROTIK_AGENT=on` no `.env` da stack
  e no `docker-compose.myllenet.yml`.
- `mikrotik-sync-logs` roda a cada minuto e gera os eventos `connected`/`disconnected`
  (snapshot em `mikrotik_pppoe_snapshots`) e os `stats` de consumo a cada 5 minutos.
- agenda os jobs que faltarem (alertas, monitor da Evolution, lembretes, faturas do mês).
- o painel é buildado com `VITE_MIKROTIK_AGENT=off`, que esconde o menu "Agente VPS",
  o card do agente e a fila de comandos.
- requer RouterOS 7.1+ com o serviço `www` (REST) acessível a partir da vpsfaedi.

## Repasse para o MikroTik (08)

Na vpsfaedi, a REST do roteador responde ao host mas não aos containers. O
`./08-mikrotik-relay.sh 206.42.25.226:8090` sobe um `socat` (network_mode host) em
`172.17.0.1:18090` e aponta Configurações → MikroTik para `host.docker.internal:18090`.
O endereço real fica em `MIKROTIK_RELAY_TARGET` no `.env` da stack.

## Backup (11)

`./11-backup.sh` instala o backup diário (03:00, crontab do felipemororo): `pg_dump` do banco
inteiro (sem os dados dos logs grandes) + `.env` + Storage, criptografado com a senha em
`/opt/myllenet/.backup-senha`. Retenção 7 diários / 4 semanais / 3 mensais em
`/opt/myllenet/backups`, cópia no Google Drive, conectado pelo painel (Configurações → Backups, function `google-drive`;
pasta "MyLLENET Backups"). O painel também mostra o histórico e tem "Fazer backup agora"
(tabela `backup_pedidos`, checada a cada minuto pelo crontab).
Falha ou mais de 26 h sem backup → aviso no WhatsApp dos admins.

Restaurar: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/opt/myllenet/.backup-senha -in ARQ.tar.enc | tar -xf -`
e depois `./02-restaurar-banco.sh banco.backup` numa stack nova (01).
