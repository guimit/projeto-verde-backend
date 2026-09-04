import { generateSecret, generateURI, verify } from 'otplib'
import QRCode from 'qrcode'

const ISSUER = 'Pássaros Online'

export function generateTotpSecret(): string {
  return generateSecret()
}

export async function generateTotpQrDataUrl(secret: string, email: string): Promise<string> {
  const otpAuthUrl = generateURI({ issuer: ISSUER, label: email, secret })
  return QRCode.toDataURL(otpAuthUrl)
}

export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  const result = await verify({ secret, token, epochTolerance: 30 })
  return result.valid
}
