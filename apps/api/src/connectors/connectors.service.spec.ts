import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { ConnectorsService } from './connectors.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'

function createService() {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-sixteen-characters'
  process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
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

afterEach(() => vi.unstubAllGlobals())

describe('ConnectorsService', () => {
  it('binds a new authorization state to the registered OAuth client', async () => {
    const { prisma, registrations, service } = createService()
    stubOAuthDiscovery()
    vi.mocked(registrations.getOrCreate).mockResolvedValue({ id: 'registration-1', clientId: 'registered-client' })

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
})
