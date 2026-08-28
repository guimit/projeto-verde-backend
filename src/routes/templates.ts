import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

function getCompanyId(req: any) {
  return req.user.impersonating ?? req.user.companyId
}

router.get('/', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const templates = await prisma.template.findMany({ where: { companyId } })
  res.json(templates)
})

router.post('/', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const { name, category, bodyText, variables } = req.body
  const template = await prisma.template.create({
    data: { companyId, name, category, bodyText, variables: variables ?? [] },
  })
  res.status(201).json(template)
})

export default router
