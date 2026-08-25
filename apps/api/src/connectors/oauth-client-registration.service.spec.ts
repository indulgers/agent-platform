import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'
import type { OAuthMetadata } from './oauth-metadata'
import { TokenCrypto } from './token-crypto'

const callbackUrl = 'http://localhost:3000/api/connectors/callback/notion'
const metadata: OAuthMetadata = {
  issuer: 'https://mcp.notion.com',
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
      id: 'registration-1', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'registered-client', clientSecretEncrypted: crypto.encrypt('registered-secret'), createdAt: new Date(), updatedAt: new Date(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client', client_secret: 'registered-secret' }), { status: 201 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).resolves.toEqual({ id: 'registration-1', clientId: 'registered-client', clientSecret: 'registered-secret', callbackUrl, issuer: metadata.issuer })
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
      id: 'registration-1', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
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
      id: 'registration-1', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client', client_secret: '' }), { status: 201 })))

    await service.getOrCreate('notion', callbackUrl, metadata)

    expect(vi.mocked(prisma.oAuthClientRegistration.create).mock.calls[0]![0].data.clientSecretEncrypted).toBeNull()
  })

  it('reuses a durable registration without calling the registration endpoint', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
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
      .mockResolvedValueOnce({ id: 'registration-2', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'winner-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date() })
    vi.mocked(prisma.oAuthClientRegistration.create).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate registration', { code: 'P2002', clientVersion: 'test' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client' }), { status: 201 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).resolves.toEqual({ id: 'registration-2', clientId: 'winner-client', clientSecret: undefined, callbackUrl, issuer: metadata.issuer })
  })

  it('loads a registration by its durable identity', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue({
      id: 'registration-1', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'registered-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date(),
    })

    await expect(service.byId('registration-1')).resolves.toEqual({ id: 'registration-1', clientId: 'registered-client', clientSecret: undefined, callbackUrl, issuer: metadata.issuer })
    expect(prisma.oAuthClientRegistration.findUnique).toHaveBeenCalledWith({ where: { id: 'registration-1' } })
  })

  it('creates a distinct registration when the authorization-server issuer changes', async () => {
    const { prisma, service } = createService()
    const newIssuerMetadata = { ...metadata, issuer: 'https://other-auth.example.test', registration_endpoint: 'https://other-auth.example.test/register' }
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.oAuthClientRegistration.create)
      .mockResolvedValueOnce({ id: 'registration-1', providerId: 'notion', callbackUrl, issuer: metadata.issuer, clientId: 'first-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date() } as never)
      .mockResolvedValueOnce({ id: 'registration-2', providerId: 'notion', callbackUrl, issuer: newIssuerMetadata.issuer, clientId: 'second-client', clientSecretEncrypted: null, createdAt: new Date(), updatedAt: new Date() } as never)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'first-client' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'second-client' }), { status: 201 })))

    await service.getOrCreate('notion', callbackUrl, metadata)
    await service.getOrCreate('notion', callbackUrl, newIssuerMetadata)

    expect(prisma.oAuthClientRegistration.findUnique).toHaveBeenNthCalledWith(1, { where: { providerId_callbackUrl_issuer: { providerId: 'notion', callbackUrl, issuer: metadata.issuer } } })
    expect(prisma.oAuthClientRegistration.findUnique).toHaveBeenNthCalledWith(2, { where: { providerId_callbackUrl_issuer: { providerId: 'notion', callbackUrl, issuer: newIssuerMetadata.issuer } } })
  })

  it('propagates a non-unique Prisma error instead of looking up a winner', async () => {
    const { prisma, service } = createService()
    const error = new Prisma.PrismaClientKnownRequestError('foreign-key failure', { code: 'P2003', clientVersion: 'test' })
    vi.mocked(prisma.oAuthClientRegistration.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.oAuthClientRegistration.create).mockRejectedValue(error)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_id: 'registered-client' }), { status: 201 })))

    await expect(service.getOrCreate('notion', callbackUrl, metadata)).rejects.toBe(error)
    expect(prisma.oAuthClientRegistration.findUnique).toHaveBeenCalledTimes(1)
  })
})
