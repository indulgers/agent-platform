import { Injectable, Optional } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { loadEnv } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'
import type { OAuthMetadata } from './oauth-metadata'
import { TokenCrypto } from './token-crypto'

export type OAuthClientRegistration = { id: string; clientId: string; clientSecret?: string }

@Injectable()
export class OAuthClientRegistrationService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly cryptoInstance?: TokenCrypto) {}

  async getOrCreate(providerId: string, callbackUrl: string, metadata: OAuthMetadata): Promise<OAuthClientRegistration> {
    const existing = await this.prisma.oAuthClientRegistration.findUnique({ where: { providerId_callbackUrl: { providerId, callbackUrl } } })
    if (existing) return this.registration(existing)

    if (!metadata.registration_endpoint) throw new Error(`OAuth metadata for ${providerId} does not advertise a registration endpoint`)
    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'agent-platform',
        redirect_uris: [callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`OAuth client registration failed (${response.status}): ${text}`)
    const registered = JSON.parse(text) as { client_id?: unknown; client_secret?: unknown }
    if (typeof registered.client_id !== 'string' || !registered.client_id) throw new Error('OAuth client registration response did not include client_id')
    const clientSecretEncrypted = typeof registered.client_secret === 'string' && registered.client_secret ? this.crypto().encrypt(registered.client_secret) : null

    try {
      const created = await this.prisma.oAuthClientRegistration.create({ data: { providerId, callbackUrl, clientId: registered.client_id, clientSecretEncrypted } })
      return this.registration(created)
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) && (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002')) throw error
      const winner = await this.prisma.oAuthClientRegistration.findUnique({ where: { providerId_callbackUrl: { providerId, callbackUrl } } })
      if (!winner) throw error
      return this.registration(winner)
    }
  }

  async byId(id: string): Promise<OAuthClientRegistration> {
    const registration = await this.prisma.oAuthClientRegistration.findUnique({ where: { id } })
    if (!registration) throw new Error(`OAuth client registration ${id} was not found`)
    return this.registration(registration)
  }

  private registration(registration: { id: string; clientId: string; clientSecretEncrypted: string | null }): OAuthClientRegistration {
    return { id: registration.id, clientId: registration.clientId, clientSecret: registration.clientSecretEncrypted ? this.crypto().decrypt(registration.clientSecretEncrypted) : undefined }
  }

  private crypto() {
    if (this.cryptoInstance) return this.cryptoInstance
    const key = loadEnv().CONNECTOR_ENCRYPTION_KEY
    if (!key) throw new Error('CONNECTOR_ENCRYPTION_KEY is required for connectors')
    return new TokenCrypto(key)
  }
}
