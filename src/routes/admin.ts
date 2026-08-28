import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import bcrypt from 'bcryptjs'

const router = Router()

router.get('/overview', authenticate, requirePlatformAdmin, async (req, res) => {
  const [totalCompanies, totalContacts, totalCampaigns] = await Promise.all([
    prisma.company.count({ where: { active: true } }),
    prisma.contact.count({ where: { active: true } }),
    prisma.campaign.count(),
  ])
  res.json({ totalCompanies, totalContacts, totalCampaigns })
})

router.post('/users', authenticate, requirePlatformAdmin, async (req, res) => {
  const { name, email, password, role, companyId } = req.body
  const hashed = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { name, email, password: hashed, role, companyId },
  })
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role })
})

export default router
