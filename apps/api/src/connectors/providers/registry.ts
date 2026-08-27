import type { RemoteMcpProvider } from './remote-mcp-provider'
import { notionProvider } from './notion.provider'

const providers = new Map<string, RemoteMcpProvider>([[notionProvider.id, notionProvider]])

/**
 * Retrieves a registered remote MCP provider by its identifier.
 *
 * @param id - The provider identifier
 * @returns The registered provider, or `undefined` if no provider matches the identifier
 */
export function getRemoteMcpProvider(id: string): RemoteMcpProvider | undefined {
  return providers.get(id)
}

/**
 * Lists all registered remote MCP providers.
 *
 * @returns An array containing the registered remote MCP providers
 */
export function listRemoteMcpProviders(): RemoteMcpProvider[] {
  return [...providers.values()]
}
