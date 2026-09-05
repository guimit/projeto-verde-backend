import { Router } from 'express'
import {
  login,
  me,
  impersonate,
  endImpersonation,
  verify2FA,
  forgotPassword,
  resetPassword,
} from '../controllers/auth'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import {
  loginSchema,
  otpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas/auth'

const router = Router()

router.post('/login', validate(loginSchema), login)
router.post('/verify-2fa', validate(otpSchema), verify2FA)
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword)
router.post('/reset-password', validate(resetPasswordSchema), resetPassword)
router.get('/me', authenticate, me)
router.post('/impersonate/end', authenticate, requirePlatformAdmin, endImpersonation)
router.post('/impersonate/:companyId', authenticate, requirePlatformAdmin, impersonate)

export default router
