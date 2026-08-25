import { describe, it, expect, afterEach } from 'vitest'
import { RefreshTokenService } from './refresh-token.service'

/**
 * Integration test at the Redis boundary: refresh tokens are issued, rotated
 * (old dies, new lives), and revoked. Skipped when no REDIS_URL is configured.
 */
const describeRedis = process.env.REDIS_URL ? describe : describe.skip

describeRedis('RefreshTokenService (integration — real Redis)', () => {
  let svc: RefreshTokenService

  afterEach(async () => {
    await svc?.onModuleDestroy()
  })

  it('issues a token that rotates to the same user', async () => {
    svc = new RefreshTokenService()
    const userId = `u-${Date.now()}`
    const token = await svc.issue(userId)
    expect(token).toBeTruthy()

    const rotated = await svc.rotate(token)
    expect(rotated).not.toBeNull()
    expect(rotated!.userId).toBe(userId)
    expect(rotated!.token).not.toBe(token) // rotation mints a fresh token
  })

  it('invalidates the old token after rotation (single-use)', async () => {
    svc = new RefreshTokenService()
    const token = await svc.issue(`u-${Date.now()}`)
    const rotated = await svc.rotate(token)
    expect(rotated).not.toBeNull()

    // the consumed token must no longer be accepted
    expect(await svc.rotate(token)).toBeNull()
    // the freshly minted one still works
    expect(await svc.rotate(rotated!.token)).not.toBeNull()
  })

  it('returns null for an unknown token', async () => {
    svc = new RefreshTokenService()
    expect(await svc.rotate('nope-not-a-real-token')).toBeNull()
  })

  it('revokes a token so it can no longer rotate', async () => {
    svc = new RefreshTokenService()
    const token = await svc.issue(`u-${Date.now()}`)
    await svc.revoke(token)
    expect(await svc.rotate(token)).toBeNull()
  })
})
