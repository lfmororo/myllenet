# myllenet-api

Backend Fastify + PostgreSQL que substitui o Supabase (PostgREST + Edge Functions + Auth).

## Estrutura

```
server/
  src/
    index.ts        # entrada Fastify, middlewares de auth, rotas públicas
    config.ts       # variáveis de ambiente
    db.ts           # pool pg + helpers query/execute
    schema.ts       # whitelist tabelas/colunas (anti SQL injection)
    query.ts        # monta WHERE/ORDER/LIMIT seguro
    routes/
      auth.ts       # signup/login/me (JWT + bcrypt)
      rest.ts       # CRUD genérico estilo PostgREST (/api/rest/*)
      rpc.ts        # funções RPC (relatórios, bloqueio)
      functions.ts  # edge functions portadas (WhatsApp, EFI, MP, Mikrotik, cron)
    services/       # whatsapp, efi, mikrotik, settings
    jobs.ts         # node-cron (agendamentos)
  sql/schema.sql    # DDL PostgreSQL completo
  scripts/migrate-data.mjs  # migração Supabase -> PostgreSQL
  docker-compose.yml
  Dockerfile
```

## Setup local

```sh
cd server
cp .env.example .env   # preencher credenciais
npm install
# criar o banco
psql "postgres://myllenet:SENHA@localhost:5432/myllenet" -f sql/schema.sql
npm run dev            # http://localhost:3333
```

## Variáveis de ambiente

Ver `.env.example`. Obrigatórias: `DB_*`, `JWT_SECRET`, `CRON_SECRET`.
Opcionais por integração: `EFI_*`, `MERCADOPAGO_ACCESS_TOKEN`, `UAZAPI_TOKEN`,
`EVOLUTION_*`, `MIKROTIK_*` (também configuráveis via tabela `settings`).

## Deploy na VPS (Docker)

```sh
cd server
cp .env.example .env   # preencher DB_PASSWORD, JWT_SECRET, CRON_SECRET
docker compose up -d --build
```

O `schema.sql` roda automaticamente na primeira subida do container PostgreSQL
(`/docker-entrypoint-initdb.d`).

## Migração de dados (Supabase -> PostgreSQL)

```sh
cd server
SUPABASE_URL="https://SEU.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
DB_HOST=127.0.0.1 DB_USER=myllenet DB_PASSWORD=... DB_NAME=myllenet \
node scripts/migrate-data.mjs
```

Notas:
- Usuários migram com `password_hash` vazio. Definir senha do admin:
  rodar o signup (primeiro usuário vira admin) ou gerar hash via
  `node -e "console.log(require('bcryptjs').hashSync('NOVA_SENHA',10))"`
  e atualizar `users.password_hash`.
- Dados `timestamptz`/`jsonb` são normalizados automaticamente.

## Endpoints principais

- `POST /api/auth/signup` / `POST /api/auth/login` / `GET /api/auth/me`
- `POST /api/rest/select|insert|update|delete`
- `POST /api/rpc/get_bandwidth_report` (e demais RPCs)
- `POST /api/functions/<nome>` (whatsapp-send/*, efi-boleto/*, mercadopago/*,
  mikrotik-*, generate-invoice-pdf, user-management/*, etc.)
- `GET /api/public/invoice/:id` (fatura pública)
- `POST /api/public/feedback`

## Frente (frontend)

O app usa `VITE_API_URL` para apontar para esta API. Em produção, configurar
`VITE_API_URL=https://SEU_DOMINIO:3333` e rebuildar o frontend.
