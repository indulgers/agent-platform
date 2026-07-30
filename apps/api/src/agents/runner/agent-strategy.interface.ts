import type { SseEvent } from '@agent-platform/shared'
import type { ChatAttachment, ChatMessage, ChatProvider } from '../llm/llm.interface'
import type { ToolRegistry } from '../tools'

/**
 * Everything a strategy needs to drive one agent invocation. This is the
 * contract callers (the AgentRunner, and later the RunEngine) build and hand to
 * a strategy — the seam at which the reasoning algorithm is pluggable.
 */
export interface RunnerOptions {
  provider: ChatProvider
  model: string
  systemPrompt: string
  history: ChatMessage[]
  userMessage: string
  /** Image attachments delivered with the user message (base64-resolved). */
  userAttachments?: ChatAttachment[]
  ctx: { userId: string; conversationId: string }
  maxIterations: number
  maxTokens: number
  /** Called for every SSE event the strategy produces. */
  emit: (event: SseEvent) => void
  /** Cancelled by the client closing the SSE connection. */
  signal?: AbortSignal
}

export interface RunnerResult {
  finalAssistantText: string
  /** All assistant + tool messages produced during the run, in order. */
  newMessages: ChatMessage[]
  /** Sum of input + output tokens across every LLM call this run made. */
  usage: { promptTokens: number; completionTokens: number }
}

/** A strategy's inputs: the run options plus the tools it may call. */
export interface StrategyContext extends RunnerOptions {
  tools: ToolRegistry
}

/**
 * The pluggable reasoning algorithm that drives an agent turn/run. Swapping the
 * strategy (e.g. plan→act→reflect, DAG, multi-agent) changes how the agent
 * thinks without touching the runtime that hosts it.
 */
export interface AgentStrategy {
  readonly name: string
  run(ctx: StrategyContext): Promise<RunnerResult>
}
