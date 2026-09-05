import { z } from 'zod'
import { isoDateTime, phoneE164, trimmed, uuid, ymd } from './common'

const variableBinding = z.object({
  source: z.enum(['fixed', 'contact_name', 'contact_phone']),
  value: z.string().max(1024).optional(),
})

export const campaignBodySchema = z.object({
  name: trimmed(1, 120),
  templateId: uuid,
  scheduledAt: isoDateTime.nullish(),
  filters: z
    .object({
      createdFrom: ymd.optional(),
      createdTo: ymd.optional(),
      withNameOnly: z.boolean().optional(),
    })
    .nullish(),
  variableValues: z.record(z.string().min(1).max(64), variableBinding).nullish(),
})

export const testSendSchema = z.object({ phone: phoneE164 })
