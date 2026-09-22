import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '../prisma/prisma.service'
import { loadEnv } from '../config/env'
import { ConnectorsService } from './connectors.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'
import { TokenCrypto } from './token-crypto'
import { ConnectorOAuthProtocol } from './connector-oauth-protocol'
import { notionProvider } from './providers/notion.provider'

const currentCallbackUrl = 'https://current.example.test/callback/notion'
const originalCallbackUrl = 'https://previous.example.test/callback/notion'

function createService(options: { connectorEncryptionKey?: string } = {}) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.REDIS_URL = 'redis://localhost:6379'
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-sixteen-characters'
  if ('connectorEncryptionKey' in options) {
    if (options.connectorEncryptionKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY
    else process.env.CONNECTOR_ENCRYPTION_KEY = options.connectorEncryptionKey
  } else process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.CONNECTOR_CALLBACK_URL = currentCallbackUrl
  const prisma = {
    connector: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    oAuthState: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  } as unknown as PrismaService
  const registrations = {
    getOrCreate: vi.fn(),
    issuerById: vi.fn().mockResolvedValue('https://auth.example.test'),
    byId: vi.fn(),
  }
  const oauth = new ConnectorOAuthProtocol(
    prisma,
    registrations as unknown as OAuthClientRegistrationService,
  )
  return { prisma, registrations, service: new ConnectorsService(prisma, oauth) }
}

function stubOAuthDiscovery() {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization_servers: ['https://auth.example.test'] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: 'https://auth.example.test',
            authorization_endpoint: 'https://auth.example.test/authorize',
            token_endpoint: 'https://auth.example.test/token',
            registration_endpoint: 'https://auth.example.test/register',
          }),
        ),
      ),
  )
}

function tokenRequest(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.find(([url]) => url === 'https://auth.example.test/token')![1]
    .body as URLSearchParams
}

afterEach(() => vi.unstubAllGlobals())

