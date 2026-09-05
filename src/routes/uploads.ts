import { Router, Request } from 'express'
import multer from 'multer'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { authenticate, requireCompanyAdmin } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { idParams } from '../schemas/common'
import { prisma } from '../utils/prisma'
import { r2, BUCKET, assertR2Configured, buildKey, publicUrlFor, deleteFromR2 } from '../lib/r2'

const router = Router()

const MAX_IMAGE_BYTES = 1 * 1024 * 1024 // 1 MB
const MAX_PDF_BYTES = 10 * 1024 * 1024 // 10 MB

// Sem persistência em disco: o buffer vai direto para o R2.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
})

// O tipo real do ficheiro vem dos magic bytes. O `mimetype` do multipart e o
// nome original são declarados pelo cliente e não provam nada — um HTML com
// "Content-Type: image/png" ficaria num bucket público. Só PNG, JPEG e PDF;
// a extensão gravada deriva daqui, nunca do nome original.
interface Detected {
  ext: 'png' | 'jpg' | 'pdf'
  mime: 'image/png' | 'image/jpeg' | 'application/pdf'
  isImage: boolean
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function detectFileType(buf: Buffer): Detected | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ext: 'png', mime: 'image/png', isImage: true }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg', isImage: true }
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { ext: 'pdf', mime: 'application/pdf', isImage: false }
  }
  return null
}

// Tipos declarados aceites para cada tipo detectado (o browser pode mandar
// image/jpg ou image/pjpeg para JPEG).
const DECLARED_OK: Record<Detected['mime'], string[]> = {
  'image/png': ['image/png'],
  'image/jpeg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  'application/pdf': ['application/pdf'],
}

// Nome original só para mostrar no painel: sem caminhos, sem caracteres de
// controlo, tamanho limitado.
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return (cleaned || 'ficheiro').slice(0, 200)
}

// 'platform' = upload do platform_admin (não está a impersonar nem tem empresa).
function getScope(req: Request): string {
  return req.user!.impersonating ?? req.user!.companyId ?? 'platform'
}

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'Ficheiro em falta' })

  const detected = detectFileType(file.buffer)
  if (!detected) {
    return res.status(400).json({ error: 'Tipo de ficheiro não permitido. Aceites: PDF, PNG, JPG' })
  }
  if (!DECLARED_OK[detected.mime].includes(file.mimetype.toLowerCase())) {
    return res.status(400).json({ error: 'O tipo declarado do ficheiro não corresponde ao conteúdo' })
  }
  if (detected.isImage && file.size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ error: 'Imagem demasiado grande. Máximo: 1 MB' })
  }
  if (!detected.isImage && file.size > MAX_PDF_BYTES) {
    return res.status(400).json({ error: 'PDF demasiado grande. Máximo: 10 MB' })
  }

  try {
    assertR2Configured()
  } catch (err) {
    console.error((err as Error).message)
    return res.status(503).json({ error: 'Uploads indisponíveis: armazenamento não configurado' })
  }

  const scope = getScope(req)
  const key = buildKey(scope, detected.ext)

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: detected.mime,
        // PDF nunca abre inline a partir do domínio público (JS embebido em
        // PDF corre no viewer do browser).
        ...(detected.ext === 'pdf' ? { ContentDisposition: 'attachment' } : {}),
      })
    )
  } catch (err) {
    console.error('[uploads] falha ao enviar para o R2', err)
    return res.status(502).json({ error: 'Falha ao guardar o ficheiro' })
  }

  const record = await prisma.upload.create({
    data: {
      companyId: scope === 'platform' ? null : scope,
      filename: safeFilename(file.originalname),
      key,
      url: publicUrlFor(key),
      mimeType: detected.mime,
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

router.delete<{ id: string }>(
  '/:id',
  authenticate,
  requireCompanyAdmin,
  validate({ params: idParams }),
  async (req, res) => {
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
  }
)

export default router
