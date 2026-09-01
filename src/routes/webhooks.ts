import { Router } from 'express'
import { prisma } from '../utils/prisma'

const router = Router()

// Palavras que, recebidas por WhatsApp, contam como consentimento de opt-in.
// Configurável via OPTIN_KEYWORDS (separadas por vírgula).
const OPTIN_KEYWORDS = (process.env.OPTIN_KEYWORDS ?? 'sim,quero,aceito,yes,start')
  .split(',')
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean)

function isOptIn(text: string) {
  const t = text.trim().toLowerCase()
  return OPTIN_KEYWORDS.some((k) => t === k || t.startsWith(k + ' ') || t.startsWith(k + ','))
}

function normalizePhone(value: string) {
  const digits = String(value).replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

// O formato exacto do payload de inbound do Bird.com pode variar consoante a
// configuração do canal. Extraímos de forma defensiva os campos que interessam.
function extractInbound(body: any): { from: string; text: string; channelId?: string; to?: string } {
  const msg = body?.message ?? body?.payload ?? body ?? {}

  const from =
    msg?.sender?.contact?.identifierValue ??
    msg?.sender?.identifierValue ??
    msg?.from ??
    msg?.originator ??
    body?.from ??
    ''

  const text =
    msg?.body?.text?.text ??
    msg?.body?.text ??
    msg?.text?.text ??
    msg?.text ??
    msg?.content?.text ??
    body?.text ??
    ''

  const channelId = msg?.channelId ?? msg?.channel?.id ?? body?.channelId
  const to =
    msg?.receiver?.contacts?.[0]?.identifierValue ??
    msg?.to ??
    msg?.recipient ??
    body?.to

  return { from: String(from), text: String(text), channelId, to: to ? String(to) : undefined }
}

// POST /api/webhooks/bird — recebe mensagens inbound do WhatsApp (via Bird.com).
// Sem JWT. Se BIRD_WEBHOOK_SECRET estiver definido, exige o header x-webhook-secret.
router.post('/bird', async (req, res) => {
  const secret = process.env.BIRD_WEBHOOK_SECRET
  if (secret && req.header('x-webhook-secret') !== secret) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  console.log('[bird webhook] inbound', JSON.stringify(req.body))

  const { from, text, channelId, to } = extractInbound(req.body)

  if (!from || !text) {
    return res.status(200).json({ ok: true, matched: false, reason: 'no sender/text' })
  }

  // Descobrir a empresa dona do canal que recebeu a mensagem.
  const company = channelId
    ? await prisma.company.findFirst({ where: { birdChannelId: channelId } })
    : to
      ? await prisma.company.findFirst({ where: { whatsappNumber: normalizePhone(to) } })
      : null

  if (!company) {
    return res.status(200).json({ ok: true, matched: false, reason: 'company not found' })
  }

  if (!isOptIn(text)) {
    return res.status(200).json({ ok: true, matched: false, reason: 'not an opt-in keyword' })
  }

  const phone = normalizePhone(from)
  await prisma.contact.upsert({
    where: { companyId_phone: { companyId: company.id, phone } },
    update: { active: true, consentAt: new Date() },
    create: { companyId: company.id, phone, consentAt: new Date() },
  })

  return res.status(200).json({ ok: true, matched: true, companyId: company.id, phone })
})

export default router
