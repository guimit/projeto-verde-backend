import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

function getCompanyId(req: any) {
  return req.user.impersonating ?? req.user.companyId
}

router.get('/', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaigns = await prisma.campaign.findMany({
    where: { companyId },
    include: { template: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json(campaigns)
})

router.post('/', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const { name, templateId, scheduledAt, filters } = req.body
  const campaign = await prisma.campaign.create({
    data: { companyId, name, templateId, scheduledAt, filters },
  })
  res.status(201).json(campaign)
})

router.get('/:id', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
    include: { messages: { include: { contact: true } } },
  })
  if (!campaign) return res.status(404).json({ error: 'Not found' })
  res.json(campaign)
})

export default router
