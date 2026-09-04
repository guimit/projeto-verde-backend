import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

import authRoutes from './routes/auth'
import companyRoutes from './routes/companies'
import contactRoutes from './routes/contacts'
import campaignRoutes from './routes/campaigns'
import templateRoutes from './routes/templates'
import uploadRoutes from './routes/uploads'
import creditRoutes from './routes/credits'
import adminRoutes from './routes/admin'
import webhookRoutes from './routes/webhooks'
import { startScheduler } from './lib/scheduler'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({ origin: process.env.FRONTEND_URL }))
app.use(express.json())

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

app.listen(PORT, () => {
  console.log(`Backend running on :${PORT}`)
  startScheduler()
})
