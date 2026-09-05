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

// ---- Métricas da plataforma (dashboard do platform_admin) --------------------

const METRICS_TZ = 'Europe/Lisbon'
const RANGES = ['today', 'yesterday', '7d', '15d', '30d'] as const
type MetricsRange = (typeof RANGES)[number]

// Mensagem "enviada" = já saiu para o destinatário (independentemente do estado
// de entrega posterior). A data considerada é sempre CampaignMessage.sentAt —
// o momento real do envio por destinatário, não a data da campanha.
const SENT_STATUSES = ['sent', 'delivered', 'read']
const DELIVERED_STATUSES = ['delivered', 'read']

// Data (YYYY-MM-DD) do instante `d` no fuso de Lisboa.
function lisbonYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: METRICS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

// Instante UTC correspondente à meia-noite (hora de Lisboa) do dia YYYY-MM-DD.
function lisbonMidnightUtc(ymd: string): Date {
  const naiveUtc = new Date(`${ymd}T00:00:00Z`).getTime()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: METRICS_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(naiveUtc))
  const map: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value)
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second)
  return new Date(naiveUtc - (asUtc - naiveUtc))
}

function resolveRange(range: MetricsRange): { from: Date; to: Date } {
  const now = new Date()
  const todayStart = lisbonMidnightUtc(lisbonYmd(now))
  switch (range) {
    case 'today':
      return { from: todayStart, to: now }
    case 'yesterday': {
      const dayBefore = new Date(todayStart.getTime() - 12 * 3600 * 1000)
      return { from: lisbonMidnightUtc(lisbonYmd(dayBefore)), to: todayStart }
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86400000), to: now }
    case '15d':
      return { from: new Date(now.getTime() - 15 * 86400000), to: now }
    case '30d':
      return { from: new Date(now.getTime() - 30 * 86400000), to: now }
  }
}

router.get('/metrics', authenticate, requirePlatformAdmin, async (req, res) => {
  const range = String(req.query.range ?? '7d') as MetricsRange
  if (!RANGES.includes(range)) {
    return res.status(400).json({ error: 'range inválido' })
  }
  const { from, to } = resolveRange(range)

  const [
    messagesSent,
    messagesDelivered,
    messagesRead,
    messagesFailed,
    campaignsCompleted,
    newCompanies,
    newContacts,
    sentRows,
    failedRows,
  ] = await Promise.all([
    prisma.campaignMessage.count({
      where: { status: { in: SENT_STATUSES }, sentAt: { gte: from, lte: to } },
    }),
    prisma.campaignMessage.count({
      where: { status: { in: DELIVERED_STATUSES }, sentAt: { gte: from, lte: to } },
    }),
    prisma.campaignMessage.count({
      where: { status: 'read', sentAt: { gte: from, lte: to } },
    }),
    prisma.campaignMessage.count({
      where: { status: 'failed', failedAt: { gte: from, lte: to } },
    }),
    prisma.campaign.count({
      where: { status: 'done', sentAt: { gte: from, lte: to } },
    }),
    prisma.company.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.contact.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.campaignMessage.findMany({
      where: { sentAt: { gte: from, lte: to } },
      select: {
        sentAt: true,
        status: true,
        campaignId: true,
        campaign: { select: { companyId: true, company: { select: { name: true } } } },
      },
    }),
    prisma.campaignMessage.findMany({
      where: { failedAt: { gte: from, lte: to } },
      select: {
        failedAt: true,
        campaignId: true,
        campaign: { select: { companyId: true, company: { select: { name: true } } } },
      },
    }),
  ])

  const deliveryRate = messagesSent > 0 ? messagesDelivered / messagesSent : 0

  // Série diária (mensagens por dia), com dias sem envios preenchidos a zero.
  // Intervalo meio-aberto [from, to): `to` pode cair exatamente à meia-noite
  // (ex.: "ontem"), pelo que o último dia é o de `to - 1ms`.
  const dayKeys: string[] = []
  const endMs = to.getTime()
  for (let t = from.getTime(); t < endMs; t += 86400000) {
    const key = lisbonYmd(new Date(t))
    if (!dayKeys.includes(key)) dayKeys.push(key)
  }
  const lastKey = lisbonYmd(new Date(endMs - 1))
  if (!dayKeys.includes(lastKey)) dayKeys.push(lastKey)

  const seriesMap = new Map(
    dayKeys.map((d) => [d, { date: d, sent: 0, failed: 0 }])
  )
  for (const row of sentRows) {
    if (!row.sentAt || !SENT_STATUSES.includes(row.status)) continue
    const bucket = seriesMap.get(lisbonYmd(row.sentAt))
    if (bucket) bucket.sent++
  }
  for (const row of failedRows) {
    if (!row.failedAt) continue
    const bucket = seriesMap.get(lisbonYmd(row.failedAt))
    if (bucket) bucket.failed++
  }
  const series = dayKeys.map((d) => seriesMap.get(d)!)

  // Ranking de empresas por mensagens enviadas no período.
  const byCompany = new Map<
    string,
    { companyId: string; name: string; sent: number; failed: number; campaigns: Set<string> }
  >()
  const bucketFor = (companyId: string, name: string) => {
    let entry = byCompany.get(companyId)
    if (!entry) {
      entry = { companyId, name, sent: 0, failed: 0, campaigns: new Set() }
      byCompany.set(companyId, entry)
    }
    return entry
  }
  for (const row of sentRows) {
    if (!SENT_STATUSES.includes(row.status)) continue
    const entry = bucketFor(row.campaign.companyId, row.campaign.company.name)
    entry.sent++
    entry.campaigns.add(row.campaignId)
  }
  for (const row of failedRows) {
    const entry = bucketFor(row.campaign.companyId, row.campaign.company.name)
    entry.failed++
    entry.campaigns.add(row.campaignId)
  }
  const topCompanies = [...byCompany.values()]
    .map((e) => ({
      companyId: e.companyId,
      name: e.name,
      sent: e.sent,
      failed: e.failed,
      campaigns: e.campaigns.size,
    }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10)

  res.json({
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    messagesSent,
    messagesDelivered,
    messagesRead,
    messagesFailed,
    deliveryRate,
    campaignsCompleted,
    newCompanies,
    newContacts,
    series,
    topCompanies,
  })
})

router.get('/users', authenticate, requirePlatformAdmin, async (req, res) => {
  const { companyId } = req.query
  const users = await prisma.user.findMany({
    where: companyId ? { companyId: String(companyId) } : undefined,
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(users)
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
