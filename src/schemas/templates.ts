import { z } from 'zod'
import { trimmed } from './common'

// Limites do WhatsApp: header/footer 60, body 1024, texto de botão 25.
const button = z.object({
  type: z.enum(['url', 'quick_reply']),
  text: trimmed(1, 25),
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((u) => !u || /^https:\/\/\S+$/i.test(u), 'URL do botão deve começar por https://')
    .optional(),
})

const optionalText = (max: number) => z.string().trim().max(max).nullish()

export const templateBodySchema = z.object({
  name: trimmed(1, 120),
  category: z.enum(['marketing', 'utility']),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/, 'language inválido (ex.: pt_BR)')
    .default('pt_BR'),
  channel: z.literal('whatsapp').default('whatsapp'),
  birdProjectId: optionalText(100),
  birdVersionId: optionalText(100),
  birdWabaId: optionalText(100),
  headerType: z.enum(['none', 'text', 'image']).default('none'),
  headerText: optionalText(60),
  bodyText: z.string().min(1, 'bodyText é obrigatório').max(1024),
  footerText: optionalText(60),
  buttons: z.array(button).max(10).default([]),
  variables: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_]{1,40}$/, 'Nome de variável inválido (letras, números e _)')
    )
    .max(20)
    .default([]),
})

export const templateStatusSchema = z
  .object({
    status: z.enum(['draft', 'pending', 'approved', 'rejected', 'paused']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .refine((s) => s.status !== 'rejected' || !!s.rejectionReason, {
    message: 'rejectionReason é obrigatório ao rejeitar',
    path: ['rejectionReason'],
  })
