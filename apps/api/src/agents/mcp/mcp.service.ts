import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ToolRegistry } from '../tools'
import { registerMcpTools } from './register-mcp-tools'
import { SdkMcpClient } from './sdk-mcp-client'
import type { McpClient, McpServerConfig } from './mcp-client.interface'

/**
 * Connects configured MCP servers on boot and registers their tools into the
 * shared ToolRegistry, so the agent can call them like built-ins. Servers are
 * configured via the MCP_SERVERS env var — a JSON array of
 * `{ name, command, args?, env? }`. Failures are logged and skipped so one bad
 * server never blocks startup.
 */
@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name)
  private readonly clients: McpClient[] = []

  constructor(private readonly registry: ToolRegistry) {}

  async onModuleInit(): Promise<void> {
    for (const config of this.parseConfig()) {
      try {
        const client = new SdkMcpClient(config)
        await client.connect()
        const names = await registerMcpTools(this.registry, client, config.name)
        this.clients.push(client)
        this.logger.log(`MCP server "${config.name}" registered ${names.length} tool(s)`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.warn(`MCP server "${config.name}" failed to connect: ${message}`)
      }
    }
  }

  private parseConfig(): McpServerConfig[] {
    const raw = process.env.MCP_SERVERS
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as McpServerConfig[]) : []
    } catch {
      this.logger.warn('MCP_SERVERS is not valid JSON; ignoring')
      return []
    }
  }
}
