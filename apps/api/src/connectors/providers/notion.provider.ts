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
  agentTools: [{
    name: 'notion_create_page',
    description: 'Create a new private page in the user\'s Notion workspace from Markdown. Use only when the user explicitly asks to save to Notion.',
    schema: pageInput,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        icon: { type: 'string' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    remoteToolName: 'notion-create-pages',
    toRemoteArguments(input) {
      const page = pageInput.parse(input)
      return {
        pages: [{
          properties: { title: page.title },
          content: page.content,
          ...(page.icon ? { icon: page.icon } : {}),
        }],
      }
    },
    fromRemoteResult(result) {
      return { result, url: findUrl(result) }
    },
  }],
  toAgentTool(remoteToolName, input) {
    if (remoteToolName !== 'notion-create-pages') return null
    const page = pageInput.parse(input)
    return {
      name: 'notion_create_page',
      arguments: { pages: [{ properties: { title: page.title }, content: page.content, ...(page.icon ? { icon: page.icon } : {}) }] },
    }
  },
}

function findUrl(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.match(/https?:\/\/[^\s"'}]+/)?.[0]
  }
  if (Array.isArray(value)) return value.map(findUrl).find(Boolean)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(findUrl).find(Boolean)
  }
  return undefined
}

export { pageInput as notionCreatePageInput }
