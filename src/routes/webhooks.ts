import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { sendWhatsAppText, sendWhatsAppTemplate } from '../lib/bird'

// Template publicado no Bird Studio para o aviso "fora do escopo" (com botão
// "Conversar" que abre wa.me/<numero_whatsapp>). Override por env se mudar.
const OUT_OF_SCOPE_TEMPLATE = {
  projectId:
    process.env.BIRD_OUT_OF_SCOPE_TEMPLATE_PROJECT_ID ??
    '63e6e41e-f0ff-4fa8-94ff-d45a500ee3be',
  version:
    process.env.BIRD_OUT_OF_SCOPE_TEMPLATE_VERSION ??
    '2e7168d2-a565-4662-a1be-1d7fc8504f81',
  locale: process.env.BIRD_OUT_OF_SCOPE_TEMPLATE_LOCALE ?? 'pt_BR',
}
import {
  CONSENT_PROMPT_VERSION,
  consentPrompt,
  namePrompt,
  welcome,
  optOutAck,
  notUnderstood,
  outOfScope,
} from '../lib/consentMessages'

const router = Router()

function keywords(envValue: string | undefined, fallback: string) {
  return (envValue ?? fallback)
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
}

// Qualquer mensagem de um número sem sessão já inicia o fluxo de opt-in, por isso
// não há mais lista de gatilhos de entrada — só de saída.
const OPTOUT_KEYWORDS = keywords(process.env.OPTOUT_KEYWORDS, 'sair,parar,stop,cancelar,unsubscribe')

// "sim" isolado (ou no início) — usado para confirmar consentimento / nome.
const YES_KEYWORDS = ['sim', 'yes', 'aceito', 'confirmo', 'ok']

function matches(text: string, list: string[]) {
  const t = text.trim().toLowerCase()
  return list.some((k) => t === k || t.startsWith(k + ' ') || t.startsWith(k + ','))
}

