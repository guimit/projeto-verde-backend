import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { sendWhatsAppTemplate } from '../lib/bird'

const router = Router()

function getCompanyId(req: any) {
  return req.user.impersonating ?? req.user.companyId
}

interface AudienceFilters {
  createdFrom?: string
  createdTo?: string
  withNameOnly?: boolean
}

// Same rules as the audience preview in the frontend (src/app/(app)/campaigns/page.tsx).
async function resolveAudience(companyId: string, filters: unknown) {
  const contacts = await prisma.contact.findMany({ where: { companyId, active: true } })
  const f = (filters ?? {}) as AudienceFilters
  return contacts.filter((c) => {
    if (f.createdFrom && c.createdAt < new Date(f.createdFrom)) return false
    if (f.createdTo && c.createdAt > new Date(`${f.createdTo}T23:59:59`)) return false
    if (f.withNameOnly && !c.name) return false
    return true
  })
}

// Campaigns can only use templates the Verde team has approved.
async function assertTemplateApproved(templateId: string): Promise<string | null> {
  if (!templateId) return 'templateId é obrigatório'
  const template = await prisma.template.findUnique({ where: { id: templateId } })
  if (!template) return 'Template não encontrado'
  if (template.status !== 'approved') return 'Template não está aprovado'
  return null
}

// A variable can be a fixed string typed by the sender, or bound to a field on
// the contact it's being sent to (so "{nome}" becomes that contact's own name).
interface VariableBinding {
  source: 'fixed' | 'contact_name' | 'contact_phone'
  value?: string
}

// Fills a template body with the campaign's chosen values, e.g. "{nome}" -> "Ana".
// Any variable left unfilled, or bound to a contact field with nothing to give
// (no contact, or the contact has no name), stays as "{nome}" so it's obvious.
function renderMessage(
  bodyText: string,
  variableValues: unknown,
  contact?: { name?: string | null; phone: string }
): string {
  const bindings = (variableValues ?? {}) as Record<string, VariableBinding>
  return bodyText.replace(/\{([^}]+)\}/g, (match, key) => {
    const binding = bindings[key]
    if (!binding) return match
    if (binding.source === 'contact_name') return contact?.name || match
    if (binding.source === 'contact_phone') return contact?.phone || match
    return binding.value || match
  })
}

// Resolve os valores das variáveis do template para um contacto concreto, no
// formato { nome: "Ana", imagem: "https://…" } que o Bird espera (named params).
function resolveVariables(
  templateVars: string[],
  variableValues: unknown,
  contact: { name?: string | null; phone: string }
): Record<string, string> {
  const bindings = (variableValues ?? {}) as Record<string, VariableBinding>
  const out: Record<string, string> = {}
  for (const key of templateVars) {
    const b = bindings[key]
    if (!b) continue
    if (b.source === 'contact_name') {
      if (contact.name) out[key] = contact.name
    } else if (b.source === 'contact_phone') {
      out[key] = contact.phone
    } else if (b.value) {
      out[key] = b.value
    }
  }
  return out
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
  const { name, templateId, scheduledAt, filters, variableValues } = req.body
  const templateError = await assertTemplateApproved(templateId)
  if (templateError) return res.status(400).json({ error: templateError })
  const campaign = await prisma.campaign.create({
    data: {
      companyId,
      name,
      templateId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      status: scheduledAt ? 'scheduled' : undefined,
      filters: filters ?? undefined,
      variableValues: variableValues ?? undefined,
    },
  })
  res.status(201).json(campaign)
})

router.get<{ id: string }>('/:id', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
    include: { messages: { include: { contact: true } } },
  })
  if (!campaign) return res.status(404).json({ error: 'Not found' })
  res.json(campaign)
})

router.put<{ id: string }>('/:id', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const existing = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
  })
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.status === 'done') {
    return res.status(400).json({ error: 'Campanha já enviada, não pode ser editada' })
  }

  const { name, templateId, scheduledAt, filters, variableValues } = req.body
  const templateError = await assertTemplateApproved(templateId)
  if (templateError) return res.status(400).json({ error: templateError })
  const campaign = await prisma.campaign.update({
    where: { id: existing.id },
    data: {
      name,
      templateId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      status: scheduledAt ? 'scheduled' : 'draft',
      filters: filters ?? {},
      variableValues: variableValues ?? {},
    },
    include: { template: { select: { name: true } } },
  })
  res.json(campaign)
})

router.delete<{ id: string }>('/:id', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
  })
  if (!campaign) return res.status(404).json({ error: 'Not found' })
  if (campaign.sentAt || campaign.status === 'done' || campaign.status === 'sending') {
    return res.status(400).json({ error: 'Não é possível excluir uma campanha já enviada' })
  }

  await prisma.campaign.delete({ where: { id: campaign.id } })
  res.status(204).end()
})

