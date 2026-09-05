import { Router } from 'express'
import {
  login,
  me,
  impersonate,
  endImpersonation,
  setup2FA,
  confirmSetup2FA,
  verify2FA,
  resendOtp,
  forgotPassword,
  resetPassword,
} from '../controllers/auth'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { authLimiter } from '../middleware/rateLimit'
import { uuid } from '../schemas/common'
import { z } from 'zod'
import {
  loginSchema,
  tempTokenSchema,
  otpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas/auth'

const router = Router()

// Rotas sem sessão: limitadas por IP (força bruta de password/OTP, spam de email).
router.post('/login', authLimiter, validate(loginSchema), login)
router.post('/2fa/setup', authLimiter, validate(tempTokenSchema), setup2FA)
router.post('/2fa/confirm-setup', authLimiter, validate(otpSchema), confirmSetup2FA)
router.post('/verify-2fa', authLimiter, validate(otpSchema), verify2FA)
router.post('/resend-otp', authLimiter, validate(tempTokenSchema), resendOtp)
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword)
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword)
router.get('/me', authenticate, me)
router.post('/impersonate/end', authenticate, requirePlatformAdmin, endImpersonation)
router.post(
  '/impersonate/:companyId',
  authenticate,
  requirePlatformAdmin,
  validate({ params: z.object({ companyId: uuid }) }),
  impersonate
)

export default router
