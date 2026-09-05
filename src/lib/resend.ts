import { Resend } from 'resend'

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const expiryMin = process.env.PASSWORD_RESET_TOKEN_EXPIRY_MIN ?? '30'

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Recuperar palavra-passe — Pássaros Online',
    html: `
      <p>Recebemos um pedido para recuperar a palavra-passe da sua conta.</p>
      <p><a href="${resetUrl}">Clique aqui para definir uma nova palavra-passe</a></p>
      <p>O link expira em ${expiryMin} minutos.</p>
      <p>Se não fez este pedido, ignore este email.</p>
    `,
  })

  // O SDK do Resend não rejeita a promise em erros da API (chave inválida,
  // domínio não verificado, etc.) — só devolve { error }. Sem isto, o envio
  // falha em silêncio e o forgot-password continua a responder ok:true.
  if (error) throw new Error(`Resend: ${error.message}`)
}
