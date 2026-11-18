# Migração do MyLLENET: Lovable Cloud → VPS própria

Destino: Supabase auto-hospedado **isolado** (projeto `myllenet`, containers `myllenet-*`),
na mesma VPS do Easypanel/Evolution/vigilant, atrás do Traefik do Easypanel.

| O quê | Onde |
|---|---|
| Painel (front) | https://myllenet.mororo.tech |
| API Supabase (auth, rest, functions, realtime, Studio) | https://api-myllenet.mororo.tech |
| Arquivos na VPS | `/opt/myllenet/{app,supabase,secrets}` |

O que é copiado: todas as tabelas e dados do `public`, funções SQL, RLS, **usuários com as
mesmas senhas**, gatilhos de `auth.users`, crons (`pg_cron`, reapontados para a VPS), tabelas
do realtime e os segredos das Edge Functions (Efí, Mercado Pago, UAZAPI/Evolution, tokens).

O que **não** muda até a virada: a versão na Lovable continua funcionando durante todo o
processo. Nada é apagado lá.

---

## 0. Antes de começar

1. **DNS**: crie dois registros A apontando para o IP da VPS:
   `myllenet.mororo.tech` e `api-myllenet.mororo.tech`.
2. **RAM**: o Supabase do MyLLENET usa ~2–3 GB. Confira com `free -h`.
3. **Clonar o repositório** (branch `vps-migration`) na VPS:
   ```bash
   sudo -i
   mkdir -p /opt/myllenet && cd /opt/myllenet
   git clone -b vps-migration https://github.com/lfmororo/myllenet.git app
   # repositório privado: use um token do GitHub como senha, ou uma deploy key
   cd /opt/myllenet/app/deploy/vps
   cp config.env.example config.env     # revise domínios/portas se quiser
   ```

## 1. Instalar o Supabase do MyLLENET

```bash
bash 01-install-supabase.sh
```

Ele baixa a configuração oficial, renomeia projeto/containers para `myllenet`, publica portas
só em `127.0.0.1` (8210, 8211, 5442, 6553), gera senhas e chaves, desliga o cadastro público
e sobe tudo. Não mexe no Supabase do vigilant.

## 2. Publicar a função temporária de exportação na Lovable Cloud

A Lovable não mostra a senha do banco nem os segredos. Uma função temporária os entrega
**uma vez**, protegida por uma chave que só você tem.

1. Na VPS, gere a chave e guarde no terminal (não mande por chat/WhatsApp):
   ```bash
   openssl rand -hex 24
   ```
2. No editor da Lovable (projeto MyLLENET), peça:
   > Crie a edge function `myllenet-export` com exatamente este código e publique.

   e cole o conteúdo de `deploy/vps/lovable-export/index.ts`, trocando `TROQUE_PELA_CHAVE`
   pela chave gerada.

## 3. Copiar banco, logins, crons e segredos

```bash
bash 02-migrate-data.sh      # pede a chave do passo 2
```

No fim ele mostra uma tabela **antigo × novo** com a contagem de cada tabela.
Diferenças pequenas em tabelas de log são normais (a Lovable continua recebendo dados).

👉 **Logo depois, apague a função `myllenet-export` na Lovable** (peça: “apague a edge
function myllenet-export”).

## 4. Edge Functions e front

```bash
bash 03-deploy-functions.sh
bash 04-build-frontend.sh
```

## 5. Rota no Traefik do Easypanel

Abra `/etc/easypanel/traefik/config/custom.yaml` e acrescente as rotas de
`templates/traefik-myllenet.yaml` **dentro** das seções `http.routers`, `http.middlewares`
e `http.services` que já existem (as do vigilant/RustDesk). Use o mesmo `certResolver` e os
mesmos nomes de `entryPoints` que as rotas existentes usam. O Traefik relê o arquivo sozinho.

Teste: abra https://myllenet.mororo.tech e entre com seu usuário e senha de sempre.

> Se o 01 avisar que a rede `easypanel` não existe ou não é attachable, o Traefik não vai
> alcançar o `myllenet-web` pelo nome. Rode `docker network ls` e me mande a saída que ajusto.

## 6. Virada (quando estiver tudo ok)

Faça numa janela de pouco uso, nesta ordem:

1. **Rode o 02 de novo para pegar os dados mais recentes** (precisa do banco novo vazio):
   ```bash
   cd /opt/myllenet/supabase && docker compose down && rm -rf volumes/db/data && docker compose up -d
   cd /opt/myllenet/app/deploy/vps && bash 02-migrate-data.sh && bash 03-deploy-functions.sh
   ```
   (republique a `myllenet-export` antes e apague depois.)
2. **Agente MikroTik**: no `.env` do agente, troque
   `SUPABASE_URL=https://bleenvuqsrvkmxwaoswb.supabase.co` por
   `SUPABASE_URL=https://api-myllenet.mororo.tech` e reinicie o serviço
   (`systemctl restart mikrotik-agent`).
3. **Mercado Pago**: atualize a URL de notificações para
   `https://api-myllenet.mororo.tech/functions/v1/mercadopago/webhook`
   (aparece pronta em Configurações no painel novo).
4. **Efí**: se houver webhook cadastrado no painel da Efí, troque o domínio da mesma forma.
5. **Desligar os crons da Lovable** para não haver cobrança/WhatsApp em dobro — peça na Lovable:
   > Desative todos os jobs do pg_cron deste projeto (cron.unschedule de todos).
6. Avise os usuários que o endereço agora é https://myllenet.mororo.tech (mesma senha).

## Atualizações futuras

```bash
cd /opt/myllenet/app && git pull
cd deploy/vps && bash 03-deploy-functions.sh && bash 04-build-frontend.sh
```

## Onde fica o quê

| Arquivo | Conteúdo |
|---|---|
| `/opt/myllenet/supabase/.env` | senhas do banco, JWT, chaves anon/service, senha do Studio |
| `/opt/myllenet/supabase/functions.env` | segredos das Edge Functions |
| `/opt/myllenet/secrets/` | export da Lovable e dumps — **apague após a virada** |

Logs: `cd /opt/myllenet/supabase && docker compose logs -f functions` (ou `db`, `auth`, `web`).
Backup do banco: `docker exec myllenet-db pg_dump -U postgres -d postgres -Fc > myllenet-$(date +%F).dump`
