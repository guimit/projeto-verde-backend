import { z } from 'zod'
import { phoneE164, trimmed } from './common'

// supportPhone só é usado como dígitos (wa.me), por isso aceita formatos soltos.
const loosePhone = z.string().trim().regex(/^\+?[\d\s()-]{6,25}$/, 'Telefone de apoio inválido')

export const companyCreateSchema = z.object({
  name: trimmed(1, 120),
  whatsappNumber: phoneE164,
  birdChannelId: z.string().trim().max(100).nullish(),
  supportPhone: loosePhone.nullish(),
})

// O painel de edição não envia `name` — campos ausentes ficam inalterados.
export const companyUpdateSchema = companyCreateSchema.partial()
