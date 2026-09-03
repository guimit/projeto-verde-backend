import { Router } from 'express'
import { authenticate, requirePlatformAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

// Os templates são um catálogo global gerido pela equipa Verde. Qualquer utilizador
// autenticado vê os templates aprovados; só o platform_admin vê rascunhos/pendentes
// e pode criar, editar ou mudar o estado.

const HEADER_TYPES = ['none', 'text', 'image'] as const
const STATUSES = ['draft', 'pending', 'approved', 'rejected', 'paused'] as const
type TemplateStatus = (typeof STATUSES)[number]

interface ButtonInput {
  type: 'url' | 'quick_reply'
  text: string
  url?: string
}

// Normaliza o corpo do pedido para os campos que o modelo aceita. `status` nunca
// vem por aqui — é gerido em POST /:id/status.
function templateData(body: any) {
  const headerType = HEADER_TYPES.includes(body.headerType) ? body.headerType : 'none'
  const buttons = Array.isArray(body.buttons)
    ? (body.buttons as ButtonInput[])
        .filter((b) => b && b.text && (b.type === 'url' || b.type === 'quick_reply'))
        .map((b) => ({
          type: b.type,
          text: String(b.text),
          ...(b.type === 'url' && b.url ? { url: String(b.url) } : {}),
        }))
    : []

  return {
    name: body.name,
    category: body.category,
    language: body.language || 'pt_BR',
    channel: body.channel || 'whatsapp',
    birdProjectId: body.birdProjectId || null,
    birdVersionId: body.birdVersionId || null,
    birdWabaId: body.birdWabaId || null,
    headerType,
    headerText: headerType === 'text' ? body.headerText || null : null,
    headerMediaUrl: headerType === 'image' ? body.headerMediaUrl || null : null,
    bodyText: body.bodyText,
    footerText: body.footerText || null,
    buttons,
    variables: Array.isArray(body.variables) ? body.variables : [],
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

router.post('/', authenticate, requirePlatformAdmin, async (req, res) => {
  const data = templateData(req.body)
  if (!data.name || !data.category || !data.bodyText) {
    return res.status(400).json({ error: 'name, category e bodyText são obrigatórios' })
  }
  const template = await prisma.template.create({ data })
  res.status(201).json(template)
})

router.put<{ id: string }>('/:id', authenticate, requirePlatformAdmin, async (req, res) => {
  const data = templateData(req.body)
  if (!data.name || !data.category || !data.bodyText) {
    return res.status(400).json({ error: 'name, category e bodyText são obrigatórios' })
  }
  const template = await prisma.template.update({
    where: { id: req.params.id },
    data,
  })
  res.json(template)
})

// Transição de estado de aprovação. Ao aprovar, regista quem/quando; ao rejeitar,
// exige um motivo.
router.post<{ id: string }>('/:id/status', authenticate, requirePlatformAdmin, async (req, res) => {
  const status = req.body.status as TemplateStatus
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status inválido (${STATUSES.join(', ')})` })
  }
  const rejectionReason: string | undefined = req.body.rejectionReason?.trim()
  if (status === 'rejected' && !rejectionReason) {
    return res.status(400).json({ error: 'rejectionReason é obrigatório ao rejeitar' })
  }

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
})

router.delete<{ id: string }>('/:id', authenticate, requirePlatformAdmin, async (req, res) => {
  const count = await prisma.campaign.count({ where: { templateId: req.params.id } })
  if (count > 0) {
    return res.status(400).json({ error: 'Template usado por campanhas — não pode ser eliminado' })
  }
  await prisma.template.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
