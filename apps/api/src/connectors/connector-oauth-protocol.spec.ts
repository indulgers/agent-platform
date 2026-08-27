import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../prisma/prisma.service'
import type { OAuthClientRegistrationService } from './oauth-client-registration.service'
import { ConnectorOAuthProtocol } from './connector-oauth-protocol'
import { TokenCrypto } from './token-crypto'

afterEach(() => vi.unstubAllGlobals())

function harness() {
  const key = Buffer.alloc(32, 9).toString('base64')
  const crypto = new TokenCrypto(key)
  const prisma = {
    oAuthState: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  } as unknown as PrismaService
  const registrations = {
    getOrCreate: vi.fn().mockResolvedValue({
      id: 'registration-1',
      clientId: 'client-1',
      callbackUrl: 'https://app.example/callback/notion',
    }),
    byId: vi.fn(),
  } as unknown as OAuthClientRegistrationService
  return { prisma, registrations, crypto, protocol: new ConnectorOAuthProtocol(prisma, registrations, crypto) }
}

function discovery() {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_servers: ['https://auth.example'] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      issuer: 'https://auth.example',
      authorization_endpoint: 'https://auth.example/authorize',
      token_endpoint: 'https://auth.example/token',
      registration_endpoint: 'https://auth.example/register',
    }))))
}

describe('ConnectorOAuthProtocol', () => {
  it('creates a PKCE authorization bound to the user, provider and registration', async () => {
    const { prisma, protocol } = harness()
    discovery()

    const result = await protocol.begin({
      userId: 'user-1',
      providerId: 'notion',
      serverUrl: 'https://mcp.notion.com/mcp',
      callbackUrl: 'https://app.example/callback/notion',
    })

    const url = new URL(result.url)
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(prisma.oAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        providerId: 'notion',
        registrationId: 'registration-1',
      }),
    })
  })

  it('rejects a callback when state is bound to another provider', async () => {
    const { prisma, protocol } = harness()
    vi.mocked(prisma.oAuthState.findUnique).mockResolvedValue({
      state: 'state-1',
      providerId: 'other',
    } as never)

    await expect(protocol.complete({ providerId: 'notion', state: 'state-1', code: 'code' }))
      .rejects.toMatchObject({ status: 401 })
    expect(prisma.oAuthState.updateMany).not.toHaveBeenCalled()
  })
})
