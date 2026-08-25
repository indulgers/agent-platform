import { z } from 'zod'
import type { RemoteMcpProvider } from './remote-mcp-provider'

const pageInput = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  icon: z.string().emoji().optional(),
})

export const notionProvider: RemoteMcpProvider = {
  id: 'notion',
  displayName: 'Notion',
  serverUrl: 'https://mcp.notion.com/mcp',
  allowedRemoteTools: ['notion-create-pages'],
  toAgentTool(remoteToolName, input) {
    if (remoteToolName !== 'notion-create-pages') return null
    const page = pageInput.parse(input)
    return {
      name: 'notion_create_page',
      arguments: { pages: [{ properties: { title: page.title }, content: page.content, ...(page.icon ? { icon: page.icon } : {}) }] },
    }
  },
}

export { pageInput as notionCreatePageInput }
