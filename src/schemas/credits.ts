import { z } from 'zod'
import { trimmed, uuid } from './common'

export const companyIdParams = z.object({ companyId: uuid })

export const addCreditsSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'amount deve ser um número' })
    .int('amount deve ser inteiro')
    .positive('amount deve ser positivo')
    .max(1_000_000, 'amount máximo: 1.000.000'),
  description: trimmed(1, 255),
})
