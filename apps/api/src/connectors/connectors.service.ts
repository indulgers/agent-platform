import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { loadEnv } from '../config/env'
import { TokenCrypto } from './token-crypto'
import { discoverOAuthMetadata, type OAuthMetadata } from './oauth-metadata'
import { OAuthClientRegistrationService, type OAuthClientRegistration } from './oauth-client-registration.service'
import { getRemoteMcpProvider, listRemoteMcpProviders } from './providers/registry'

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number }

@Injectable()
export class ConnectorsService {
  private readonly env = loadEnv()
  private readonly refreshes = new Map<string, Promise<string>>()

  constructor(private readonly prisma: PrismaService, private readonly registrations: OAuthClientRegistrationService) {}

  async list(userId: string) {
    const rows = await this.prisma.connector.findMany({ where: { userId } })
    return listRemoteMcpProviders().map(provider => {
      const row = rows.find(c => c.providerId === provider.id)
      return { providerId: provider.id, displayName: provider.displayName, status: row?.status ?? 'disconnected', expiresAt: row?.expiresAt ?? null, connectedAt: row?.createdAt ?? null }
    })
  }

  async startAuthorization(userId: string, providerId: string) {
    const provider = this.provider(providerId)
    const callbackUrl = this.callbackUrl(providerId)
    const metadata = await discoverOAuthMetadata(provider.serverUrl)
    const registration = await this.registrations.getOrCreate(providerId, callbackUrl, metadata)
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    await this.prisma.oAuthState.create({ data: { state, userId, providerId, registrationId: registration.id, pkceVerifierEncrypted: this.crypto().encrypt(verifier), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const url = new URL(metadata.authorization_endpoint)
    url.search = new URLSearchParams({ response_type: 'code', client_id: registration.clientId, redirect_uri: callbackUrl, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'consent' }).toString()
    return { url: url.toString() }
  }

  async finishAuthorization(providerId: string, state: string, code?: string, oauthError?: string) {
    const saved = await this.prisma.oAuthState.findUnique({ where: { state } })
    if (!saved || saved.providerId !== providerId) throw new UnauthorizedException('OAuth state is invalid or expired')
    if (!saved.registrationId) throw new Error('OAuth state has no client registration')
    const claimed = await this.prisma.oAuthState.updateMany({ where: { state, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } })
    if (claimed.count !== 1) throw new UnauthorizedException('OAuth state is invalid or expired')
    if (oauthError) throw new BadRequestException(`Notion authorization was declined: ${oauthError}`)
    if (!code) throw new BadRequestException('OAuth callback did not include an authorization code')
    const provider = this.provider(providerId)
    const registration = await this.registrations.byId(saved.registrationId)
    const tokens = await this.exchange(await discoverOAuthMetadata(provider.serverUrl), new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: registration.callbackUrl, code_verifier: this.crypto().decrypt(saved.pkceVerifierEncrypted) }), registration)
    await this.prisma.connector.upsert({ where: { userId_providerId: { userId: saved.userId, providerId } }, create: { ...this.tokenData(saved.userId, providerId, tokens), registrationId: saved.registrationId }, update: { ...this.tokenData(saved.userId, providerId, tokens), registrationId: saved.registrationId } })
  }

  async disconnect(userId: string, providerId: string) {
    this.provider(providerId)
    await this.prisma.connector.deleteMany({ where: { userId, providerId } })
  }

  async isActive(userId: string, providerId: string): Promise<boolean> {
    return !!(await this.prisma.connector.findFirst({ where: { userId, providerId, status: 'active' }, select: { id: true } }))
  }

  async accessToken(userId: string, providerId: string): Promise<string> {
    const connector = await this.prisma.connector.findUnique({ where: { userId_providerId: { userId, providerId } } })
    if (!connector || connector.status !== 'active') throw new NotFoundException(`${providerId} is not connected`)
    if (!connector.expiresAt || connector.expiresAt.getTime() > Date.now() + 60_000) return this.crypto().decrypt(connector.accessTokenEncrypted)
    const key = connector.id
    const pending = this.refreshes.get(key)
    if (pending) return pending
    const refresh = this.refresh(connector).finally(() => this.refreshes.delete(key))
    this.refreshes.set(key, refresh)
    return refresh
  }

  private async refresh(connector: { id: string; providerId: string; refreshTokenEncrypted: string | null; registrationId: string | null }) {
    if (!connector.refreshTokenEncrypted) throw new UnauthorizedException('Notion needs to be reconnected')
    if (!connector.registrationId) throw new UnauthorizedException('Notion needs to be reconnected because its OAuth client registration is unavailable')
    const provider = this.provider(connector.providerId)
    try {
      const metadata = await discoverOAuthMetadata(provider.serverUrl)
      const registration = await this.registrations.byId(connector.registrationId)
      const tokens = await this.exchange(metadata, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.crypto().decrypt(connector.refreshTokenEncrypted) }), registration)
      const data = this.tokenData('', connector.providerId, tokens)
      await this.prisma.connector.update({ where: { id: connector.id }, data: { ...data, userId: undefined } })
      return tokens.access_token
    } catch (error) {
      if (error instanceof Error && error.message.includes('invalid_grant')) await this.prisma.connector.update({ where: { id: connector.id }, data: { status: 'revoked' } })
      throw error
    }
  }

  private async exchange(metadata: OAuthMetadata, body: URLSearchParams, registration: OAuthClientRegistration): Promise<Tokens> {
    body.set('client_id', registration.clientId)
    if (registration.clientSecret) body.set('client_secret', registration.clientSecret)
    const response = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body })
    const text = await response.text()
    if (!response.ok) throw new Error(`Token request failed (${response.status}): ${text}`)
    const tokens = JSON.parse(text) as Tokens
    if (!tokens.access_token) throw new Error('Token response did not include access_token')
    return tokens
  }

  private tokenData(userId: string, providerId: string, tokens: Tokens) { return { userId, providerId, status: 'active' as const, accessTokenEncrypted: this.crypto().encrypt(tokens.access_token), refreshTokenEncrypted: tokens.refresh_token ? this.crypto().encrypt(tokens.refresh_token) : undefined, expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null } }
  private provider(id: string) { const provider = getRemoteMcpProvider(id); if (!provider) throw new NotFoundException(`Unknown connector provider: ${id}`); return provider }
  private crypto() { if (!this.env.CONNECTOR_ENCRYPTION_KEY) throw new Error('CONNECTOR_ENCRYPTION_KEY is required for connectors'); return new TokenCrypto(this.env.CONNECTOR_ENCRYPTION_KEY) }
  private callbackUrl(providerId: string) { return this.env.CONNECTOR_CALLBACK_URL ?? `${this.env.WEB_ORIGIN.replace(/\/$/, '')}/api/connectors/callback/${providerId}` }
}
