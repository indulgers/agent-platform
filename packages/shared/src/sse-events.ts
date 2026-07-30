import type { RunStatus } from './runs'

/**
 * Single source of truth for the agent's SSE event protocol.
 * Server emits these; web consumes them.
 */
export type SseEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'run_status'; runId: string; status: RunStatus }
  | { type: 'usage'; model: string; promptTokens: number; completionTokens: number; costUsd: number }
  | { type: 'message_done'; messageId: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type SseEventType = SseEvent['type']
