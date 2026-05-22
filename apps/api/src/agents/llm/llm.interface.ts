/**
 * Provider-agnostic streaming chat interface.
 *
 * `stream()` yields events incrementally as the provider produces them, then resolves
 * with the assembled assistant message (text + any tool calls) once the model stops
 * (either by emitting end_of_message or by issuing tool_use / function_call blocks).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool calls emitted by the assistant during a previous turn. */
  toolCalls?: AssistantToolCall[]
  /** When role === 'tool': the id of the tool call this message answers. */
  toolCallId?: string
}

export interface AssistantToolCall {
  id: string
  name: string
  args: unknown
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema-compatible object describing args. */
  parameters: Record<string, unknown>
}

export interface ChatStreamOptions {
  model: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  maxTokens: number
  signal?: AbortSignal
}

export type ProviderEvent =
  | { kind: 'text_delta'; delta: string }
  | { kind: 'tool_call_start'; id: string; name: string }
  | { kind: 'tool_call_args_delta'; id: string; argsDelta: string }
  | { kind: 'tool_call_end'; id: string }
  | { kind: 'message_end'; finishReason: 'stop' | 'tool_calls' | 'length' | 'error' }

export interface AssembledResponse {
  text: string
  toolCalls: AssistantToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
}

export type ChatProviderName = 'openai' | 'anthropic' | 'deepseek'

export interface ChatProvider {
  readonly name: ChatProviderName
  stream(opts: ChatStreamOptions): {
    events: AsyncIterable<ProviderEvent>
    /** Resolves once the stream is fully drained — provider implementations populate this. */
    done: Promise<AssembledResponse>
  }
}
