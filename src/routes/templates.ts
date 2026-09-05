import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { idParams } from '../schemas/common'
import { templateBodySchema, templateStatusSchema } from '../schemas/templates'
import { prisma } from '../utils/prisma'

const router = Router()

// Os templates são um catálogo global gerido pela equipa Verde. Qualquer utilizador
// autenticado vê os templates aprovados; só o platform_admin vê rascunhos/pendentes
// e pode criar, editar ou mudar o estado.

type TemplateBody = ReturnType<typeof templateBodySchema.parse>

// O body já vem validado e normalizado pelo zod (templateBodySchema); aqui só se
// aplicam as regras de negócio: headerText só com header de texto, botões de
// URL só levam `url` se tiverem um, vazios -> null. `status` nunca vem por aqui —
// é gerido em POST /:id/status.
function templateData(body: TemplateBody) {
  return {
    name: body.name,
    category: body.category,
    language: body.language,
    channel: body.channel,
    birdProjectId: body.birdProjectId || null,
    birdVersionId: body.birdVersionId || null,
    birdWabaId: body.birdWabaId || null,
    headerType: body.headerType,
    headerText: body.headerType === 'text' ? body.headerText || null : null,
    bodyText: body.bodyText,
    footerText: body.footerText || null,
    buttons: body.buttons.map((b) => ({
      type: b.type,
      text: b.text,
      ...(b.type === 'url' && b.url ? { url: b.url } : {}),
    })),
    variables: body.variables,
  }
}

router.get('/', authenticate, async (req, res) => {
  const isAdmin = req.user?.role === 'platform_admin'
  const templates = await prisma.template.findMany({
    where: isAdmin ? undefined : { status: 'approved' },
    orderBy: { createdAt: 'desc' },
  })
  res.json(templates)
})

router.post('/', authenticate, requirePlatformAdmin, validate(templateBodySchema), async (req, res) => {
  const template = await prisma.template.create({ data: templateData(req.body) })
  res.status(201).json(template)
})

router.put<{ id: string }>(
  '/:id',
  authenticate,
  requirePlatformAdmin,
  validate({ params: idParams, body: templateBodySchema }),
  async (req, res) => {
    const existing = await prisma.template.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!existing) return res.status(404).json({ error: 'Not found' })
    const template = await prisma.template.update({
      where: { id: existing.id },
      data: templateData(req.body),
    })
    res.json(template)
  }
)

// Transição de estado de aprovação. Ao aprovar, regista quem/quando; ao rejeitar,
// exige um motivo (validado no schema).
router.post<{ id: string }>(
  '/:id/status',
  authenticate,
  requirePlatformAdmin,
  validate({ params: idParams, body: templateStatusSchema }),
  async (req, res) => {
    const { status, rejectionReason } = req.body

    const existing = await prisma.template.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const template = await prisma.template.update({
      where: { id: existing.id },
      data: {
        status,
        rejectionReason: status === 'rejected' ? rejectionReason : null,
        approvedAt: status === 'approved' ? new Date() : null,
        approvedById: status === 'approved' ? req.user!.userId : null,
      },
    })
    res.json(template)
  }
)

router.delete<{ id: string }>(
  '/:id',
  authenticate,
  requirePlatformAdmin,
  validate({ params: idParams }),
  async (req, res) => {
    const count = await prisma.campaign.count({ where: { templateId: req.params.id } })
    if (count > 0) {
      return res.status(400).json({ error: 'Template usado por campanhas — não pode ser eliminado' })
    }
    try {
      await prisma.template.delete({ where: { id: req.params.id } })
    } catch (err: any) {
      if (err?.code === 'P2025') return res.status(404).json({ error: 'Not found' })
      throw err
    }
    res.status(204).end()
  }
)

export default router