describe('ConnectorsService', () => {
  it('starts authorization with the dynamically registered client when no manual client ID is configured', async () => {
    delete process.env.NOTION_MCP_CLIENT_ID
    const { registrations, service } = createService()
    stubOAuthDiscovery()
    vi.mocked(registrations.getOrCreate).mockResolvedValue({
      id: 'registration-1',
      clientId: 'dynamically-registered-client',
      callbackUrl: currentCallbackUrl,
    })

    const result = await service.startAuthorization('user-1', 'notion')

    expect(new URL(result.url).searchParams.get('client_id')).toBe('dynamically-registered-client')
    expect(loadEnv()).not.toHaveProperty('NOTION_MCP_CLIENT_ID')
  })

  it('reports service unavailable before contacting OAuth when the connector encryption key is missing', async () => {
    const savedKey = process.env.CONNECTOR_ENCRYPTION_KEY
    const { registrations, service } = createService({ connectorEncryptionKey: undefined })

    await expect(service.startAuthorization('user-1', 'notion')).rejects.toMatchObject({
      status: 503,
      message:
        'Connector encryption is unavailable. An administrator must configure CONNECTOR_ENCRYPTION_KEY.',
    })
    expect(registrations.getOrCreate).not.toHaveBeenCalled()

    process.env.CONNECTOR_ENCRYPTION_KEY = savedKey
  })

  it('reports service unavailable before contacting OAuth when the connector encryption key is malformed', async () => {
    const { registrations, service } = createService({
      connectorEncryptionKey: `${Buffer.alloc(32, 7).toString('base64')}!not-base64!`,
    })

    await expect(service.startAuthorization('user-1', 'notion')).rejects.toMatchObject({
      status: 503,
      message:
        'Connector encryption is unavailable. An administrator must configure CONNECTOR_ENCRYPTION_KEY.',
    })
    expect(registrations.getOrCreate).not.toHaveBeenCalled()
  })

  it('binds a new authorization state to the registered OAuth client', async () => {
    const { prisma, registrations, service } = createService()
    stubOAuthDiscovery()
    vi.mocked(registrations.getOrCreate).mockResolvedValue({
      id: 'registration-1',
      clientId: 'registered-client',
      callbackUrl: currentCallbackUrl,
    })

    const result = await service.startAuthorization('user-1', 'notion')

    expect(prisma.oAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ registrationId: 'registration-1' }),
    })
    expect(new URL(result.url).searchParams.get('client_id')).toBe('registered-client')
  })

  it('rejects an OAuth callback whose state has no client registration', async () => {
    const { prisma, service } = createService()
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'old-state',
      providerId: 'notion',
      registrationId: null,
    } as never)

    await expect(service.finishAuthorization('notion', 'old-state', 'code')).rejects.toThrow(
      'OAuth state has no client registration',
    )
  })

  it('exchanges an authorization code with its state-selected registration credentials and callback URL', async () => {
    const { prisma, registrations, service } = createService()
    const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'state-1',
      userId: 'user-1',
      providerId: 'notion',
      registrationId: 'registration-1',
      pkceVerifierEncrypted: crypto.encrypt('verifier'),
    } as never)
    vi.mocked(prisma.oAuthState.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(registrations.byId).mockResolvedValue({
      id: 'registration-1',
      clientId: 'original-client',
      clientSecret: 'original-secret',
      callbackUrl: originalCallbackUrl,
      issuer: 'https://auth.example.test',
    })
    vi.mocked(prisma.connector.upsert).mockResolvedValue({} as never)
    stubOAuthDiscovery()
    const fetch = vi.mocked(globalThis.fetch)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-token' })))

    await service.finishAuthorization('notion', 'state-1', 'authorization-code')

    expect(prisma.connector.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ registrationId: 'registration-1' }),
        update: expect.objectContaining({ registrationId: 'registration-1' }),
      }),
    )
    const body = tokenRequest(fetch)
    expect(body.get('client_id')).toBe('original-client')
    expect(body.get('client_secret')).toBe('original-secret')
    expect(body.get('redirect_uri')).toBe(originalCallbackUrl)
  })

  it('refreshes with the original registration after callback configuration changes', async () => {
    const { prisma, registrations, service } = createService()
    const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
    vi.mocked(prisma.connector.findUnique).mockResolvedValue({
      id: 'connector-1',
      providerId: 'notion',
      status: 'active',
      registrationId: 'registration-original',
      accessTokenEncrypted: crypto.encrypt('old-access-token'),
      refreshTokenEncrypted: crypto.encrypt('refresh-token'),
      expiresAt: new Date(0),
    } as never)
    vi.mocked(registrations.byId).mockResolvedValue({
      id: 'registration-original',
      clientId: 'original-client',
      callbackUrl: originalCallbackUrl,
      issuer: 'https://auth.example.test',
    })
    vi.mocked(prisma.connector.update).mockResolvedValue({} as never)
    stubOAuthDiscovery()
    const fetch = vi.mocked(globalThis.fetch)
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'fresh-access-token' })),
    )

    await expect(service.accessToken('user-1', 'notion')).resolves.toBe('fresh-access-token')

    expect(registrations.byId).toHaveBeenCalledWith('registration-original')
    expect(registrations.getOrCreate).not.toHaveBeenCalled()
    const body = tokenRequest(fetch)
    expect(body.get('client_id')).toBe('original-client')
    expect(body.get('client_secret')).toBeNull()
  })

  it('requires reconnect before external calls when a legacy connector has no registration', async () => {
    const { prisma, registrations, service } = createService()
    const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
    vi.mocked(prisma.connector.findUnique).mockResolvedValue({
      id: 'connector-1',
      providerId: 'notion',
      status: 'active',
      registrationId: null,
      accessTokenEncrypted: crypto.encrypt('old-access-token'),
      refreshTokenEncrypted: crypto.encrypt('refresh-token'),
      expiresAt: new Date(0),
    } as never)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(service.accessToken('user-1', 'notion')).rejects.toThrow('reconnected')

    expect(registrations.byId).not.toHaveBeenCalled()
    expect(registrations.getOrCreate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'connector-1' },
      data: { status: 'revoked' },
    })
  })

  it('uses the provider display name when a connector must be reconnected', async () => {
    const originalDisplayName = notionProvider.displayName
    notionProvider.displayName = 'Workspace Docs'
    try {
      const { prisma, service } = createService()
      const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
      vi.mocked(prisma.connector.findUnique).mockResolvedValue({
        id: 'connector-1',
        providerId: 'notion',
        status: 'active',
        registrationId: 'registration-1',
        accessTokenEncrypted: crypto.encrypt('old-access-token'),
        refreshTokenEncrypted: null,
        expiresAt: new Date(0),
      } as never)

      await expect(service.accessToken('user-1', 'notion')).rejects.toThrow(
        'Workspace Docs needs to be reconnected',
      )
      expect(prisma.connector.update).toHaveBeenCalledWith({
        where: { id: 'connector-1' },
        data: { status: 'revoked' },
      })
    } finally {
      notionProvider.displayName = originalDisplayName
    }
  })

  it('marks a connector revoked when its stored OAuth issuer requires reconnection', async () => {
    const { prisma, registrations, service } = createService()
    const crypto = new TokenCrypto(process.env.CONNECTOR_ENCRYPTION_KEY!)
    vi.mocked(prisma.connector.findUnique).mockResolvedValue({
      id: 'connector-1',
      providerId: 'notion',
      status: 'active',
      registrationId: 'registration-1',
      accessTokenEncrypted: crypto.encrypt('old-access-token'),
      refreshTokenEncrypted: 'malformed-legacy-ciphertext',
      expiresAt: new Date(0),
    } as never)
    vi.mocked(registrations.issuerById).mockResolvedValue(undefined)
    vi.mocked(prisma.connector.update).mockResolvedValue({} as never)
    stubOAuthDiscovery()

    await expect(service.accessToken('user-1', 'notion')).rejects.toThrow(/reconnected/i)

    expect(registrations.byId).not.toHaveBeenCalled()
    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'connector-1' },
      data: { status: 'revoked' },
    })
  })
})
