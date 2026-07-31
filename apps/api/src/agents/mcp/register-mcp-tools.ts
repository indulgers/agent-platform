import { z } from 'zod'
import type { ToolRegistry } from '../tools'
import type { ToolDefinition } from '../tools/tool.interface'
import type { McpClient } from './mcp-client.interface'

/** Namespaced tool name so servers can't collide: `mcp__<server>__<tool>`. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}

/**
 * Discover an MCP server's tools and register each into the shared ToolRegistry
 * as a first-class ToolDefinition — the same shape built-in tools use, so the
 * agent calls MCP tools exactly like local ones. Argument validation is
 * delegated to the server (schema is permissive here); the server's advertised
 * JSON Schema is surfaced to the model verbatim.
 *
 * Returns the registered tool names.
 */
export async function registerMcpTools(
  registry: ToolRegistry,
  client: McpClient,
  serverName: string,
): Promise<string[]> {
  const tools = await client.listTools()
  const registered: string[] = []
  for (const t of tools) {
    const name = mcpToolName(serverName, t.name)
    const definition: ToolDefinition = {
      name,
      description: t.description ?? `MCP tool ${t.name} from ${serverName}`,
      schema: z.any(),
      parameters: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
      execute: (input: unknown) => client.callTool(t.name, input),
    }
    registry.register(definition)
    registered.push(name)
  }
  return registered
}
