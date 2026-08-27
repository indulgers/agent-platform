import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { loadEnv } from '../config/env'
import { ConnectorOAuthProtocol, type OAuthTokens } from './connector-oauth-protocol'
import { getRemoteMcpProvider, listRemoteMcpProviders } from './providers/registry'

/** Owns user Connector records and delegates all OAuth mechanics to the protocol. */
@Injectable()
export class ConnectorsService {
  private readonly env = loadEnv()
  private readonly refreshes = new Map<string, Promise<string>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: ConnectorOAuthProtocol,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.connector.findMany({ where: { userId } })
    return listRemoteMcpProviders().map(provider => {
      const row = rows.find(connector => connector.providerId === provider.id)
      return {
        providerId: provider.id,
        displayName: provider.displayName,
        status: row?.status ?? 'disconnected',
        expiresAt: row?.expiresAt ?? null,
        connectedAt: row?.createdAt ?? null,
      }
    })
  }

  async startAuthorization(userId: string, providerId: string) {
    this.oauth.ensureAvailable()
    const provider = this.provider(providerId)
    return this.oauth.begin({
      userId,
      providerId,
      serverUrl: provider.serverUrl,
      callbackUrl: this.callbackUrl(providerId),
    })
  }

  async finishAuthorization(providerId: string, state: string, code?: string, oauthError?: string) {
    const provider = this.provider(providerId)
    const grant = await this.oauth.complete({
      providerId,
      serverUrl: provider.serverUrl,
      state,
      code,
      oauthError,
      providerDisplayName: provider.displayName,
    })
    await this.prisma.connector.upsert({
      where: { userId_providerId: { userId: grant.userId, providerId } },
      create: {
        ...this.tokenData(grant.userId, providerId, grant.tokens),
        registrationId: grant.registrationId,
      },
      update: {
        ...this.tokenData(grant.userId, providerId, grant.tokens),
        registrationId: grant.registrationId,
      },
    })
  }

  async disconnect(userId: string, providerId: string) {
    this.provider(providerId)
    await this.prisma.connector.deleteMany({ where: { userId, providerId } })
  }

  async isActive(userId: string, providerId: string): Promise<boolean> {
    return !!(await this.prisma.connector.findFirst({
      where: { userId, providerId, status: 'active' },
      select: { id: true },
    }))
  }

  async accessToken(userId: string, providerId: string): Promise<string> {
    const connector = await this.prisma.connector.findUnique({
      where: { userId_providerId: { userId, providerId } },
    })
    if (!connector || connector.status !== 'active') {
      throw new NotFoundException(`${providerId} is not connected`)
    }
    if (!connector.expiresAt || connector.expiresAt.getTime() > Date.now() + 60_000) {
      return this.oauth.decrypt(connector.accessTokenEncrypted)
    }
    const pending = this.refreshes.get(connector.id)
    if (pending) return pending
    const refresh = this.refresh(connector).finally(() => this.refreshes.delete(connector.id))
    this.refreshes.set(connector.id, refresh)
    return refresh
  }

  private async refresh(connector: {
    id: string
    providerId: string
    refreshTokenEncrypted: string | null
    registrationId: string | null
  }) {
    if (!connector.refreshTokenEncrypted) {
      throw new UnauthorizedException('Notion needs to be reconnected')
    }
    if (!connector.registrationId) {
      throw new UnauthorizedException(
        'Notion needs to be reconnected because its OAuth client registration is unavailable',
      )
    }
    const provider = this.provider(connector.providerId)
    try {
      const tokens = await this.oauth.refresh({
        serverUrl: provider.serverUrl,
        registrationId: connector.registrationId,
        refreshToken: this.oauth.decrypt(connector.refreshTokenEncrypted),
      })
      const data = this.tokenData('', connector.providerId, tokens)
      await this.prisma.connector.update({
        where: { id: connector.id },
        data: { ...data, userId: undefined },
      })
      return tokens.access_token
    } catch (error) {
      if (error instanceof Error && error.message.includes('invalid_grant')) {
        await this.prisma.connector.update({
          where: { id: connector.id },
          data: { status: 'revoked' },
        })
      }
      throw error
    }
  }

  private tokenData(userId: string, providerId: string, tokens: OAuthTokens) {
    return {
      userId,
      providerId,
      status: 'active' as const,
      accessTokenEncrypted: this.oauth.encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? this.oauth.encrypt(tokens.refresh_token)
        : undefined,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    }
  }

  private provider(id: string) {
    const provider = getRemoteMcpProvider(id)
    if (!provider) throw new NotFoundException(`Unknown connector provider: ${id}`)
    return provider
  }

  private callbackUrl(providerId: string) {
    return this.env.CONNECTOR_CALLBACK_URL
      ?? `${this.env.WEB_ORIGIN.replace(/\/$/, '')}/api/connectors/callback/${providerId}`
  }
}
