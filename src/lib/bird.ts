// Cliente mínimo da Channels API do Bird.com para enviar mensagens de WhatsApp.
// NOTA: o path/body/header de auth abaixo seguem a documentação da Channels API nova
// (api.bird.com + workspace). Confirmar com a doc e afinar com a 1ª resposta real
// registada nos logs.

import { PUBLIC_URL } from './r2'

const BASE = process.env.BIRD_API_BASE ?? 'https://api.bird.com'

// Colapsa uma base duplicada: "https://a/https://b/key" -> "https://b/key".
function collapseDoubledBase(s: string): string {
  const m = s.match(/^https?:\/\/[^\s]+?\/(https?:\/\/.+)$/i)
  return m ? m[1] : s
}

// Botões de URL no Bird têm o prefixo do link fixo e só recebem o sufixo pela
// variável — mandamos só a parte a seguir à base pública.
function stripPublicBase(value: string): string {
  let s = collapseDoubledBase(value.trim())
  if (PUBLIC_URL && s.startsWith(PUBLIC_URL + '/')) return s.slice(PUBLIC_URL.length + 1)
  return s.replace(/^https?:\/\/pub-[a-z0-9]+\.r2\.dev\//i, '')
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i

// A media do cabeçalho quer o URL completo; os botões de URL querem só o sufixo.
function paramValue(value: string): string {
  const s = collapseDoubledBase(value.trim())
  if (IMAGE_EXT.test(s)) {
    // Normaliza o domínio de dev antigo para a base pública atual.
    return PUBLIC_URL ? s.replace(/^https?:\/\/pub-[a-z0-9]+\.r2\.dev/i, PUBLIC_URL) : s
  }
  return stripPublicBase(s)
}

interface SendResult {
  ok: boolean
  status?: number
  id?: string
  error?: string
}

async function post(channelId: string, payload: unknown): Promise<SendResult> {
  const workspaceId = process.env.BIRD_WORKSPACE_ID
  const apiKey = process.env.BIRD_API_KEY

  if (!workspaceId || !apiKey) {
    console.error('[bird] BIRD_WORKSPACE_ID / BIRD_API_KEY em falta — envio ignorado')
    return { ok: false, error: 'missing credentials' }
  }
  if (!channelId) {
    console.error('[bird] channelId em falta — envio ignorado')
    return { ok: false, error: 'missing channelId' }
  }

  const url = `${BASE}/workspaces/${workspaceId}/channels/${channelId}/messages`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `AccessKey ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const raw = await res.text()
    if (!res.ok) {
      console.error(`[bird] envio falhou ${res.status}: ${raw}`)
      return { ok: false, status: res.status, error: raw }
    }

    let id: string | undefined
    try {
      id = JSON.parse(raw)?.id
    } catch {
      /* corpo não-JSON */
    }
    return { ok: true, status: res.status, id }
  } catch (err) {
    console.error('[bird] erro de rede no envio', err)
    return { ok: false, error: (err as Error).message }
  }
}

export async function sendWhatsAppText(
  channelId: string,
  toPhone: string,
  text: string
): Promise<SendResult> {
  return post(channelId, {
    receiver: { contacts: [{ identifierValue: toPhone }] },
    body: { type: 'text', text: { text } },
  })
}

// Envia um template de mensagem já publicado no Bird Studio (Project + versão).
// As variáveis são nomeadas (ex.: "numero_whatsapp"), não posicionais. Na Channels
// API todos os parâmetros são { type: 'string', key, value } — inclusive URLs de
// imagem/PDF: o Bird resolve a media do cabeçalho pela definição do template.
export async function sendWhatsAppTemplate(
  channelId: string,
  toPhone: string,
  opts: {
    projectId: string
    version?: string
    locale?: string
    variables?: Record<string, string>
  }
): Promise<SendResult> {
  const parameters = Object.entries(opts.variables ?? {})
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => ({ type: 'string', key, value: paramValue(value) }))
  return post(channelId, {
    receiver: { contacts: [{ identifierValue: toPhone }] },
    template: {
      projectId: opts.projectId,
      ...(opts.version ? { version: opts.version } : {}),
      locale: opts.locale ?? 'pt_BR',
      parameters,
    },
  })
}
