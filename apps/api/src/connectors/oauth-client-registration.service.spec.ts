import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'
import type { OAuthMetadata } from './oauth-metadata'
import { TokenCrypto } from './token-crypto'

const callbackUrl = 'http://localhost:3000/api/connectors/callback/notion'
const metadata: OAuthMetadata = {
  authorization_endpoint: 'https://mcp.notion.com/authorize',
  token_endpoint: 'https://mcp.notion.com/token',
  registration_endpoint: 'https://mcp.notion.com/register',
}

function createService() {
  const prisma = {
    oAuthClientRegistration: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  } as unknown as PrismaService
  const crypto = new TokenCrypto(Buffer.alloc(32, 7).toString('base64'))
  return { prisma, crypto, service: new OAuthClientRegistrationService(prisma, crypto) }
}

afterEach(() => vi.unstubAllGlobals())

describe('OAuthClientRegistrationService', () => {
  it('stores the dynamic client identity and encrypted client secret', async () => {
    const { prisma, crypto, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.oAuthClientRegistration.create).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, clientId: 'registered-client', clientSecretEncrypted: crypto.encrypt('registered-secret'), createdAt: new Date(), updatedAt: new Date(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client', client_secret: 'registered-secret' }), { status: 201 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).resolves.toEqual({ id: 'registration-1', clientId: 'registered-client', clientSecret: 'registered-secret' })
    expect(prisma.oAuthClientRegistration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ providerId: 'notion', callbackUrl, clientId: 'registered-client' }),
    })
    const createData = vi.mocked(prisma.oAuthClientRegistration.create).mock.calls[0]![0].data
    expect(crypto.decrypt(createData.clientSecretEncrypted!)).toBe('registered-secret')
  })

  it('registers a public PKCE client when no durable registration exists', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.oAuthClientRegistration.create).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
    })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client' }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)

    await service.getOrCreate('notion', callbackUrl, metadata)

    expect(fetch).toHaveBeenCalledWith('https://mcp.notion.com/register', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      client_name: 'agent-platform', redirect_uris: [callbackUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    })
  })

  it('rejects a failed registration response', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('registration unavailable', { status: 503 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).rejects.toThrow('OAuth client registration failed (503): registration unavailable')
    expect(prisma.oAuthClientRegistration.create).not.toHaveBeenCalled()
  })

  it.each([{}, { client_id: '' }])('rejects a registration response without a usable client ID: %j', async responseBody => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 201 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).rejects.toThrow('OAuth client registration response did not include client_id')
    expect(prisma.oAuthClientRegistration.create).not.toHaveBeenCalled()
  })

  it('persists an empty dynamic client secret as null', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.oAuthClientRegistration.create).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client', client_secret: '' }), { status: 201 })))

    await service.getOrCreate('notion', callbackUrl, metadata)

    expect(vi.mocked(prisma.oAuthClientRegistration.create).mock.calls[0]![0].data.clientSecretEncrypted).toBeNull()
  })

  it('reuses a durable registration without calling the registration endpoint', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).resolves.toMatchObject({ id: 'registration-1', clientId: 'registered-client' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the registration created by a concurrent request', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'registration-2', providerId: 'notion', callbackUrl, clientId: 'winner-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date() })
    vi.mocked(prisma.oAuthClientRegistration.create).mockRejectedValue({ code: 'P2002' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client' }), { status: 201 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).resolves.toEqual({ id: 'registration-2', clientId: 'winner-client', clientSecret: undefined })
  })

  it('loads a registration by its durable identity', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
    })

    await expect(service.byId('registration-1')).resolves.toEqual({ id: 'registration-1', clientId: 'registered-client', clientSecret: undefined })
    expect(prisma.oAuthClientRegistration.findUnique).toHaveBeenCalledWith({ where: { id: 'registration-1' } })
  })
})
