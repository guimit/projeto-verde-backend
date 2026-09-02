import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../utils/prisma'

const router = Router()

function getCompanyId(req: any) {
  return req.user.impersonating ?? req.user.companyId
}

router.get('/', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
  const contacts = await prisma.contact.findMany({
    where: { companyId, active: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(contacts)
})

router.get<{ id: string }>('/:id/consent', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
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
router.delete<{ id: string }>('/:id', authenticate, async (req, res) => {
  const companyId = getCompanyId(req)
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

router.post('/optin', async (req, res) => {
  const { companyId, phone, name, consentIp } = req.body
  const contact = await prisma.contact.upsert({
    where: { companyId_phone: { companyId, phone } },
    update: { active: true, consentAt: new Date(), name },
    create: { companyId, phone, name, consentAt: new Date(), consentIp },
  })
  res.status(201).json(contact)
})

export default router
