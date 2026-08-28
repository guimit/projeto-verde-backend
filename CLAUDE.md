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
src/
  index.ts              # Entry point, registo de rotas
  controllers/
    auth.ts             # login, me, impersonate, endImpersonation
  middleware/
    auth.ts             # authenticate, requireRole, requirePlatformAdmin
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
  prisma/
    schema.prisma       # Schema completo da BD
```

## Roles

- `platform_admin` — equipa interna, acesso total, pode impersonar empresas
- `admin` — dono da empresa cliente, acesso total à própria empresa
- `assistant` — operador da empresa, acesso limitado

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

Ver `.env.example`. Obrigatórias para arrancar:
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`

Bird é opcional até integrar o envio real:
- `BIRD_API_KEY`
- `BIRD_WORKSPACE_ID`

## Comandos

```bash
npm run dev          # desenvolvimento com hot-reload (tsx watch)
npm run build        # compilar para dist/
npm run start        # produção
npm run db:migrate   # aplicar migrations Prisma
npm run db:generate  # regenerar cliente Prisma após alterar schema
npm run db:studio    # UI visual da BD
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
