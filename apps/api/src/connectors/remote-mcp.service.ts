import { Inject, Injectable } from '@nestjs/common'
import type { ToolDefinition } from '../agents/tools/tool.interface'
import { ConnectorsService } from './connectors.service'
import { notionProvider } from './providers/notion.provider'
import type { RemoteAgentTool, RemoteMcpProvider } from './providers/remote-mcp-provider'

export interface RemoteMcpClient {
  callTool(
    name: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>
  close(): Promise<void>
}

export interface RemoteMcpClientFactory {
  connect(url: string, accessToken: string): Promise<RemoteMcpClient>
}

export const REMOTE_MCP_CLIENT_FACTORY = Symbol('REMOTE_MCP_CLIENT_FACTORY')

/** Builds tools for the user's connected providers and owns remote sessions. */
@Injectable()
export class RemoteMcpService {
  // Deliberately concrete until a second real provider exists.
  private readonly providers: readonly RemoteMcpProvider[] = [notionProvider]

  constructor(
    private readonly connectors: ConnectorsService,
    @Inject(REMOTE_MCP_CLIENT_FACTORY) private readonly clients: RemoteMcpClientFactory,
  ) {}

  async withUserTools<T>(userId: string, run: (tools: ToolDefinition[]) => Promise<T>): Promise<T> {
    const tools: ToolDefinition[] = []
    for (const provider of this.providers) {
      if (!(await this.connectors.isActive(userId, provider.id))) continue
      for (const adapter of provider.agentTools) tools.push(this.tool(provider, adapter))
    }
    return run(tools)
  }

  private tool(provider: RemoteMcpProvider, adapter: RemoteAgentTool): ToolDefinition {
    return {
      name: adapter.name,
      description: adapter.description,
      schema: adapter.schema,
      parameters: adapter.parameters,
      execute: async (input, ctx) => {
        const accessToken = await this.connectors.accessToken(ctx.userId, provider.id)
        const client = await this.clients.connect(provider.serverUrl, accessToken)
        try {
          const result = await client.callTool(
            adapter.remoteToolName,
            adapter.toRemoteArguments(input),
            ctx.signal,
          )
          return adapter.fromRemoteResult(result)
        } finally {
          await client.close()
        }
      },
    }
  }
}

/** Production MCP SDK adapter, kept behind a factory for lifecycle tests. */
@Injectable()
export class SdkRemoteMcpClientFactory implements RemoteMcpClientFactory {
  async connect(url: string, accessToken: string): Promise<RemoteMcpClient> {
    // SDK imports remain require() to support Nest's CJS build.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      StreamableHTTPClientTransport,
    } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const client = new Client({ name: 'agent-platform', version: '0.1.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    try {
      await client.connect(transport)
    } catch (error) {
      await Promise.allSettled([transport.close?.(), client.close?.()])
      throw error
    }
    return {
      async callTool(name, arguments_, signal) {
        const result = await client.callTool(
          { name, arguments: arguments_ },
          undefined,
          signal ? { signal } : undefined,
        )
        if (result.isError) throw new Error(`Remote tool ${name} failed`)
        return result
      },
      async close() {
        await Promise.allSettled([transport.close(), client.close?.()])
      },
    }
  }
}
