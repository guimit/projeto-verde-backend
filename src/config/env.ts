// Carrega o .env e valida as variáveis de ambiente ao arrancar. Tem de ser o
// PRIMEIRO import em src/index.ts: módulos que lêem process.env no top-level
// (lib/r2.ts, lib/bird.ts) só correm depois deste.
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const isProd = process.env.NODE_ENV === 'production'
const WEAK_SECRETS = new Set(['change_me_in_production', 'changeme', 'secret', 'jwt_secret'])

// Variável opcional: ausente ou string vazia -> undefined.
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([z.literal('').transform(() => undefined), schema]).optional()

const schema = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    JWT_SECRET: z
      .string()
      .min(1, 'JWT_SECRET é obrigatória')
      .refine((v) => !WEAK_SECRETS.has(v.toLowerCase()), 'JWT_SECRET não pode ser o valor de exemplo')
      .refine(
        (v) => !isProd || v.length >= 32,
        'JWT_SECRET deve ter pelo menos 32 caracteres em produção (ex.: openssl rand -base64 48)'
      ),
    FRONTEND_URL: z.string().url('FRONTEND_URL deve ser um URL completo'),

    // Webhook do Bird. Preferir a assinatura HMAC (signing secret "whsec_..." da
    // subscrição); em alternativa um segredo partilhado enviado no header
    // x-webhook-secret ou no URL (?secret=...). Em produção um dos dois é obrigatório.
    BIRD_WEBHOOK_SIGNING_SECRET: optional(
      z.string().startsWith('whsec_', 'BIRD_WEBHOOK_SIGNING_SECRET deve começar por whsec_')
    ),
    BIRD_WEBHOOK_SECRET: optional(
      z.string().min(16, 'BIRD_WEBHOOK_SECRET deve ter pelo menos 16 caracteres')
    ),

    BIRD_API_KEY: optional(z.string()),
    BIRD_WORKSPACE_ID: optional(z.string()),
    TURNSTILE_SECRET_KEY: optional(z.string()),
    RESEND_API_KEY: optional(z.string()),
    RESEND_FROM_EMAIL: optional(z.string()),
  })
  .refine((e) => !isProd || e.BIRD_WEBHOOK_SIGNING_SECRET || e.BIRD_WEBHOOK_SECRET, {
    message: 'Em produção é obrigatório BIRD_WEBHOOK_SIGNING_SECRET ou BIRD_WEBHOOK_SECRET',
    path: ['BIRD_WEBHOOK_SECRET'],
  })
  .refine((e) => !isProd || !!e.TURNSTILE_SECRET_KEY, {
    message: 'Em produção TURNSTILE_SECRET_KEY é obrigatória (sem ela o login falha sempre)',
    path: ['TURNSTILE_SECRET_KEY'],
  })

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('[env] configuração inválida — o servidor não arranca:')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(global)'}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data

if (!isProd) {
  if (env.JWT_SECRET.length < 32) {
    console.warn('[env] JWT_SECRET tem menos de 32 caracteres — em produção o arranque falha')
  }
  if (!env.BIRD_WEBHOOK_SIGNING_SECRET && !env.BIRD_WEBHOOK_SECRET) {
    console.warn('[env] webhook do Bird sem autenticação — só permitido fora de produção')
  }
}
