/**
 * The slice of an MCP (Model Context Protocol) connection this codebase needs.
 * Kept as our own interface so tool registration is testable with a fake client
 * and independent of any specific SDK version.
 */
export interface McpToolInfo {
  name: string
  description?: string
  /** JSON Schema for the tool's arguments, as advertised by the server. */
  inputSchema?: Record<string, unknown>
}

export interface McpClient {
  /** List the tools the connected server exposes. */
  listTools(): Promise<McpToolInfo[]>
  /** Invoke a server tool by its server-side name. */
  callTool(name: string, args: unknown): Promise<unknown>
  /** Tear down the connection. */
  close(): Promise<void>
}

/** Configuration for one MCP server (stdio transport). */
export interface McpServerConfig {
  /** Short id used to namespace the server's tools: `mcp__<name>__<tool>`. */
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}
