import { z } from 'zod'

export const uuid = z.string().uuid('id inválido')
export const idParams = z.object({ id: uuid })

// E.164: "+" e 8 a 15 dígitos. O PhoneInput do frontend emite sempre neste formato.
export const phoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Telefone deve estar no formato E.164 (ex.: +5511999999999)')

// Telefone tal como está guardado na BD (registos antigos podem não ter "+").
export const phoneLookup = z.string().regex(/^\+?\d{6,20}$/, 'Telefone inválido')

export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve ser YYYY-MM-DD')

export const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data/hora inválida')

export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)
