export const AGENT_QUEUE = 'agent-tasks'

export interface AgentJobPayload {
  taskId: string
  userId: string
  type: string
  payload: Record<string, unknown>
}
