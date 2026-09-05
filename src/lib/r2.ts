// Cliente S3 compatível para o Cloudflare R2. Guarda ficheiros (imagem/PDF) que
// são servidos publicamente via R2_PUBLIC_URL. O upload é sempre backend -> R2;
// as credenciais nunca chegam ao frontend.
import { randomUUID } from 'crypto'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY

export const BUCKET = process.env.R2_BUCKET_NAME ?? 'projeto-verde'

// Aceita só a base pública. Se a env vier com dois URLs colados
// ("https://a/https://b"), fica com o último; tira barras finais.
function normalizeBase(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '')
  const last = v.lastIndexOf('https://')
  return (last > 0 ? v.slice(last) : v).replace(/\/+$/, '')
}

export const PUBLIC_URL = normalizeBase(process.env.R2_PUBLIC_URL)

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
// (ex.: imagem de cabeçalho de um template do catálogo global). A extensão é
// a do tipo detectado pelos magic bytes (routes/uploads.ts) — nunca a do nome
// original, que é controlado pelo cliente.
export function buildKey(scope: string, ext: 'png' | 'jpg' | 'pdf'): string {
  return `${scope}/${randomUUID()}.${ext}`
}

export function publicUrlFor(key: string): string {
  // Se por engano vier um URL completo, devolve-o tal como está.
  if (/^https?:\/\//i.test(key)) return key
  return `${PUBLIC_URL}/${key.replace(/^\/+/, '')}`
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
