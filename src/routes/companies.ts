import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { idParams } from '../schemas/common'
import { companyCreateSchema, companyUpdateSchema } from '../schemas/companies'
import { prisma } from '../utils/prisma'

const router = Router()

// undefined -> campo não enviado, fica como está; ''/null -> limpa.
const orNull = (v: string | null | undefined) => (v === undefined ? undefined : v || null)

router.get('/', authenticate, requirePlatformAdmin, async (req, res) => {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, whatsappNumber: true, birdChannelId: true, credits: true, active: true, createdAt: true },
  })
  res.json(companies)
})

router.post('/', authenticate, requirePlatformAdmin, validate(companyCreateSchema), async (req, res) => {
  const { name, whatsappNumber, birdChannelId, supportPhone } = req.body
  try {
    const company = await prisma.company.create({
      data: {
        name,
        whatsappNumber,
        birdChannelId: birdChannelId || null,
        supportPhone: supportPhone || null,
      },
    })
    res.status(201).json(company)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Já existe uma empresa com esse número de WhatsApp.' })
    }
    throw err
  }
})

router.put<{ id: string }>(
  '/:id',
  authenticate,
  requirePlatformAdmin,
  validate({ params: idParams, body: companyUpdateSchema }),
  async (req, res) => {
    const { id } = req.params
    const { name, whatsappNumber, birdChannelId, supportPhone } = req.body
    try {
      const company = await prisma.company.update({
        where: { id },
        data: {
          name,
          whatsappNumber,
          birdChannelId: orNull(birdChannelId),
          supportPhone: orNull(supportPhone),
        },
      })
      res.json(company)
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return res.status(409).json({ error: 'Já existe uma empresa com esse número de WhatsApp.' })
      }
      if (err?.code === 'P2025') return res.status(404).json({ error: 'Not found' })
      throw err
    }
  }
)

router.get<{ id: string }>('/:id', authenticate, validate({ params: idParams }), async (req, res) => {
  const { id } = req.params
  const own = req.user?.impersonating ?? req.user?.companyId
  if (req.user?.role !== 'platform_admin' && own !== id) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const company = await prisma.company.findUnique({ where: { id } })
  if (!company) return res.status(404).json({ error: 'Not found' })
  res.json(company)
})

export default router
