import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

router.get('/', authenticate, requirePlatformAdmin, async (req, res) => {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, whatsappNumber: true, birdChannelId: true, credits: true, active: true, createdAt: true },
  })
  res.json(companies)
})

router.post('/', authenticate, requirePlatformAdmin, async (req, res) => {
  const { name, whatsappNumber, birdChannelId } = req.body
  const company = await prisma.company.create({
    data: { name, whatsappNumber, birdChannelId: birdChannelId || null },
  })
  res.status(201).json(company)
})

router.put<{ id: string }>('/:id', authenticate, requirePlatformAdmin, async (req, res) => {
  const { id } = req.params
  const { name, whatsappNumber, birdChannelId } = req.body
  try {
    const company = await prisma.company.update({
      where: { id },
      data: { name, whatsappNumber, birdChannelId: birdChannelId || null },
    })
    res.json(company)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Já existe uma empresa com esse número de WhatsApp.' })
    }
    throw err
  }
})

router.get<{ id: string }>('/:id', authenticate, async (req, res) => {
  const { id } = req.params
  if (req.user?.role !== 'platform_admin' && req.user?.companyId !== id) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const company = await prisma.company.findUnique({ where: { id } })
  res.json(company)
})

export default router
