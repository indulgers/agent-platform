export interface OAuthMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes_supported?: string[]
}

/**
 * Discovers OAuth server metadata for a protected resource.
 *
 * @param serverUrl - The protected resource server URL
 * @returns The validated OAuth server metadata
 * @throws If protected-resource discovery fails, no authorization server is provided, authorization-server discovery fails, or required metadata is missing
 */
export async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
  const protectedResource = await fetch(protectedResourceMetadataUrl(serverUrl))
  if (!protectedResource.ok) throw new Error(`OAuth protected-resource discovery failed (${protectedResource.status})`)
  const resource = (await protectedResource.json()) as { authorization_servers?: string[] }
  const authorizationServer = resource.authorization_servers?.[0]
  if (!authorizationServer) throw new Error('OAuth discovery did not return an authorization server')
  const response = await fetch(`${authorizationServer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`)
  if (!response.ok) throw new Error(`OAuth authorization-server discovery failed (${response.status})`)
  const metadata = (await response.json()) as OAuthMetadata
  if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('OAuth metadata is missing required endpoints or issuer')
  return metadata
}

/**
 * Constructs the OAuth protected-resource metadata URL for a server.
 *
 * @param serverUrl - The server URL whose path and query string should be preserved
 * @returns The corresponding OAuth protected-resource metadata URL
 */
function protectedResourceMetadataUrl(serverUrl: string) {
  const resource = new URL(serverUrl)
  const path = resource.pathname.replace(/^\/+/, '')
  return `${resource.origin}/.well-known/oauth-protected-resource${path ? `/${path}` : ''}${resource.search}`
}
