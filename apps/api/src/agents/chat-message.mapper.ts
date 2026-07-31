import type { AssistantToolCall, ChatMessage } from './llm/llm.interface'

/** The persisted Message fields needed to rebuild an LLM ChatMessage. */
export interface PersistedMessageRow {
  role: string
  content: string
  toolCalls: unknown
  toolCallId: string | null
}

/**
 * Map a persisted Message row to the provider-facing ChatMessage shape. Shared
 * by the reactive chat service and the RunEngine so conversation history is
 * reconstructed the same way in both. Attachments are intentionally not
 * re-sent — they were consumed on the turn that produced them.
 */
export function toChatMessage(m: PersistedMessageRow): ChatMessage {
  return {
    role: m.role as ChatMessage['role'],
    content: m.content,
    toolCalls: (m.toolCalls as unknown as AssistantToolCall[] | null) ?? undefined,
    toolCallId: m.toolCallId ?? undefined,
  }
}
