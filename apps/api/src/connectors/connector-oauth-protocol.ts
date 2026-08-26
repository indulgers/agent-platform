import { BadRequestException, Injectable, Optional, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { loadEnv } from '../config/env'
import { discoverOAuthMetadata, type OAuthMetadata } from './oauth-metadata'
import {
  OAuthClientRegistrationService,
  type OAuthClientRegistration,
} from './oauth-client-registration.service'
import { createConnectorTokenCrypto, TokenCrypto } from './token-crypto'

export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

/** OAuth protocol boundary shared by authorization, callback and refresh. */
@Injectable()
export class ConnectorOAuthProtocol {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrations: OAuthClientRegistrationService,
    @Optional() private readonly cryptoInstance?: TokenCrypto,
  ) {}

  ensureAvailable(): void {
    this.crypto()
  }

  async begin(input: {
    userId: string
    providerId: string
    serverUrl: string
    callbackUrl: string
  }): Promise<{ url: string }> {
    this.ensureAvailable()
    const metadata = await discoverOAuthMetadata(input.serverUrl)
    const registration = await this.registrations.getOrCreate(
      input.providerId,
      input.callbackUrl,
      metadata,
    )
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    await this.prisma.oAuthState.create({
      data: {
        state,
        userId: input.userId,
        providerId: input.providerId,
        registrationId: registration.id,
        pkceVerifierEncrypted: this.crypto().encrypt(verifier),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })
    const url = new URL(metadata.authorization_endpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: registration.clientId,
      redirect_uri: input.callbackUrl,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'consent',
    }).toString()
    return { url: url.toString() }
  }

  async complete(input: {
    providerId: string
    serverUrl?: string
    state: string
    code?: string
    oauthError?: string
    providerDisplayName?: string
  }): Promise<{ userId: string; registrationId: string; tokens: OAuthTokens }> {
    const saved = await this.prisma.oAuthState.findUnique({ where: { state: input.state } })
    if (!saved || saved.providerId !== input.providerId) {
      throw new UnauthorizedException('OAuth state is invalid or expired')
    }
    if (!saved.registrationId) throw new Error('OAuth state has no client registration')
    const claimed = await this.prisma.oAuthState.updateMany({
      where: { state: input.state, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    })
    if (claimed.count !== 1) throw new UnauthorizedException('OAuth state is invalid or expired')
    if (input.oauthError) {
      throw new BadRequestException(
        `${input.providerDisplayName ?? input.providerId} authorization was declined: ${input.oauthError}`,
      )
    }
    if (!input.code) {
      throw new BadRequestException('OAuth callback did not include an authorization code')
    }
    if (!input.serverUrl) throw new Error('OAuth provider server URL is required')
    const registration = await this.registrations.byId(saved.registrationId)
    const tokens = await this.exchange(
      await discoverOAuthMetadata(input.serverUrl),
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: registration.callbackUrl,
        code_verifier: this.crypto().decrypt(saved.pkceVerifierEncrypted),
      }),
      registration,
    )
    return { userId: saved.userId, registrationId: saved.registrationId, tokens }
  }

  async refresh(input: {
    serverUrl: string
    registrationId: string
    refreshToken: string
  }): Promise<OAuthTokens> {
    const registration = await this.registrations.byId(input.registrationId)
    return this.exchange(
      await discoverOAuthMetadata(input.serverUrl),
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: input.refreshToken }),
      registration,
    )
  }

  encrypt(value: string): string {
    return this.crypto().encrypt(value)
  }

  decrypt(value: string): string {
    return this.crypto().decrypt(value)
  }

  private async exchange(
    metadata: OAuthMetadata,
    body: URLSearchParams,
    registration: OAuthClientRegistration,
  ): Promise<OAuthTokens> {
    body.set('client_id', registration.clientId)
    if (registration.clientSecret) body.set('client_secret', registration.clientSecret)
    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Token request failed (${response.status}): ${text}`)
    const tokens = JSON.parse(text) as OAuthTokens
    if (!tokens.access_token) throw new Error('Token response did not include access_token')
    return tokens
  }

  private crypto(): TokenCrypto {
    return this.cryptoInstance ?? createConnectorTokenCrypto(loadEnv().CONNECTOR_ENCRYPTION_KEY)
  }
}
