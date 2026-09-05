import crypto from 'crypto'
import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../utils/prisma'
import { verifyTurnstileToken } from '../lib/turnstile'
import { sendPasswordResetEmail, sendLoginOtpEmail } from '../lib/resend'
import { generateTotpSecret, generateTotpQrDataUrl, verifyTotpCode } from '../lib/totp'

// Sessão de 24h: o token vive em localStorage no frontend (roubável por XSS),
// por isso a janela é curta. A revogação é imediata de qualquer forma —
// authenticate() confirma `active` na BD em cada pedido.
const sign = (payload: object) => jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' })

const signTemp = (payload: object) => jwt.sign(payload, env.JWT_SECRET, { expiresIn: '10m' })

// Tentativas erradas de OTP por email antes de o código ser invalidado
// (6 dígitos + 10 min sem tecto = força bruta viável).
const MAX_OTP_ATTEMPTS = 5

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateOtpCode() {
  return String(crypto.randomInt(100_000, 1_000_000))
}

// Gera e persiste um novo código, tentando enviá-lo por email. O código fica
// válido mesmo que o envio falhe (Resend fora do ar, chave inválida, etc.) —
// assim uma falha de entrega não bloqueia o login: o utilizador pode pedir
// reenvio (ou tentar de novo) sem perder o tempToken já emitido.
async function issueLoginOtp(userId: string, email: string) {
  const code = generateOtpCode()
  const expiryMin = Number(process.env.LOGIN_OTP_EXPIRY_MIN ?? 10)

  await prisma.user.update({
    where: { id: userId },
    data: {
      loginOtpCode: hashToken(code),
      loginOtpExpires: new Date(Date.now() + expiryMin * 60_000),
      loginOtpAttempts: 0,
    },
  })

  try {
    await sendLoginOtpEmail(email, code)
    return { emailSent: true }
  } catch (err) {
    console.error('[auth] falha ao enviar código de login por email:', err)
    return { emailSent: false }
  }
}

export async function login(req: Request, res: Response) {
  const { email, password, turnstileToken } = req.body

  if (!(await verifyTurnstileToken(turnstileToken))) {
    return res.status(400).json({ error: 'Verificação anti-bot falhou' })
  }

  const user = await prisma.user.findUnique({ where: { email } })

  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  if (!user.active) return res.status(403).json({ error: 'Account disabled' })

  // Primeiro login: ainda não há app autenticadora configurada — força o
  // setup do TOTP (o próprio setup, provado por um código válido gerado
  // pela app, já confirma a identidade; não depende do email).
  if (!user.twoFactorSecret) {
    const tempToken = signTemp({ userId: user.id, pendingSetup: true })
    return res.json({ requiresTotpSetup: true, tempToken })
  }

  const { emailSent } = await issueLoginOtp(user.id, user.email)
  const tempToken = signTemp({ userId: user.id, pending2FA: true })
  return res.json({ requires2FA: true, tempToken, emailSent })
}

export async function setup2FA(req: Request, res: Response) {
  const { tempToken } = req.body

  let payload: any
  try {
    payload = jwt.verify(tempToken, env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
  if (!payload.pendingSetup) return res.status(401).json({ error: 'Token inválido' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user) return res.status(401).json({ error: 'Token inválido' })

  const secret = generateTotpSecret()
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret } })

  const qrCodeUrl = await generateTotpQrDataUrl(secret, user.email)
  return res.json({ secret, qrCodeUrl })
}

export async function confirmSetup2FA(req: Request, res: Response) {
  const { tempToken, code } = req.body

  let payload: any
  try {
    payload = jwt.verify(tempToken, env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
  if (!payload.pendingSetup) return res.status(401).json({ error: 'Token inválido' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user || !user.twoFactorSecret) return res.status(401).json({ error: 'Token inválido' })

  if (!(await verifyTotpCode(user.twoFactorSecret, code))) {
    return res.status(400).json({ error: 'Código inválido — tente novamente' })
  }

  const token = sign({ userId: user.id, role: user.role, companyId: user.companyId })
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId },
  })
}

