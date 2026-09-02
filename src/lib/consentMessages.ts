// Textos (PT) do fluxo de double opt-in por WhatsApp.
// A versão é guardada em cada ConsentEvent para prova RGPD/LGPD.

export const CONSENT_PROMPT_VERSION = process.env.CONSENT_PROMPT_VERSION ?? '2026-09-v1'

export function consentPrompt(companyName: string) {
  return (
    `Olá! Para confirmar a inscrição nas comunicações de ${companyName} por WhatsApp, ` +
    `responda SIM. Para sair a qualquer momento, responda SAIR.`
  )
}

export function namePrompt(profileName?: string | null) {
  if (profileName && profileName.trim()) {
    return (
      `Podemos usar o nome "${profileName.trim()}"? Responda SIM para confirmar, ` +
      `ou escreva o nome que prefere.`
    )
  }
  return 'Como se chama? Escreva o seu nome.'
}

export function welcome(companyName: string, name?: string | null) {
  const hi = name && name.trim() ? ` ${name.trim()}` : ''
  return (
    `Inscrição concluída${hi ? `,${hi}` : ''}! ✅ Vai passar a receber as novidades de ` +
    `${companyName}. Responda SAIR para cancelar quando quiser.`
  )
}

export function optOutAck(companyName: string) {
  return (
    `Pedido registado. Não vai receber mais mensagens de ${companyName}. Obrigado.`
  )
}

// Resposta a quem já está inscrito e manda uma mensagem fora do fluxo de opt-in.
export function outOfScope(companyName: string, supportPhone?: string | null) {
  const base = `Este é apenas o nosso canal de notificações de ${companyName}.`
  return supportPhone && supportPhone.trim()
    ? `${base} Para falar com um de nossos atendentes, utilize o número ${supportPhone.trim()}.`
    : `${base} Para outros assuntos, contacte-nos pelos canais habituais.`
}

export function notUnderstood(companyName: string) {
  return (
    `Não percebi. Para confirmar a inscrição nas comunicações de ${companyName}, ` +
    `responda SIM. Para sair, responda SAIR.`
  )
}
