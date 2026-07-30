import type {
  AssembledResponse,
  AssistantToolCall,
  ChatProvider,
  ChatProviderName,
  ChatStreamOptions,
  ProviderEvent,
  UsageReport,
} from '../llm/llm.interface'

/**
 * One scripted model turn. `stream()` consumes turns in order — one per loop
 * iteration of the AgentRunner. If `finishReason` is omitted it is inferred:
 * `tool_calls` when toolCalls are present, otherwise `stop`.
 */
export interface FakeTurn {
  /** Assistant text for this turn. Streamed as a single text_delta by default. */
  text?: string
  /** Tool calls the model issues this turn. */
  toolCalls?: AssistantToolCall[]
  finishReason?: AssembledResponse['finishReason']
  usage?: UsageReport
  /**
   * Explicit provider events to stream, overriding the default single
   * text_delta derived from `text`. Lets a test assert incremental streaming.
   */
  events?: ProviderEvent[]
}

/**
 * Deterministic, offline ChatProvider for tests. Scripts a fixed sequence of
 * model turns so agent behaviour is observable through the AgentRunner's
 * emitted SseEvents and returned result — no network, no real model.
 *
 * This is the shared fixture the whole durable-run runtime is tested against.
 */
export class FakeChatProvider implements ChatProvider {
  readonly name: ChatProviderName = 'anthropic'
  /** The options passed to each stream() call, in order — for assertions. */
  readonly calls: ChatStreamOptions[] = []
  private index = 0

  constructor(private readonly turns: FakeTurn[]) {}

  stream(opts: ChatStreamOptions): {
    events: AsyncIterable<ProviderEvent>
    done: Promise<AssembledResponse>
  } {
    this.calls.push(opts)
    const turn = this.turns[this.index++]
    if (!turn) {
      throw new Error(
        `FakeChatProvider: no scripted turn for call #${this.index} (scripted ${this.turns.length})`,
      )
    }

    const text = turn.text ?? ''
    const toolCalls = turn.toolCalls ?? []
    const finishReason =
      turn.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop')

    const events = turn.events ?? (text ? [{ kind: 'text_delta', delta: text } as const] : [])

    async function* gen(): AsyncGenerator<ProviderEvent> {
      for (const e of events) yield e
    }

    const assembled: AssembledResponse = {
      text,
      toolCalls,
      finishReason,
      usage: turn.usage,
    }

    return { events: gen(), done: Promise.resolve(assembled) }
  }
}
