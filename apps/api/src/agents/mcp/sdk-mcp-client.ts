import type { McpClient, McpServerConfig, McpToolInfo } from './mcp-client.interface'

/**
 * Adapter over @modelcontextprotocol/sdk implementing our McpClient seam via a
 * stdio transport. The SDK is loaded through require() so this file compiles
 * regardless of the SDK's conditional-exports layout; it is thin glue exercised
 * against real servers, while the tool-registration logic is tested via the
 * McpClient interface with a fake.
 */
export class SdkMcpClient implements McpClient {
  private client: { listTools(): Promise<{ tools: McpToolInfo[] }>; callTool(a: { name: string; arguments: unknown }): Promise<{ content?: unknown; isError?: boolean }>; close(): Promise<void>; connect(t: unknown): Promise<void> } | null = null

  constructor(private readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
    /* eslint-enable @typescript-eslint/no-var-requires */
    const client = new Client({ name: 'agent-platform', version: '0.1.0' }, { capabilities: {} })
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: this.config.env,
    })
    await client.connect(transport)
    this.client = client
  }

  async listTools(): Promise<McpToolInfo[]> {
    const res = await this.require().listTools()
    return (res.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }))
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const res = await this.require().callTool({ name, arguments: (args ?? {}) as Record<string, unknown> })
    if (res.isError) throw new Error(`MCP tool ${name} errored: ${JSON.stringify(res.content)}`)
    return res.content ?? res
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }

  private require() {
    if (!this.client) throw new Error('MCP client not connected')
    return this.client
  }
}
