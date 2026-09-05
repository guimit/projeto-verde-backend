import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { addCreditsSchema, companyIdParams } from '../schemas/credits'
import { prisma } from '../utils/prisma'

const router = Router()

router.post<{ companyId: string }>(
  '/:companyId/add',
  authenticate,
  requirePlatformAdmin,
  validate({ params: companyIdParams, body: addCreditsSchema }),
  async (req, res) => {
    const { companyId } = req.params
    const { amount, description } = req.body

    const exists = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
    if (!exists) return res.status(404).json({ error: 'Empresa não encontrada' })

    // Saldo e log na mesma transacção para o balanceAfter ser sempre coerente.
    const credits = await prisma.$transaction(async (tx) => {
      const company = await tx.company.update({
        where: { id: companyId },
        data: { credits: { increment: amount } },
      })
      await tx.creditLog.create({
        data: { companyId, amount, description, balanceAfter: company.credits },
      })
      return company.credits
    })

    res.json({ credits })
  }
)

router.get<{ companyId: string }>(
  '/:companyId/logs',
  authenticate,
  validate({ params: companyIdParams }),
  async (req, res) => {
    const { companyId } = req.params
    const own = req.user?.impersonating ?? req.user?.companyId
    if (req.user?.role !== 'platform_admin' && own !== companyId) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const logs = await prisma.creditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(logs)
  }
)

export default router
