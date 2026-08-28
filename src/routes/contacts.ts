import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

function getCompanyId(req: any) {
  return req.user.impersonating ?? req.user.companyId
}

router.get('/', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const contacts = await prisma.contact.findMany({
    where: { companyId, active: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(contacts)
})

router.post('/optin', async (req, res) => {
  const { companyId, phone, name, consentIp } = req.body
  const contact = await prisma.contact.upsert({
    where: { companyId_phone: { companyId, phone } },
    update: { active: true, consentAt: new Date(), name },
    create: { companyId, phone, name, consentAt: new Date(), consentIp },
  })
  res.status(201).json(contact)
})

export default router
