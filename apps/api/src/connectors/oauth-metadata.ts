export interface OAuthMetadata {
  authorization_endpoint: string
  token_endpoint: string
  scopes_supported?: string[]
}

export async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
  const protectedResource = await fetch(`${serverUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`)
  if (!protectedResource.ok) throw new Error(`OAuth protected-resource discovery failed (${protectedResource.status})`)
  const resource = (await protectedResource.json()) as { authorization_servers?: string[] }
  const authorizationServer = resource.authorization_servers?.[0]
  if (!authorizationServer) throw new Error('OAuth discovery did not return an authorization server')
  const response = await fetch(`${authorizationServer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`)
  if (!response.ok) throw new Error(`OAuth authorization-server discovery failed (${response.status})`)
  const metadata = (await response.json()) as OAuthMetadata
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('OAuth metadata is missing required endpoints')
  return metadata
}