function normalizePhone(value: string) {
  const digits = String(value).replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

interface Inbound {
  from: string
  text: string
  channelId?: string
  to?: string
  profileName?: string
  inboundMessageId?: string
  providerTimestamp?: Date
  isInboundText: boolean
}

// O formato exacto do payload da Channels API pode variar; extraímos de forma defensiva.
function parseInboundMessage(body: any): Inbound {
  const msg = body?.message ?? body?.payload?.message ?? body?.payload ?? body ?? {}

  const from = String(
    msg?.sender?.contact?.identifierValue ??
      msg?.sender?.identifierValue ??
      msg?.from ??
      msg?.originator ??
      body?.from ??
      ''
  )

  const text = String(
    msg?.body?.text?.text ??
      msg?.body?.text ??
      msg?.text?.text ??
      msg?.text ??
      msg?.content?.text ??
      body?.text ??
      ''
  )

  const channelId = msg?.channelId ?? msg?.channel?.id ?? body?.channelId ?? undefined

  const to = String(
    msg?.receiver?.connector?.identifierValue ??
      msg?.receiver?.contacts?.[0]?.identifierValue ??
      msg?.to ??
      msg?.recipient ??
      body?.to ??
      ''
  )

  const profileName =
    msg?.sender?.contact?.displayName ??
    msg?.sender?.contact?.name ??
    msg?.sender?.displayName ??
    msg?.profile?.name ??
    undefined

  const inboundMessageId = msg?.id ?? msg?.messageId ?? body?.id ?? undefined

  const tsRaw = msg?.receivedAt ?? msg?.createdAt ?? body?.receivedAt ?? body?.createdAt
  const providerTimestamp = tsRaw ? new Date(tsRaw) : undefined

  // Só nos interessam mensagens de texto recebidas (não status/delivery/echo).
  const direction = msg?.direction ?? body?.direction
  const bodyType = msg?.body?.type ?? msg?.type
  const isInboundText =
    !!text &&
    (direction === undefined || String(direction).toLowerCase() === 'incoming') &&
    (bodyType === undefined || bodyType === 'text')

  return {
    from,
    text,
    channelId,
    to: to || undefined,
    profileName: profileName ? String(profileName) : undefined,
    inboundMessageId: inboundMessageId ? String(inboundMessageId) : undefined,
    providerTimestamp:
      providerTimestamp && !isNaN(providerTimestamp.getTime()) ? providerTimestamp : undefined,
    isInboundText,
  }
}

// Lê um evento de status de mensagem enviada dos vários formatos que o Bird usa.
// Devolve null se o payload não parecer um status update. `messageId` tem de
// corresponder ao `id` devolvido pela Channels API no envio (guardado em
// CampaignMessage.birdMessageId).
function extractStatusEvent(
  body: any
): { messageId?: string; status: 'delivered' | 'read' | 'failed'; failReason?: string } | null {
  const type: string = String(body?.type ?? '')

  // Estado: do campo explícito ou derivado do nome do evento (whatsapp.delivered…).
  const explicit: string =
    body?.payload?.message?.status?.current ??
    body?.data?.status ??
    body?.data?.message?.status ??
    body?.message?.status?.current ??
    ''
  const fromType = type.match(/\.(delivered|read|failed|rejected|undeliverable)$/i)?.[1]
  const raw = String(explicit || fromType || '').toLowerCase()

  let status: 'delivered' | 'read' | 'failed'
  if (raw === 'delivered') status = 'delivered'
  else if (raw === 'read') status = 'read'
  else if (raw === 'failed' || raw === 'rejected' || raw === 'undeliverable') status = 'failed'
  else return null

  const messageId: string | undefined =
    body?.payload?.message?.id ??
    body?.data?.id ??
    body?.data?.message?.id ??
    body?.data?.messageId ??
    body?.message?.id ??
    body?.id ??
    undefined

  const failReason: string | undefined =
    body?.payload?.message?.status?.errors?.[0]?.description ??
    body?.data?.error?.description ??
    body?.data?.error?.reason ??
    body?.data?.error?.message ??
    body?.error?.description ??
    undefined

  return { messageId: messageId ? String(messageId) : undefined, status, failReason }
}

async function resolveCompany(channelId?: string, to?: string) {
  if (channelId) {
    const c = await prisma.company.findFirst({ where: { birdChannelId: channelId } })
    if (c) return c
  }
  if (to) {
    return prisma.company.findFirst({ where: { whatsappNumber: normalizePhone(to) } })
  }
  return null
}

// POST /api/webhooks/bird — inbound de WhatsApp (via Bird.com). Sem JWT.
// O Bird não envia um header de segredo partilhado nos webhooks de canal — autentica
// as entregas por assinatura HMAC. Enquanto essa validação não estiver implementada
// (capturar o raw body em index.ts com express.json({ verify }) e validar o header
// X-Bird-Signature contra o signing key da subscrição), o endpoint aceita o pedido.
// Se BIRD_WEBHOOK_SECRET estiver definido e o header x-webhook-secret não bater certo,
// apenas registamos um aviso — nunca bloqueamos, para não perder inbounds.
router.post('/bird', async (req, res) => {
  const secret = process.env.BIRD_WEBHOOK_SECRET
  if (secret && req.header('x-webhook-secret') !== secret) {
    console.warn('[bird webhook] x-webhook-secret ausente ou não corresponde — a aceitar mesmo assim')
  }

  console.log('[bird webhook] inbound', JSON.stringify(req.body))

  // Handshake de verificação do Bird.
  const challenge = req.body?.challenge ?? req.query?.challenge
  if (challenge) return res.status(200).json({ challenge })
  if (req.body?.type === 'webhook.test') return res.status(200).json({ ok: true })

  // Status update de uma mensagem de campanha já enviada (delivered / read /
  // failed). Entra antes do fluxo de opt-in e responde já. O Bird tem mais do que
  // um formato de evento (channels "message.status.updated" com payload.message,
  // e events "whatsapp.delivered/read/failed" com data.*); apanhamos os campos de
  // forma tolerante. Ver o corpo real em '[bird webhook] inbound'.
  const statusEvent = extractStatusEvent(req.body)
  if (statusEvent) {
    const { messageId, status, failReason } = statusEvent
    let update: Record<string, unknown> = {}
    if (status === 'delivered') update = { status: 'delivered', deliveredAt: new Date() }
    else if (status === 'read') update = { status: 'read', readAt: new Date() }
    else if (status === 'failed')
      update = { status: 'failed', failedAt: new Date(), failReason: failReason ?? null }

    let matched = 0
    if (messageId && Object.keys(update).length) {
      // `read` não regride para `delivered`/`failed` se os eventos chegarem fora de ordem.
      const guard =
        update.status === 'delivered'
          ? { status: { notIn: ['read'] } }
          : update.status === 'failed'
          ? { status: { notIn: ['read', 'delivered'] } }
          : {}
      const r = await prisma.campaignMessage.updateMany({
        where: { birdMessageId: messageId, ...guard },
        data: update,
      })
      matched = r.count
    }
    console.log('[bird webhook] status', { messageId, status, matched })
    return res.status(200).json({ ok: true, action: 'status', status, matched })
  }

  const inbound = parseInboundMessage(req.body)

  if (!inbound.isInboundText || !inbound.from) {
    return res.status(200).json({ ok: true, action: 'ignored', reason: 'not an inbound text' })
  }

  const company = await resolveCompany(inbound.channelId, inbound.to)
  if (!company) {
    return res.status(200).json({ ok: true, action: 'ignored', reason: 'company not found' })
  }

  const phone = normalizePhone(inbound.from)
  const text = inbound.text.trim()

  try {
    const result = await runOptInFlow({ company, phone, text, inbound })
    console.log('[bird webhook] resultado', { company: company.name, phone, text, ...result })
    return res.status(200).json({ ok: true, ...result })
  } catch (err) {
    console.error('[bird webhook] erro no fluxo de opt-in', err)
    return res.status(200).json({ ok: true, action: 'error' })
  }
})

async function runOptInFlow({
  company,
  phone,
  text,
  inbound,
}: {
  company: { id: string; name: string; supportPhone?: string | null }
  phone: string
  text: string
  inbound: Inbound
}) {
  const session = await prisma.optInSession.findUnique({
    where: { companyId_phone: { companyId: company.id, phone } },
  })

  // Idempotência: mesma mensagem entregue duas vezes.
  if (
    session &&
    inbound.inboundMessageId &&
    session.lastInboundId === inbound.inboundMessageId
  ) {
    return { action: 'duplicate', state: session.state }
  }

  const isOptOut = matches(text, OPTOUT_KEYWORDS)
  const isYes = matches(text, YES_KEYWORDS)

  const send = (msg: string) => sendWhatsAppText(inbound.channelId ?? '', phone, msg)
  const touch = (data: any) =>
    prisma.optInSession.upsert({
      where: { companyId_phone: { companyId: company.id, phone } },
      update: { ...data, lastInboundId: inbound.inboundMessageId ?? undefined },
      create: {
        companyId: company.id,
        phone,
        channelId: inbound.channelId ?? null,
        profileName: inbound.profileName ?? null,
        lastInboundId: inbound.inboundMessageId ?? null,
        ...data,
      },
    })

  // --- Opt-out: em qualquer estado ---
  if (isOptOut) {
    const contact = await prisma.contact.findUnique({
      where: { companyId_phone: { companyId: company.id, phone } },
    })
    if (contact) {
      await prisma.contact.update({ where: { id: contact.id }, data: { active: false } })
    }
    await prisma.consentEvent.create({
      data: {
        companyId: company.id,
        contactId: contact?.id ?? null,
        phone,
        name: contact?.name ?? session?.chosenName ?? inbound.profileName ?? null,
        type: 'revoked',
        channel: 'whatsapp',
        replyText: text,
        inboundMessageId: inbound.inboundMessageId ?? null,
        providerTimestamp: inbound.providerTimestamp ?? null,
        rawPayload: sanitizeRaw(inbound),
      },
    })
    await touch({ state: 'opted_out' })
    await send(optOutAck(company.name))
    return { action: 'opted_out', state: 'opted_out' }
  }

  const state = session?.state

  // --- Sem sessão (ou já fez opt-out): qualquer mensagem recebe o convite a inscrever-se ---
  // (a repetição de mensagens neste ponto passa a cair no ramo awaiting_consent, que
  //  responde com notUnderstood — não precisamos de throttle aqui.)
  if (!session || state === 'opted_out') {
    await touch({
      state: 'awaiting_consent',
      channelId: inbound.channelId ?? null,
      profileName: inbound.profileName ?? null,
      lastPromptAt: new Date(),
    })
    await send(consentPrompt(company.name))
    return { action: 'consent_prompt_sent', state: 'awaiting_consent' }
  }

  // --- A aguardar consentimento ---
  if (state === 'awaiting_consent') {
    if (!isYes) {
      await touch({ lastPromptAt: new Date() })
      await send(notUnderstood(company.name))
      return { action: 'consent_reprompt', state: 'awaiting_consent' }
    }
    await touch({
      state: 'awaiting_name',
      profileName: inbound.profileName ?? session.profileName ?? null,
      lastPromptAt: new Date(),
      consentText: inbound.text,
      consentInboundId: inbound.inboundMessageId ?? null,
      consentAt: new Date(),
    })
    await send(namePrompt(inbound.profileName ?? session.profileName))
    return { action: 'name_prompt_sent', state: 'awaiting_name' }
  }

  // --- A aguardar nome ---
  if (state === 'awaiting_name') {
    const profileName = inbound.profileName ?? session.profileName ?? null
    const name = isYes ? profileName : text
    await finalizeConsent({ company, phone, name, session, inbound })
    await touch({ state: 'confirmed', chosenName: name ?? null })
    await send(welcome(company.name, name))
    return { action: 'confirmed', state: 'confirmed' }
  }

  // --- Já confirmado: mensagem fora do fluxo → lembrar que é canal de notificações ---
  await touch({})
  const supportDigits = (company.supportPhone ?? '').replace(/\D/g, '')
  const ch = inbound.channelId ?? ''

  // 1ª opção: template aprovado com o botão "Conversar".
  let sent = { ok: false } as { ok: boolean }
  if (supportDigits) {
    sent = await sendWhatsAppTemplate(ch, phone, {
      projectId: OUT_OF_SCOPE_TEMPLATE.projectId,
      version: OUT_OF_SCOPE_TEMPLATE.version,
      locale: OUT_OF_SCOPE_TEMPLATE.locale,
      variables: { numero_whatsapp: supportDigits },
    })
  }

  // Fallback: texto simples com o link wa.me no fim (tocável no WhatsApp).
  if (!sent.ok) {
    if (supportDigits) console.warn('[bird] template recusado — fallback para texto')
    const suffix = supportDigits ? `\n\n👉 https://wa.me/${supportDigits}` : ''
    await send(outOfScope(company.name, company.supportPhone) + suffix)
  }

  return { action: 'out_of_scope_notice', state: state ?? null }
}

async function finalizeConsent({
  company,
  phone,
  name,
  session,
  inbound,
}: {
  company: { id: string; name: string }
  phone: string
  name: string | null
  session: {
    consentText?: string | null
    consentInboundId?: string | null
    consentAt?: Date | null
  } | null
  inbound: Inbound
}) {
  // O consentimento efetivo é o "SIM" dado antes da escolha do nome.
  const consentAt = session?.consentAt ?? new Date()
  const consentReply = session?.consentText ?? inbound.text
  const consentInboundId = session?.consentInboundId ?? inbound.inboundMessageId ?? null

  const contact = await prisma.contact.upsert({
    where: { companyId_phone: { companyId: company.id, phone } },
    update: {
      active: true,
      name: name ?? undefined,
      consentAt,
      consentSource: 'whatsapp_double_optin',
    },
    create: {
      companyId: company.id,
      phone,
      name: name ?? undefined,
      consentAt,
      consentSource: 'whatsapp_double_optin',
    },
  })

  await prisma.consentEvent.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      phone,
      name: name ?? null,
      type: 'granted',
      channel: 'whatsapp',
      promptText: consentPrompt(company.name),
      promptVersion: CONSENT_PROMPT_VERSION,
      replyText: consentReply,
      inboundMessageId: consentInboundId,
      providerTimestamp: inbound.providerTimestamp ?? null,
      rawPayload: {
        ...sanitizeRaw(inbound),
        consentInboundId,
        consentAt: consentAt.toISOString(),
        nameReply: inbound.text,
      },
    },
  })

  return contact
}

// Guardamos um resumo estruturado do inbound (o payload cru completo também vai para os
// logs). Suficiente como prova: quem, quando, o quê, por que canal.
function sanitizeRaw(inbound: Inbound) {
  return {
    from: inbound.from,
    text: inbound.text,
    channelId: inbound.channelId ?? null,
    profileName: inbound.profileName ?? null,
    inboundMessageId: inbound.inboundMessageId ?? null,
    providerTimestamp: inbound.providerTimestamp?.toISOString() ?? null,
  }
}

export default router
