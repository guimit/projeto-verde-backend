// Cliente S3 compatível para o Cloudflare R2. Guarda ficheiros (imagem/PDF) que
// são servidos publicamente via R2_PUBLIC_URL. O upload é sempre backend -> R2;
// as credenciais nunca chegam ao frontend.
import { randomUUID } from 'crypto'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY

export const BUCKET = process.env.R2_BUCKET_NAME ?? 'projeto-verde'
export const PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '')

// Configuração incompleta é um erro de arranque explícito (mesmo padrão do bird.ts,
// mas aqui o upload não tem fallback silencioso possível).
export function assertR2Configured() {
  const missing = [
    !ACCOUNT_ID && 'R2_ACCOUNT_ID',
    !ACCESS_KEY_ID && 'R2_ACCESS_KEY_ID',
    !SECRET_ACCESS_KEY && 'R2_SECRET_ACCESS_KEY',
    !PUBLIC_URL && 'R2_PUBLIC_URL',
  ].filter(Boolean)
  if (missing.length) {
    throw new Error(`[r2] variáveis de ambiente em falta: ${missing.join(', ')}`)
  }
}

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID ?? '',
    secretAccessKey: SECRET_ACCESS_KEY ?? '',
  },
})

// Isola os ficheiros por empresa; 'platform' para uploads do platform_admin
// (ex.: imagem de cabeçalho de um template do catálogo global).
export function buildKey(scope: string, filename: string): string {
  const ext = (filename.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${scope}/${randomUUID()}.${ext || 'bin'}`
}

export function publicUrlFor(key: string): string {
  return `${PUBLIC_URL}/${key}`
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
