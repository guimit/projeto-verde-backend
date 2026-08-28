import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

router.post('/:companyId/add', authenticate, requirePlatformAdmin, async (req, res) => {
  const { companyId } = req.params
  const { amount, description } = req.body

  const company = await prisma.company.update({
    where: { id: companyId },
    data: { credits: { increment: amount } },
  })

  await prisma.creditLog.create({
    data: { companyId, amount, description, balanceAfter: company.credits },
  })

  res.json({ credits: company.credits })
})

router.get('/:companyId/logs', authenticate, async (req, res) => {
  const { companyId } = req.params
  if (req.user?.role !== 'platform_admin' && req.user?.companyId !== companyId) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const logs = await prisma.creditLog.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
  })
  res.json(logs)
})

export default router
