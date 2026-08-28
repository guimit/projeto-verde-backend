import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../utils/prisma'

const sign = (payload: object) =>
  jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '7d' })

export async function login(req: Request, res: Response) {
  const { email, password } = req.body
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  if (!user.active) return res.status(403).json({ error: 'Account disabled' })

  const token = sign({
    userId: user.id,
    role: user.role,
    companyId: user.companyId,
  })

  return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
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
