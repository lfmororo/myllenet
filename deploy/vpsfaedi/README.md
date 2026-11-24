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
