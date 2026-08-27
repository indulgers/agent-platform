import type { SseEvent } from '@agent-platform/shared'
import type { ChatAttachment, ChatMessage, ChatProvider } from '../llm/llm.interface'
import type { ToolRegistry } from '../tools'
import type { ToolContext } from '../tools/tool.interface'

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
  ctx: Omit<ToolContext, 'signal'>
  maxIterations: number
  maxTokens: number
  /** The approved plan to execute, when running under plan→act→reflect. */
  plan?: PlanDraft
  /** Called for every SSE event the strategy produces. */
  emit: (event: SseEvent) => void
  /**
   * Awaited after each completed iteration with the messages produced so far.
   * Lets the host persist progress incrementally (for durable resume) and abort
   * via `signal` (e.g. on interrupt). No-op when omitted.
   */
  checkpoint?: (messagesSoFar: ChatMessage[]) => Promise<void>
  /**
   * Called before running a tool that `requiresApproval`. The host decides
   * whether this checkpoint is already approved (`proceed`) or the run should
   * pause for approval (`pause`). Defaults to proceed when omitted.
   */
  requestCheckpoint?: (call: CheckpointCall) => Promise<'proceed' | 'pause'>
  /** Cancelled by the client closing the SSE connection, or on interrupt. */
  signal?: AbortSignal
}

/** One step of an agent-proposed plan. */
export interface PlanStepDraft {
  index: number
  description: string
}

/** An ordered plan the user approves before autonomous execution begins. */
export interface PlanDraft {
  steps: PlanStepDraft[]
}

/** A tool call awaiting human approval at a checkpoint. */
export interface CheckpointCall {
  name: string
  args: unknown
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
  /**
   * Optional planning phase: propose an ordered plan for the goal, which the
   * user approves/edits before run() executes it. Strategies without a planning
   * phase (e.g. the default act-until-stop loop) omit this.
   */
  plan?(ctx: StrategyContext): Promise<PlanDraft>
}