export async function resendOtp(req: Request, res: Response) {
  const { tempToken } = req.body

  let payload: any
  try {
    payload = jwt.verify(tempToken, env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
  if (!payload.pending2FA) return res.status(401).json({ error: 'Token inválido' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user) return res.status(401).json({ error: 'Token inválido' })

  const { emailSent } = await issueLoginOtp(user.id, user.email)
  return res.json({ ok: true, emailSent })
}

export async function verify2FA(req: Request, res: Response) {
  const { tempToken, code } = req.body

  let payload: any
  try {
    payload = jwt.verify(tempToken, env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
  if (!payload.pending2FA) return res.status(401).json({ error: 'Token inválido' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user) return res.status(401).json({ error: 'Token inválido' })

  // Aceita o código de qualquer um dos dois fatores configurados — o
  // utilizador escolhe qual usar (email já enviado, ou app autenticadora).
  const emailValid =
    !!user.loginOtpCode &&
    !!user.loginOtpExpires &&
    user.loginOtpExpires > new Date() &&
    user.loginOtpCode === hashToken(code)
  const totpValid = !!user.twoFactorSecret && (await verifyTotpCode(user.twoFactorSecret, code))

  if (!emailValid && !totpValid) {
    // Conta a falha; ao atingir o limite o código por email deixa de valer e o
    // utilizador tem de pedir outro (resend-otp), que também é rate-limited.
    const attempts = user.loginOtpAttempts + 1
    const exhausted = attempts >= MAX_OTP_ATTEMPTS
    await prisma.user.update({
      where: { id: user.id },
      data: exhausted
        ? { loginOtpCode: null, loginOtpExpires: null, loginOtpAttempts: 0 }
        : { loginOtpAttempts: attempts },
    })
    return res.status(401).json({
      error: exhausted
        ? 'Demasiadas tentativas — peça um novo código'
        : 'Código inválido ou expirado',
    })
  }

  // Sucesso: o código por email é de uso único e o contador volta a zero.
  await prisma.user.update({
    where: { id: user.id },
    data: { loginOtpCode: null, loginOtpExpires: null, loginOtpAttempts: 0 },
  })

  const token = sign({ userId: user.id, role: user.role, companyId: user.companyId })
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId },
  })
}

export async function forgotPassword(req: Request, res: Response) {
  const { email, turnstileToken } = req.body

  if (!(await verifyTurnstileToken(turnstileToken))) {
    return res.status(400).json({ error: 'Verificação anti-bot falhou' })
  }

  const user = await prisma.user.findUnique({ where: { email } })

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex')
    const expiryMin = Number(process.env.PASSWORD_RESET_TOKEN_EXPIRY_MIN ?? 30)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashToken(rawToken),
        passwordResetExpires: new Date(Date.now() + expiryMin * 60_000),
      },
    })

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`
    await sendPasswordResetEmail(user.email, resetUrl)
  }

  return res.json({ ok: true })
}

export async function resetPassword(req: Request, res: Response) {
  const { token, newPassword, turnstileToken } = req.body

  if (!(await verifyTurnstileToken(turnstileToken))) {
    return res.status(400).json({ error: 'Verificação anti-bot falhou' })
  }

  const user = await prisma.user.findFirst({
    where: { passwordResetToken: hashToken(token), passwordResetExpires: { gt: new Date() } },
  })
  if (!user) return res.status(400).json({ error: 'Token inválido ou expirado' })

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(newPassword, 10),
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  })

  return res.json({ ok: true })
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, name: true, email: true, role: true, companyId: true },
  })
  return res.json(user)
}

export async function impersonate(req: Request<{ companyId: string }>, res: Response) {
  const { companyId } = req.params
  const company = await prisma.company.findUnique({ where: { id: companyId } })
  if (!company) return res.status(404).json({ error: 'Company not found' })

  await prisma.impersonationLog.create({
    data: { adminId: req.user!.userId, targetCompanyId: companyId },
  })

  const token = sign({
    userId: req.user!.userId,
    role: req.user!.role,
    companyId,
    impersonating: companyId,
  })

  return res.json({ token })
}

export async function endImpersonation(req: Request, res: Response) {
  if (!req.user?.impersonating) return res.status(400).json({ error: 'Not impersonating' })

  const log = await prisma.impersonationLog.findFirst({
    where: { adminId: req.user.userId, targetCompanyId: req.user.impersonating, endedAt: null },
    orderBy: { startedAt: 'desc' },
  })
  if (log) await prisma.impersonationLog.update({ where: { id: log.id }, data: { endedAt: new Date() } })

  const token = sign({ userId: req.user.userId, role: req.user.role })
  return res.json({ token })
}
