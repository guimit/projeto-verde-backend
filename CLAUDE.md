# CLAUDE.md — projeto-verde-backend

## O que é este projeto

Backend da plataforma de marketing via WhatsApp (Projeto Verde).
API REST em Node.js que serve o painel web e integra com a Bird.com para envio de mensagens.

## Stack

- **Runtime:** Node.js
- **Framework:** Express
- **Linguagem:** TypeScript
- **ORM:** Prisma
- **DB:** PostgreSQL
- **Auth:** JWT próprio (sem biblioteca externa de auth)
- **WhatsApp API:** Bird.com
- **Deploy:** Railway

## Estrutura

```
prisma/
  schema.prisma         # Schema completo da BD (localização padrão do Prisma)
  migrations/           # Histórico de migrations
  seed.ts               # Cria o primeiro platform_admin
src/
  index.ts              # Entry point, registo de rotas, handler de erros
  config/
    env.ts              # Validação das variáveis de ambiente (primeiro import)
  schemas/              # Schemas zod por rota (validate())
  controllers/
    auth.ts             # login, me, impersonate, endImpersonation
  middleware/
    auth.ts             # authenticate, requireRole, requireCompany, requireCompanyAdmin, requirePlatformAdmin
    validate.ts         # validate({ body, params, query }) com zod
    rateLimit.ts        # limiters (global, auth, webhook, envio de teste)
  routes/
    auth.ts
    companies.ts
    contacts.ts
    campaigns.ts
    templates.ts
    credits.ts
    admin.ts
  utils/
    prisma.ts           # Singleton do PrismaClient
```

## Roles

- `platform_admin` — equipa interna, acesso total, pode impersonar empresas
- `admin` — dono da empresa cliente, acesso total à própria empresa
- `assistant` — operador da empresa, acesso limitado

### Matriz de permissões (aplicada no servidor)

| Acção | platform_admin | admin | assistant |
|---|---|---|---|
| Ver contactos, campanhas, templates aprovados, créditos, uploads | ✔ | ✔ | ✔ |
| Criar/editar campanhas, agendar/cancelar agendamento, envio de teste | ✔ | ✔ | ✔ |
| Fazer upload de ficheiros | ✔ | ✔ | ✔ |
| **Enviar** campanha (`POST /campaigns/:id/send`) | ✔ | ✔ | ✘ |
| Apagar campanha, contacto ou upload | ✔ | ✔ | ✘ |
| Gerir empresas, utilizadores, créditos, catálogo de templates, métricas | ✔ | ✘ | ✘ |

Middlewares em `src/middleware/auth.ts`:
- `authenticate` — valida o JWT **e** confirma na BD que o utilizador existe e está `active`; `role`/`companyId` vêm da BD, não do token.
- `requireCompany` — resolve `req.companyId` (`impersonating ?? companyId`); 403 se não houver empresa. Obrigatório em todas as rotas de dados de empresa.
- `requireCompanyAdmin` — `platform_admin` ou `admin`.
- `requirePlatformAdmin` — só equipa interna.

## Segurança — regras fixas

- **Toda a rota valida input com zod** via `validate({ body, params, query })` (`src/middleware/validate.ts`); schemas em `src/schemas/`. IDs em params são sempre `uuid`; telefones `phoneE164`.
- **Nunca** ler `companyId` do body/query para decidir acesso — vem sempre de `req.companyId`.
- Uploads: o tipo é detectado pelos magic bytes (`src/routes/uploads.ts`), nunca pelo `mimetype` ou extensão do cliente. Só PNG, JPEG e PDF.
- Webhook do Bird (`/api/webhooks/bird`): autenticado por assinatura HMAC (`BIRD_WEBHOOK_SIGNING_SECRET`) ou segredo partilhado (`BIRD_WEBHOOK_SECRET`, header `x-webhook-secret` ou `?secret=`). Em produção um dos dois é obrigatório.
- Rate limiting (`src/middleware/rateLimit.ts`): global por IP, apertado nas rotas de auth, por empresa no envio de teste, por IP no webhook. OTP por email invalida-se ao 5.º erro.
- Env validada ao arrancar em `src/config/env.ts` (é o primeiro import de `index.ts`). Ler variáveis por `env.X`, não por `process.env`.
- Logs sem PII: telefones sempre por `maskPhone` (`src/lib/log.ts`); nunca logar o payload de webhooks nem de envios.

## Impersonation

O `platform_admin` pode aceder ao painel de qualquer empresa cliente.
Quando activo, o JWT contém `impersonating: <companyId>`.
Todas as rotas que lêem dados de empresa usam `req.user.impersonating ?? req.user.companyId`.
O log é guardado em `ImpersonationLog`.

## Créditos

Modelo pré-pago. Créditos são inteiros (número de mensagens).
Só o `platform_admin` pode adicionar créditos via `POST /api/credits/:companyId/add`.
Cada operação gera um `CreditLog` com `balanceAfter`.
Envio de campanha deve verificar saldo antes de disparar — bloquear se `credits <= 0`.

## Variáveis de ambiente

Ver `.env.example`. Validadas ao arrancar (`src/config/env.ts`). Obrigatórias:
- `DATABASE_URL`
- `JWT_SECRET` (≥ 32 caracteres em produção; nunca o valor de exemplo)
- `FRONTEND_URL`
- Em produção também: `TURNSTILE_SECRET_KEY` e `BIRD_WEBHOOK_SIGNING_SECRET` **ou** `BIRD_WEBHOOK_SECRET`

Bird é opcional até integrar o envio real:
- `BIRD_API_KEY`
- `BIRD_WORKSPACE_ID`

Seed do primeiro admin (`npm run db:seed`) — sem defaults, ambas obrigatórias:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (≥ 12 caracteres)

## Comandos

```bash
npm run dev          # desenvolvimento com hot-reload (tsx watch)
npm run build        # compilar para dist/
npm run start        # produção
npm run db:migrate   # aplicar migrations Prisma
npm run db:generate  # regenerar cliente Prisma após alterar schema
npm run db:studio    # UI visual da BD
npm run db:seed      # criar o primeiro platform_admin
```

## Convenções

- Erros retornam sempre `{ error: string }` com o HTTP status adequado
- UUIDs como IDs em todas as tabelas
- Timestamps em UTC
- Nunca expor o campo `password` nas respostas
- Ao adicionar uma rota nova, registá-la em `src/index.ts`

## CI/CD Context

- Always create PRs targeting the `dev` branch, never `main`
- Use: `gh pr create --base dev`
