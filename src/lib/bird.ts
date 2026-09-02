// Cliente mínimo da Channels API do Bird.com para enviar mensagens de WhatsApp.
// NOTA: o path/body/header de auth abaixo seguem a documentação da Channels API nova
// (api.bird.com + workspace). Confirmar com a doc e afinar com a 1ª resposta real
// registada nos logs.

const BASE = process.env.BIRD_API_BASE ?? 'https://api.bird.com'

interface SendResult {
  ok: boolean
  status?: number
  id?: string
  error?: string
}

// Faz o POST de uma mensagem já montada (campo `body` da Channels API).
async function postMessage(
  channelId: string,
  toPhone: string,
  body: unknown
): Promise<SendResult> {
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
  const payload = {
    receiver: { contacts: [{ identifierValue: toPhone }] },
    body,
  }

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
  return postMessage(channelId, toPhone, { type: 'text', text: { text } })
}

// Texto com um único botão de link (cta_url): abre `url` ao tocar.
// Se a API rejeitar o formato interativo, faz fallback para texto simples.
export async function sendWhatsAppCtaUrl(
  channelId: string,
  toPhone: string,
  text: string,
  buttonText: string,
  url: string
): Promise<SendResult> {
  const result = await postMessage(channelId, toPhone, {
    type: 'text',
    text: { text },
    actions: [{ type: 'link', link: { text: buttonText, url } }],
  })
  if (result.ok) return result

  console.warn('[bird] botão cta_url rejeitado — a enviar como texto simples')
  return sendWhatsAppText(channelId, toPhone, text)
}
