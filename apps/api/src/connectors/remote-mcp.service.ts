import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { ToolDefinition } from '../agents/tools/tool.interface'
import { ConnectorsService } from './connectors.service'
import { getRemoteMcpProvider } from './providers/registry'
import { notionCreatePageInput } from './providers/notion.provider'

@Injectable()
export class RemoteMcpService {
  constructor(private readonly connectors: ConnectorsService) {}

  async withUserTools<T>(userId: string, run: (tools: ToolDefinition[]) => Promise<T>): Promise<T> {
    // Do not decrypt a token or establish a remote session until the model
    // actually calls the tool; this local status lookup is side-effect-free.
    return run((await this.connectors.isActive(userId, 'notion')) ? [this.notionTool()] : [])
  }

  private notionTool(): ToolDefinition<z.infer<typeof notionCreatePageInput>, { url?: string; result: unknown }> {
    return { name: 'notion_create_page', description: 'Create a new private page in the user\'s Notion workspace from Markdown. Use only when the user explicitly asks to save to Notion.', schema: notionCreatePageInput, parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, icon: { type: 'string' } }, required: ['title', 'content'], additionalProperties: false }, execute: async (input, ctx) => {
      const mapped = getRemoteMcpProvider('notion')!.toAgentTool('notion-create-pages', input)!
      const provider = getRemoteMcpProvider('notion')!
      const client = await RemoteClient.connect(provider.serverUrl, await this.connectors.accessToken(ctx.userId, 'notion'))
      try {
        const result = await client.callTool('notion-create-pages', mapped.arguments)
        return { result, url: findUrl(result) }
      } finally { await client.close() }
    } }
  }
}

class RemoteClient {
  private constructor(private readonly client: any, private readonly transport: any) {}
  static async connect(url: string, accessToken: string) {
    // SDK imports remain require() to support Nest's CJS build.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'agent-platform', version: '0.1.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } })
    try { await client.connect(transport); return new RemoteClient(client, transport) }
    catch (error) { await transport.close?.(); await client.close?.(); throw error }
  }
  async listTools() { return (await this.client.listTools()).tools as Array<{ name: string }> }
  async callTool(name: string, arguments_: Record<string, unknown>) { const result = await this.client.callTool({ name, arguments: arguments_ }); if (result.isError) throw new Error(`Notion tool ${name} failed`); return result }
  async close() { await this.transport.close(); await this.client.close?.() }
}

function findUrl(value: unknown): string | undefined {
  if (typeof value === 'string') { const match = value.match(/https?:\/\/[^\s"'}]+/); return match?.[0] }
  if (Array.isArray(value)) return value.map(findUrl).find(Boolean)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(findUrl).find(Boolean)
  return undefined
}
