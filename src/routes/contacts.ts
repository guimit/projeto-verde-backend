import { Router } from 'express'
import { authenticate, requireCompany, requireCompanyAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { idParams } from '../schemas/common'
import { phoneQuery } from '../schemas/contacts'
import { prisma } from '../utils/prisma'

const router = Router()

// Todas as rotas exigem sessão e empresa activa (req.companyId vem de requireCompany).
router.use(authenticate, requireCompany)

router.get('/', async (req, res) => {
  const companyId = req.companyId!
  const contacts = await prisma.contact.findMany({
    where: { companyId, active: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(contacts)
})

// GET /api/contacts/deleted — contatos que saíram da lista, por duas vias:
//  - 'panel': removidos pelo painel a pedido do titular (a linha Contact é apagada);
//  - 'whatsapp_optout': opt-out por WhatsApp ("sair"/"parar").
// Ambas registam um ConsentEvent `revoked`, que é a fonte da lista. Fica um registo
// por telefone (o mais recente). `rejoined` marca quem já tem de novo um contato ativo.
router.get('/deleted', async (req, res) => {
  const companyId = req.companyId!
  const events = await prisma.consentEvent.findMany({
    where: { companyId, type: 'revoked' },
    orderBy: { createdAt: 'desc' },
  })

  const activeContacts = await prisma.contact.findMany({
    where: { companyId, active: true },
    select: { phone: true },
  })
  const activePhones = new Set(activeContacts.map((c) => c.phone))

  const seen = new Set<string>()
  const rows = []
  for (const e of events) {
    if (seen.has(e.phone)) continue
    seen.add(e.phone)
    rows.push({
      id: e.id,
      phone: e.phone,
      name: e.name,
      createdAt: e.createdAt,
      source: e.channel === 'panel' ? 'panel' : 'whatsapp_optout',
      rejoined: activePhones.has(e.phone),
    })
  }

  res.json(rows)
})

// GET /api/contacts/consent?phone=... — histórico de consentimento por telefone.
// Funciona para contatos ativos e removidos (os eventos são mantidos mesmo depois
// de a linha Contact ser apagada, com contactId a null).
router.get('/consent', validate({ query: phoneQuery }), async (req, res) => {
  const companyId = req.companyId!
  const phone = String(req.query.phone)

  const events = await prisma.consentEvent.findMany({
    where: { companyId, phone },
    orderBy: { createdAt: 'desc' },
  })
  res.json(events)
})

// GET /api/contacts/timeline?phone=... — tudo o que aconteceu com um telefone:
// eventos de consentimento (dado/revogado) + campanhas enviadas + criação do contato.
// Ordenado do mais recente para o mais antigo. Funciona para contatos ativos,
// em opt-out e removidos pelo painel (para estes as campanhas já não existem).
router.get('/timeline', validate({ query: phoneQuery }), async (req, res) => {
  const companyId = req.companyId!
  const phone = String(req.query.phone)

  const [contact, consentEvents] = await Promise.all([
    prisma.contact.findFirst({ where: { companyId, phone } }),
    prisma.consentEvent.findMany({
      where: { companyId, phone },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const events: Array<{
    id: string
    at: Date
    kind: 'consent_granted' | 'consent_revoked' | 'campaign' | 'contact_created'
    title: string
    detail?: string | null
    channel?: string | null
    status?: string | null
  }> = []

  for (const e of consentEvents) {
    events.push({
      id: `consent:${e.id}`,
      at: e.createdAt,
      kind: e.type === 'granted' ? 'consent_granted' : 'consent_revoked',
      title: e.type === 'granted' ? 'Consentimento dado' : 'Consentimento revogado',
      detail: e.replyText ?? null,
      channel: e.channel,
    })
  }

  if (contact) {
    events.push({
      id: `contact:${contact.id}`,
      at: contact.createdAt,
      kind: 'contact_created',
      title: 'Contato criado',
      detail: contact.consentSource ?? null,
    })

    const messages = await prisma.campaignMessage.findMany({
      where: { contactId: contact.id },
      include: {
        campaign: {
          select: { name: true, template: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
    for (const m of messages) {
      events.push({
        id: `msg:${m.id}`,
        at: m.sentAt ?? m.updatedAt,
        kind: 'campaign',
        title: `Campanha "${m.campaign.name}"`,
        detail: m.campaign.template?.name ?? null,
        status: m.status,
      })
    }
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime())

  res.json({
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          consentAt: contact.consentAt,
          consentSource: contact.consentSource,
          active: contact.active,
          createdAt: contact.createdAt,
        }
      : null,
    phone,
    events,
  })
})

router.get<{ id: string }>('/:id/consent', validate({ params: idParams }), async (req, res) => {
  const companyId = req.companyId!
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.id, companyId },
  })
  if (!contact) return res.status(404).json({ error: 'Not found' })

  const events = await prisma.consentEvent.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
  })
  res.json(events)
})

// DELETE /api/contacts/:id — exclusão a pedido do titular (LGPD/RGPD).
// Apaga o Contact e os dados pessoais na tabela Contact, mas preserva o histórico
// de ConsentEvent como prova legal (desassociado do contato). A OptInSession é
// apagada para que, se a pessoa quiser voltar, passe de novo por todo o duplo opt-in.
router.delete<{ id: string }>('/:id', requireCompanyAdmin, validate({ params: idParams }), async (req, res) => {
  const companyId = req.companyId!
  const contact = await prisma.contact.findFirst({
    where: { id: req.params.id, companyId },
  })
  if (!contact) return res.status(404).json({ error: 'Not found' })

  await prisma.$transaction(async (tx) => {
    // Evento final: documenta que a exclusão foi feita a pedido do titular.
    await tx.consentEvent.create({
      data: {
        companyId,
        contactId: null,
        phone: contact.phone,
        name: contact.name,
        type: 'revoked',
        channel: 'panel',
        replyText: 'Exclusão a pedido do titular (painel)',
      },
    })
    // Desassociar eventos antigos (mantidos como prova, sem ligação ao contato).
    await tx.consentEvent.updateMany({
      where: { contactId: contact.id },
      data: { contactId: null },
    })
    // CampaignMessage.contact é FK obrigatória — apagar antes do contato.
    // Os totais das campanhas estão desnormalizados em Campaign e sobrevivem.
    await tx.campaignMessage.deleteMany({ where: { contactId: contact.id } })
    // Sem sessão, um novo inbound obriga a refazer o consentimento do zero.
    await tx.optInSession.deleteMany({ where: { companyId, phone: contact.phone } })
    await tx.contact.delete({ where: { id: contact.id } })
  })

  res.status(204).end()
})

// Não existe rota pública de opt-in: o consentimento entra só pelo double opt-in
// por WhatsApp (routes/webhooks.ts). Uma rota aberta com companyId no body
// permitia a qualquer pessoa criar contactos com consentimento forjado ou
// reactivar quem fez opt-out.

export default router
