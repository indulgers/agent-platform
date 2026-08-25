import type { RemoteMcpProvider } from './remote-mcp-provider'
import { notionProvider } from './notion.provider'

const providers = new Map<string, RemoteMcpProvider>([[notionProvider.id, notionProvider]])

export function getRemoteMcpProvider(id: string): RemoteMcpProvider | undefined {
  return providers.get(id)
}

export function listRemoteMcpProviders(): RemoteMcpProvider[] {
  return [...providers.values()]
}
