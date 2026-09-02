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

// Mensagem com um botão de link (cta_url) "Conversar" que abre `url` ao tocar.
// A Channels API rejeita `body.actions`; tentamos o formato `interactive` e, se
// também for recusado, mandamos texto simples com o link no fim (tocável no WhatsApp).
export async function sendWhatsAppCtaUrl(
  channelId: string,
  toPhone: string,
  text: string,
  buttonText: string,
  url: string
): Promise<SendResult> {
  const interactive = await post(channelId, {
    receiver: { contacts: [{ identifierValue: toPhone }] },
    body: {
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body_text: text,
        cta_url: { text: buttonText, url },
      },
    },
  })
  if (interactive.ok) return interactive

  console.warn('[bird] cta_url recusado — a enviar texto com o link no fim')
  return sendWhatsAppText(channelId, toPhone, `${text}\n\n👉 ${url}`)
}
