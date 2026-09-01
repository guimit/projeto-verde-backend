import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

// Templates are a global catalog managed by the Verde team. Every authenticated
// user (any company) sees the same list; only platform_admin can change it.

router.get('/', authenticate, async (_req, res) => {
  const templates = await prisma.template.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(templates)
})

router.post('/', authenticate, requirePlatformAdmin, async (req, res) => {
  const { name, category, bodyText, variables, approved } = req.body
  const template = await prisma.template.create({
    data: {
      name,
      category,
      bodyText,
      variables: variables ?? [],
      approved: approved ?? false,
    },
  })
  res.status(201).json(template)
})

router.put<{ id: string }>('/:id', authenticate, requirePlatformAdmin, async (req, res) => {
  const { name, category, bodyText, variables, approved } = req.body
  const template = await prisma.template.update({
    where: { id: req.params.id },
    data: { name, category, bodyText, variables, approved },
  })
  res.json(template)
})

export default router
