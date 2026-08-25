import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'

export const connectorEncryptionUnavailableMessage = 'Connector encryption is unavailable. An administrator must configure CONNECTOR_ENCRYPTION_KEY.'

/** AES-256-GCM envelope for credentials persisted in Connector records. */
export class TokenCrypto {
  private readonly key: Buffer

  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, 'base64')
    if (this.key.length !== 32 || this.key.toString('base64') !== encodedKey) throw new Error('CONNECTOR_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }

  encrypt(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
  }

  decrypt(envelope: string): string {
    const bytes = Buffer.from(envelope, 'base64url')
    if (bytes.length < 29) throw new Error('Invalid encrypted connector credential')
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
  }
}

export function createConnectorTokenCrypto(encodedKey: string | undefined): TokenCrypto {
  try {
    if (!encodedKey) throw new Error('CONNECTOR_ENCRYPTION_KEY is required for connectors')
    return new TokenCrypto(encodedKey)
  } catch {
    throw new ServiceUnavailableException(connectorEncryptionUnavailableMessage)
  }
}
