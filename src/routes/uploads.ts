import { Router } from 'express'
import multer from 'multer'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { authenticate } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { r2, BUCKET, assertR2Configured, buildKey, publicUrlFor, deleteFromR2 } from '../lib/r2'

const router = Router()

const IMAGE_TYPES = ['image/png', 'image/jpeg']
const PDF_TYPE = 'application/pdf'
const MAX_IMAGE_BYTES = 1 * 1024 * 1024 // 1 MB
const MAX_PDF_BYTES = 10 * 1024 * 1024 // 10 MB

// Sem persistência em disco: o buffer vai direto para o R2.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
})

// 'platform' = upload do platform_admin (não está a impersonar nem tem empresa).
function getScope(req: any): string {
  return req.user.impersonating ?? req.user.companyId ?? 'platform'
}

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'Ficheiro em falta' })

  const isImage = IMAGE_TYPES.includes(file.mimetype)
  const isPdf = file.mimetype === PDF_TYPE
  if (!isImage && !isPdf) {
    return res.status(400).json({ error: 'Tipo de ficheiro não permitido. Aceites: PDF, PNG, JPG' })
  }
  if (isImage && file.size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Imagem demasiado grande. Máximo: 1 MB' })
  }
  if (isPdf && file.size > MAX_PDF_BYTES) {
    return res.status(400).json({ error: 'PDF demasiado grande. Máximo: 10 MB' })
  }

  try {
    assertR2Configured()
  } catch (err) {
    console.error((err as Error).message)
    return res.status(503).json({ error: 'Uploads indisponíveis: armazenamento não configurado' })
  }

  const scope = getScope(req)
  const key = buildKey(scope, file.originalname)

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    )
  } catch (err) {
    console.error('[uploads] falha ao enviar para o R2', err)
    return res.status(502).json({ error: 'Falha ao guardar o ficheiro' })
  }

  const record = await prisma.upload.create({
    data: {
      companyId: scope === 'platform' ? null : scope,
      filename: file.originalname,
      key,
      url: publicUrlFor(key),
      mimeType: file.mimetype,
      size: file.size,
    },
  })

  res.status(201).json({
    id: record.id,
    filename: record.filename,
    url: record.url,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: record.createdAt,
  })
})

router.get('/', authenticate, async (req, res) => {
  const scope = getScope(req)
  const uploads = await prisma.upload.findMany({
    where: { companyId: scope === 'platform' ? null : scope },
    orderBy: { createdAt: 'desc' },
  })
  res.json({
    uploads: uploads.map((u) => ({
      id: u.id,
      filename: u.filename,
      url: u.url,
      mimeType: u.mimeType,
      size: u.size,
      createdAt: u.createdAt,
    })),
  })
})

router.delete<{ id: string }>('/:id', authenticate, async (req, res) => {
  const scope = getScope(req)
  const upload = await prisma.upload.findUnique({ where: { id: req.params.id } })
  if (!upload) return res.status(404).json({ error: 'Not found' })

  const owner = upload.companyId ?? 'platform'
  if (owner !== scope) return res.status(403).json({ error: 'Forbidden' })

  try {
    await deleteFromR2(upload.key)
  } catch (err) {
    console.error('[uploads] falha ao apagar do R2', err)
  }
  await prisma.upload.delete({ where: { id: upload.id } })
  res.status(204).end()
})

export default router
