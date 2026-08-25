import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import IORedis from 'ioredis'

/** Refresh tokens live 30 days; rotation renews the window (sliding expiry). */
const TTL_SECONDS = 60 * 60 * 24 * 30
const keyFor = (token: string) => `refresh:${token}`

/**
 * Server-side store for refresh tokens, backed by Redis. A token is an opaque
 * random string mapped to its owner's userId with a sliding TTL. Rotation is
 * single-use: consuming a token atomically deletes it and mints a fresh one, so
 * a stolen-and-replayed token fails. Revocation (logout) drops the token.
 */
@Injectable()
export class RefreshTokenService implements OnModuleDestroy {
  private readonly redis: IORedis

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
    this.redis = new IORedis(url, { maxRetriesPerRequest: null })
  }

  /** Mint a new refresh token for a user and persist it with a 30-day TTL. */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.redis.set(keyFor(token), userId, 'EX', TTL_SECONDS)
    return token
  }

  /**
   * Consume a refresh token and issue its successor. Atomically deletes the old
   * token (single-use) and, if it was valid, returns the owner plus a fresh
   * token; returns null for an unknown/expired/already-consumed token.
   */
  async rotate(oldToken: string): Promise<{ userId: string; token: string } | null> {
    const userId = await this.redis.getdel(keyFor(oldToken))
    if (!userId) return null
    const token = await this.issue(userId)
    return { userId, token }
  }

  /** Drop a refresh token (logout). No-op if it doesn't exist. */
  async revoke(token: string): Promise<void> {
    await this.redis.del(keyFor(token))
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit()
  }
}
