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

router.get<{ id: string }>('/:id/consent', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.id, companyId },
  })
  if (!contact) return res.status(404).json({ error: 'Not found' })

  const events = await prisma.consentEvent.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
  })
  res.json(events)
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
