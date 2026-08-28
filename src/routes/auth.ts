import { Router } from 'express'
import { login, me, impersonate, endImpersonation } from '../controllers/auth'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'

const router = Router()

router.post('/login', login)
router.get('/me', authenticate, me)
router.post('/impersonate/:companyId', authenticate, requirePlatformAdmin, impersonate)
router.post('/impersonate/end', authenticate, requirePlatformAdmin, endImpersonation)

export default router
