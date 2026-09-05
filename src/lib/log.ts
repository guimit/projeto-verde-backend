// Helpers para logs sem dados pessoais. Telefones e nomes de contactos são PII
// (RGPD/LGPD) e os logs do Railway ficam retidos — mascarar sempre.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '(vazio)'
  const s = String(phone)
  if (s.length <= 6) return '***'
  return `${s.slice(0, 4)}***${s.slice(-2)}`
}
