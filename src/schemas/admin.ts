import { z } from 'zod'
import { trimmed, uuid } from './common'

export const createUserSchema = z
  .object({
    name: trimmed(1, 120),
    email: z.string().trim().email('Email inválido').max(254),
    password: z.string().min(8, 'Password deve ter pelo menos 8 caracteres').max(128),
    role: z.enum(['platform_admin', 'admin', 'assistant']),
    companyId: uuid.nullish(),
  })
  .refine((u) => (u.role === 'platform_admin' ? !u.companyId : !!u.companyId), {
    message: 'platform_admin não tem empresa; admin/assistant precisam de companyId',
    path: ['companyId'],
  })

export const listUsersQuery = z.object({ companyId: uuid.optional() })

export const metricsQuery = z.object({
  range: z.enum(['today', 'yesterday', '7d', '15d', '30d']).default('7d'),
})
