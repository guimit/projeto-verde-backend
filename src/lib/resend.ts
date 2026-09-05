import { Resend } from 'resend'

async function send(to: string, subject: string, html: string) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL!, to, subject, html })

  // O SDK do Resend não rejeita a promise em erros da API (chave inválida,
  // domínio não verificado, etc.) — só devolve { error }. Sem isto, o envio
  // falha em silêncio e o endpoint continua a responder sucesso.
  if (error) throw new Error(`Resend: ${error.message}`)
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const expiryMin = process.env.PASSWORD_RESET_TOKEN_EXPIRY_MIN ?? '30'

  await send(
    to,
    'Recuperar palavra-passe — Pássaros Online',
    `
      <p>Recebemos um pedido para recuperar a palavra-passe da sua conta.</p>
      <p><a href="${resetUrl}">Clique aqui para definir uma nova palavra-passe</a></p>
      <p>O link expira em ${expiryMin} minutos.</p>
      <p>Se não fez este pedido, ignore este email.</p>
    `,
  )
}

export async function sendLoginOtpEmail(to: string, code: string) {
  const expiryMin = process.env.LOGIN_OTP_EXPIRY_MIN ?? '10'

  await send(
    to,
    'O seu código de verificação — Pássaros Online',
    `
      <p>Use o código abaixo para concluir o login na sua conta:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>O código expira em ${expiryMin} minutos.</p>
      <p>Se não foi você quem tentou entrar, ignore este email.</p>
    `,
  )
}
