import type { ZodType } from 'zod'

export interface RemoteAgentTool {
  name: string
  description: string
  schema: ZodType
  parameters: Record<string, unknown>
  remoteToolName: string
  toRemoteArguments(input: unknown): Record<string, unknown>
  fromRemoteResult(result: unknown): unknown
}

export interface RemoteMcpProvider {
  id: string
  displayName: string
  serverUrl: string
  agentTools: readonly RemoteAgentTool[]
}
