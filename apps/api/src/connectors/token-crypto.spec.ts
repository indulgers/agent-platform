import { describe, expect, it } from 'vitest'
import { TokenCrypto } from './token-crypto'

describe('TokenCrypto', () => {
  it('keeps an encrypted token recoverable only with the same key', () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    const crypto = new TokenCrypto(key)

    const encrypted = crypto.encrypt('secret-access-token')

    expect(encrypted).not.toContain('secret-access-token')
    expect(crypto.decrypt(encrypted)).toBe('secret-access-token')
    expect(() => new TokenCrypto(Buffer.alloc(32, 8).toString('base64')).decrypt(encrypted)).toThrow()
  })
})
