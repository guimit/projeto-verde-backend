import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../utils/prisma'

export interface AuthPayload {
  userId: string
  role: string
  companyId?: string
  impersonating?: string
  pendingSetup?: boolean
  pending2FA?: boolean
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
      // Empresa activa (impersonada ou a do utilizador). Definida por requireCompany.
      companyId?: string
      // Corpo cru do pedido, para validar assinaturas de webhooks (ver index.ts).
      rawBody?: Buffer
    }
  }
}

// Verifica o JWT e confirma na BD que o utilizador ainda existe e está activo.
// `role` e `companyId` vêm da BD (não do token) para que desactivar um
// utilizador ou mudar-lhe a função tenha efeito imediato. `impersonating` vem
// do token e só é aceite para platform_admin.
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Token required' })

  let payload: AuthPayload
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
  if (payload.pendingSetup || payload.pending2FA) {
    return res.status(401).json({ error: 'Token pendente de verificação 2FA' })
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, companyId: true, active: true },
  })
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Sessão inválida' })
  }

  req.user = {
    userId: user.id,
    role: user.role,
    companyId: user.companyId ?? undefined,
    impersonating: user.role === 'platform_admin' ? payload.impersonating : undefined,
  }
  next()
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  return requireRole('platform_admin')(req, res, next)
}

// Acções de envio e destrutivas dentro de uma empresa: dono (admin) ou equipa
// Verde. O `assistant` fica de fora (ver matriz de permissões no CLAUDE.md).
export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  return requireRole('platform_admin', 'admin')(req, res, next)
}

// Resolve a empresa activa e põe-na em req.companyId. Todas as rotas que lêem
// ou escrevem dados de empresa passam por aqui — é o único sítio onde a regra
// "impersonating ?? companyId" vive. Sem empresa (platform_admin fora de
// impersonação) -> 403, nunca uma query sem filtro.
export function requireCompany(req: Request, res: Response, next: NextFunction) {
  const companyId = req.user?.impersonating ?? req.user?.companyId
  if (!companyId) {
    return res.status(403).json({ error: 'Sem empresa associada a esta sessão' })
  }
  req.companyId = companyId
  next()
}
