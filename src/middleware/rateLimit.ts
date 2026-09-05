import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'

const common = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos. Tente novamente mais tarde.' },
}

// Tecto global por IP. Generoso: o painel usa SWR com revalidação frequente.
export const globalLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 600,
  skip: (req) => req.path === '/health',
})

// Login, 2FA, reset de password: 6 dígitos de OTP e password não podem ser
// adivinhados por força bruta.
export const authLimiter = rateLimit({
  ...common,
  windowMs: 10 * 60_000,
  limit: 10,
  message: { error: 'Demasiadas tentativas. Aguarde 10 minutos.' },
})

// Webhook do Bird: por IP, folgado para não perder inbounds legítimos.
export const webhookLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 120,
})

// Envio de teste de campanha: por empresa (não debita créditos, logo é o único
// travão contra usar o canal da empresa para spam).
export const testSendLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60_000,
  limit: 10,
  keyGenerator: (req: Request) => req.companyId ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: 'Limite de envios de teste atingido (10 por hora por empresa).' },
})