router.post<{ id: string }>('/:id/cancel-schedule', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
  })
  if (!campaign) return res.status(404).json({ error: 'Not found' })
  if (campaign.status === 'done') {
    return res.status(400).json({ error: 'Campanha já enviada' })
  }
  if (!campaign.scheduledAt) {
    return res.status(400).json({ error: 'Campanha não está agendada' })
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { scheduledAt: null, status: 'draft' },
    include: { template: { select: { name: true } } },
  })
  res.json(updated)
})

// Envia a campanha via Bird.com (WhatsApp). Uma chamada por contacto, sequencial.
// Os créditos só são debitados pelas mensagens efetivamente aceites pelo Bird.
router.post<{ id: string }>('/:id/send', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
    include: { template: true },
  })
  if (!campaign) return res.status(404).json({ error: 'Not found' })
  if (campaign.status === 'done' || campaign.status === 'sending') {
    return res.status(400).json({ error: 'Campanha já enviada ou em envio' })
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } })
  if (!company) return res.status(404).json({ error: 'Company not found' })
  if (company.credits <= 0) {
    return res.status(400).json({ error: 'Sem créditos disponíveis' })
  }

  if (!process.env.BIRD_API_KEY || !process.env.BIRD_WORKSPACE_ID) {
    return res
      .status(400)
      .json({ error: 'Integração Bird não configurada (BIRD_API_KEY / BIRD_WORKSPACE_ID)' })
  }
  if (!company.birdChannelId) {
    return res.status(400).json({ error: 'Empresa sem canal WhatsApp do Bird (birdChannelId)' })
  }
  if (!campaign.template.birdProjectId) {
    return res
      .status(400)
      .json({ error: 'Template sem Project ID do Bird — não pode ser enviado' })
  }

  const audience = await resolveAudience(companyId, campaign.filters)
  if (audience.length === 0) {
    return res.status(400).json({ error: 'A audiência desta campanha está vazia' })
  }

  const toSend = audience.slice(0, company.credits)
  const shortfall = audience.length - toSend.length

  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'sending' } })

  let sent = 0
  let failed = 0
  let firstError: string | undefined
  for (const contact of toSend) {
    const variables = resolveVariables(
      campaign.template.variables,
      campaign.variableValues,
      contact
    )
    const result = await sendWhatsAppTemplate(company.birdChannelId, contact.phone, {
      projectId: campaign.template.birdProjectId,
      version: campaign.template.birdVersionId ?? undefined,
      locale: campaign.template.language,
      variables,
    })
    await prisma.campaignMessage.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        status: result.ok ? 'sent' : 'failed',
        birdMessageId: result.id,
        sentAt: result.ok ? new Date() : null,
      },
    })
    if (result.ok) sent++
    else {
      failed++
      if (!firstError) firstError = result.error
    }
  }

  if (sent === 0) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'draft' } })
    return res
      .status(502)
      .json({ error: `Nenhuma mensagem enviada. Bird: ${firstError ?? 'erro desconhecido'}` })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedCompany = await tx.company.update({
      where: { id: companyId },
      data: { credits: { decrement: sent } },
    })

    await tx.creditLog.create({
      data: {
        companyId,
        amount: -sent,
        description: `Campanha "${campaign.name}"`,
        balanceAfter: updatedCompany.credits,
      },
    })

    return tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'done',
        sentAt: new Date(),
        totalSent: sent,
        totalFailed: failed + shortfall,
        creditsCost: sent,
      },
      include: { template: { select: { name: true } } },
    })
  })

  res.json({ ...updated, summary: { sent, failed, shortfall } })
})

// Test sends don't touch the real audience, credits or campaign status — but they
// do hit Bird for real, so the tester actually receives the WhatsApp message.
router.post<{ id: string }>('/:id/test', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, companyId },
    include: { template: true },
  })
  if (!campaign) return res.status(404).json({ error: 'Not found' })

  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'Número de telefone é obrigatório' })

  // If the test number belongs to a real contact, variables bound to contact
  // fields resolve to that contact's data — same as a real send would.
  const contact = await prisma.contact.findFirst({ where: { companyId, phone } })
  const preview = renderMessage(
    campaign.template.bodyText,
    campaign.variableValues,
    contact ?? undefined
  )

  const company = await prisma.company.findUnique({ where: { id: companyId } })
  if (!company?.birdChannelId || !campaign.template.birdProjectId || !process.env.BIRD_API_KEY) {
    return res.json({
      ok: true,
      phone,
      preview,
      sent: false,
      note: 'Envio real indisponível (canal Bird / Project ID em falta) — só pré-visualização.',
    })
  }

  const variables = resolveVariables(
    campaign.template.variables,
    campaign.variableValues,
    contact ?? { phone }
  )
  const result = await sendWhatsAppTemplate(company.birdChannelId, phone, {
    projectId: campaign.template.birdProjectId,
    version: campaign.template.birdVersionId ?? undefined,
    locale: campaign.template.language,
    variables,
  })
  if (!result.ok) {
    return res.status(502).json({ error: `Falha no teste. Bird: ${result.error ?? 'erro'}` })
  }
  res.json({ ok: true, phone, preview, sent: true, birdMessageId: result.id })
})

export default router
