import crypto from 'crypto'
import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../utils/prisma'
import { verifyTurnstileToken } from '../lib/turnstile'
import { sendPasswordResetEmail } from '../lib/resend'
import { generateTotpSecret, generateTotpQrDataUrl, verifyTotpCode } from '../lib/totp'

const sign = (payload: object) =>
  jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '7d' })

const signTemp = (payload: object) =>
  jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '10m' })

function hashResetToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
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

  if (!user.twoFactorEnabled) {
    const tempToken = signTemp({ userId: user.id, pendingSetup: true })
    return res.json({ requires2FASetup: true, tempToken })
  }

  const tempToken = signTemp({ userId: user.id, pending2FA: true })
  return res.json({ requires2FA: true, tempToken })
}

export async function setup2FA(req: Request, res: Response) {
  const { tempToken } = req.body

  let payload: any
  try {
    payload = jwt.verify(tempToken, process.env.JWT_SECRET!)
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
    payload = jwt.verify(tempToken, process.env.JWT_SECRET!)
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
  if (!payload.pendingSetup) return res.status(401).json({ error: 'Token inválido' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user || !user.twoFactorSecret) return res.status(401).json({ error: 'Token inválido' })

  if (!(await verifyTotpCode(user.twoFactorSecret, code))) {
    return res.status(400).json({ error: 'Código inválido — tente novamente' })
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } })

  const token = sign({ userId: user.id, role: user.role, companyId: user.companyId })
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, twoFactorEnabled: true },
  })
}

export async function verify2FA(req: Request, res: Response) {
  const { tempToken, code } = req.body

  let payload: any
  try {
    payload = jwt.verify(tempToken, process.env.JWT_SECRET!)
  } catch {
    return res.status(401).json({ error: 'Token inválido' })
  }
  if (!payload.pending2FA) return res.status(401).json({ error: 'Token inválido' })

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user || !user.twoFactorSecret) return res.status(401).json({ error: 'Token inválido' })

  if (!(await verifyTotpCode(user.twoFactorSecret, code))) {
    return res.status(401).json({ error: 'Código inválido' })
  }

  const token = sign({ userId: user.id, role: user.role, companyId: user.companyId })
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, twoFactorEnabled: true },
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
        passwordResetToken: hashResetToken(rawToken),
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
    where: { passwordResetToken: hashResetToken(token), passwordResetExpires: { gt: new Date() } },
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
    select: { id: true, name: true, email: true, role: true, companyId: true, twoFactorEnabled: true },
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
