// A validação de env tem de ser o primeiro import: falha cedo e com mensagem
// clara se faltar algo, e garante que o .env está carregado antes de qualquer
// módulo que leia process.env no top-level.
import { env } from './config/env'

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import multer from 'multer'

import authRoutes from './routes/auth'
import companyRoutes from './routes/companies'
import contactRoutes from './routes/contacts'
import campaignRoutes from './routes/campaigns'
import templateRoutes from './routes/templates'
import uploadRoutes from './routes/uploads'
import creditRoutes from './routes/credits'
import adminRoutes from './routes/admin'
import webhookRoutes from './routes/webhooks'
import { globalLimiter } from './middleware/rateLimit'
import { startScheduler } from './lib/scheduler'

const app = express()

// Atrás do proxy do Railway: sem isto req.ip é o IP do proxy e o rate limit
// por IP trata todos os clientes como um só.
app.set('trust proxy', 1)

app.use(cors({ origin: env.FRONTEND_URL }))
app.use(
  express.json({
    limit: '200kb',
    // Guarda o corpo cru para validar a assinatura HMAC dos webhooks do Bird.
    verify: (req, _res, buf) => {
      ;(req as Request).rawBody = buf
    },
  })
)
app.use(globalLimiter)

app.use('/api/auth', authRoutes)
app.use('/api/companies', companyRoutes)
app.use('/api/contacts', contactRoutes)
app.use('/api/campaigns', campaignRoutes)
app.use('/api/templates', templateRoutes)
app.use('/api/uploads', uploadRoutes)
app.use('/api/credits', creditRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/webhooks', webhookRoutes)

app.get('/health', (_, res) => res.json({ ok: true }))

app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// Handler de erros único: nunca deixar o stack trace ou o erro do Prisma
// chegar ao cliente.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Ficheiro demasiado grande. Máximo: 10 MB'
        : `Upload inválido (${err.code})`
    return res.status(400).json({ error: msg })
  }
  const type = (err as { type?: string } | null)?.type
  if (type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' })
  if (type === 'entity.too.large') return res.status(413).json({ error: 'Pedido demasiado grande' })

  console.error('[http] erro não tratado', err)
  res.status(500).json({ error: 'Erro interno' })
})

app.listen(env.PORT, () => {
  console.log(`Backend running on :${env.PORT}`)
  startScheduler()
})
