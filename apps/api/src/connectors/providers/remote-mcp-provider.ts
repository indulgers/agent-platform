export interface AgentToolMapping {
  name: string
  arguments: Record<string, unknown>
}

export interface RemoteMcpProvider {
  id: string
  displayName: string
  serverUrl: string
  allowedRemoteTools: readonly string[]
  toAgentTool(remoteToolName: string, input: unknown): AgentToolMapping | null
}
