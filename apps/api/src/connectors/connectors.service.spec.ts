import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { ConnectorsService } from './connectors.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'
import { TokenCrypto } from './token-crypto'

const currentCallbackUrl = 'https://current.example.test/callback/notion'
const originalCallbackUrl = 'https://previous.example.test/callback/notion'

function createService() {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-sixteen-characters'
  process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.CONNECTOR_CALLBACK_URL = currentCallbackUrl
  const prisma = {
    connector: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    oAuthState: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  } as unknown as PrismaService
  const registrations = { getOrCreate: vi.fn(), byId: vi.fn() } as unknown as OAuthClientRegistrationService
  return { prisma, registrations, service: new ConnectorsService(prisma, registrations) }
}

function stubOAuthDiscovery() {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_servers: ['https://auth.example.test'] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_endpoint: 'https://auth.example.test/authorize', token_endpoint: 'https://auth.example.test/token', registration_endpoint: 'https://auth.example.test/register' }))))
}

function tokenRequest(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.find(([url]) => url === 'https://auth.example.test/token')![1].body as URLSearchParams
}

afterEach(() => vi.unstubAllGlobals())

describe('ConnectorsService', () => {
  it('binds a new authorization state to the registered OAuth client', async () => {
    const { prisma, registrations, service } = createService()
    stubOAuthDiscovery()
    vi.mocked(registrations.getOrCreate).mockResolvedValue({ id: 'registration-1', clientId: 'registered-client', callbackUrl: currentCallbackUrl })

    const result = await service.startAuthorization('user-1', 'notion')

    expect(prisma.oAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ registrationId: 'registration-1' }),
    })
    expect(new URL(result.url).searchParams.get('client_id')).toBe('registered-client')
  })

  it('rejects an OAuth callback whose state has no client registration', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({ state: 'old-state', providerId: 'notion', registrationId: null } as never)

    await expect(service.finishAuthorization('notion', 'old-state', 'code')).rejects.toThrow('OAuth state has no client registration')
  })

  it('exchanges an authorization code with its state-selected registration credentials and callback URL', async () => {
    const { prisma, registrations, service } = createService()
    const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({ state: 'state-1', userId: 'user-1', providerId: 'notion', registrationId: 'registration-1', pkceVerifierEncrypted: crypto.encrypt('verifier') } as never)
    vi.mocked(prisma.oAuthState.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(registrations.byId).mockResolvedValue({ id: 'registration-1', clientId: 'original-client', clientSecret: 'original-secret', callbackUrl: originalCallbackUrl })
    vi.mocked(prisma.connector.upsert).mockResolvedValue({} as never)
    stubOAuthDiscovery()
    const fetch = vi.mocked(globalThis.fetch)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-token' })))

    await service.finishAuthorization('notion', 'state-1', 'authorization-code')

    const body = tokenRequest(fetch)
    expect(body.get('client_id')).toBe('original-client')
    expect(body.get('client_secret')).toBe('original-secret')
    expect(body.get('redirect_uri')).toBe(originalCallbackUrl)
  })

  it('refreshes with the registration selected for the current callback URL', async () => {
    const { prisma, registrations, service } = createService()
    const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
    vi.mocked(prisma.connector.findUnique).mockResolvedValue({ id: 'connector-1', providerId: 'notion', status: 'active', accessTokenEncrypted: crypto.encrypt('old-access-token'), refreshTokenEncrypted: crypto.encrypt('refresh-token'), expiresAt: new Date(0) } as never)
    vi.mocked(registrations.getOrCreate).mockResolvedValue({ id: 'registration-current', clientId: 'current-client', callbackUrl: currentCallbackUrl })
    vi.mocked(prisma.connector.update).mockResolvedValue({} as never)
    stubOAuthDiscovery()
    const fetch = vi.mocked(globalThis.fetch)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh-access-token' })))

    await expect(service.accessToken('user-1', 'notion')).resolves.toBe('fresh-access-token')

    expect(registrations.getOrCreate).toHaveBeenCalledWith('notion', currentCallbackUrl, expect.objectContaining({ token_endpoint: 'https://auth.example.test/token' }))
    const body = tokenRequest(fetch)
    expect(body.get('client_id')).toBe('current-client')
    expect(body.get('client_secret')).toBeNull()
  })
})
