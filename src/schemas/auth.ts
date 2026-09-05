import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().min(1),
})

export const otpSchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().min(6).max(6),
})

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().min(1),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
  turnstileToken: z.string().min(1),
})
