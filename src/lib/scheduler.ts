// Scheduler mínimo de campanhas agendadas. Sem dependências externas: um
// setInterval de 60s procura campanhas `scheduled` cujo `scheduledAt` já passou e
// chama a mesma lógica de envio de POST /campaigns/:id/send (executeCampaignSend).
import { prisma } from '../utils/prisma'
import { executeCampaignSend } from '../routes/campaigns'

const INTERVAL_MS = 60_000

let running = false

async function tick() {
  if (running) return // evita sobreposição se um tick demorar mais de 60s
  running = true
  try {
    const due = await prisma.campaign.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
      select: { id: true, name: true },
    })

    for (const campaign of due) {
      // Claim atómico: só um processo consegue passar de `scheduled` -> `sending`.
      const claim = await prisma.campaign.updateMany({
        where: { id: campaign.id, status: 'scheduled' },
        data: { status: 'sending' },
      })
      if (claim.count === 0) continue // outra instância já pegou nesta

      try {
        const result = await executeCampaignSend(campaign.id)
        if (result.skippedReason || result.sent === 0) {
          await prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: 'cancelled' },
          })
          console.error(
            `[scheduler] campanha "${campaign.name}" (${campaign.id}) cancelada:`,
            result.skippedReason ?? 'nenhuma mensagem aceite pelo Bird'
          )
        } else {
          console.log(
            `[scheduler] campanha "${campaign.name}" (${campaign.id}) enviada:`,
            result
          )
        }
      } catch (err) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'cancelled' },
        })
        console.error(`[scheduler] erro ao enviar campanha ${campaign.id}`, err)
      }
    }
  } catch (err) {
    console.error('[scheduler] erro no tick', err)
  } finally {
    running = false
  }
}

export function startScheduler() {
  setInterval(tick, INTERVAL_MS)
  console.log(`[scheduler] ativo (${INTERVAL_MS / 1000}s)`)
}
