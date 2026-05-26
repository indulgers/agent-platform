import { Injectable, Logger } from '@nestjs/common'
import type { SseEvent } from '@agent-platform/shared'
import type { ChatMessage, ChatProvider, ToolSpec } from '../llm/llm.interface'
import { ToolRegistry } from '../tools'

export interface RunnerOptions {
  provider: ChatProvider
  model: string
  systemPrompt: string
  history: ChatMessage[]
  userMessage: string
  ctx: { userId: string; conversationId: string }
  maxIterations: number
  maxTokens: number
  /** Called for every SSE event the runner produces. */
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

@Injectable()
export class AgentRunner {
  private readonly logger = new Logger(AgentRunner.name)

  constructor(private readonly tools: ToolRegistry) {}

  async run(opts: RunnerOptions): Promise<RunnerResult> {
    const toolSpecs: ToolSpec[] = this.tools.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))

    const conversation: ChatMessage[] = [
      { role: 'system', content: opts.systemPrompt },
      ...opts.history,
      { role: 'user', content: opts.userMessage },
    ]
    const newMessages: ChatMessage[] = [{ role: 'user', content: opts.userMessage }]
    let finalAssistantText = ''
    const usage = { promptTokens: 0, completionTokens: 0 }

    for (let iter = 0; iter < opts.maxIterations; iter++) {
      if (opts.signal?.aborted) return { finalAssistantText, newMessages, usage }

      const { events, done } = opts.provider.stream({
        model: opts.model,
        messages: conversation,
        tools: toolSpecs,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      })

      for await (const evt of events) {
        if (opts.signal?.aborted) return { finalAssistantText, newMessages, usage }
        if (evt.kind === 'text_delta') {
          opts.emit({ type: 'token', delta: evt.delta })
        }
      }

      const assembled = await done
      finalAssistantText = assembled.text
      if (assembled.usage) {
        usage.promptTokens += assembled.usage.promptTokens
        usage.completionTokens += assembled.usage.completionTokens
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assembled.text,
        toolCalls: assembled.toolCalls.length > 0 ? assembled.toolCalls : undefined,
      }
      conversation.push(assistantMessage)
      newMessages.push(assistantMessage)

      if (assembled.finishReason !== 'tool_calls' || assembled.toolCalls.length === 0) {
        return { finalAssistantText, newMessages, usage }
      }

      for (const call of assembled.toolCalls) {
        opts.emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args })
        const tool = this.tools.get(call.name)
        if (!tool) {
          const error = `Unknown tool: ${call.name}`
          opts.emit({ type: 'tool_result', id: call.id, ok: false, error })
          const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify({ error }) }
          conversation.push(toolMsg)
          newMessages.push(toolMsg)
          continue
        }
        try {
          const parsed = tool.schema.parse(call.args)
          const result = await tool.execute(parsed, opts.ctx)
          opts.emit({ type: 'tool_result', id: call.id, ok: true, result })
          const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify(result) }
          conversation.push(toolMsg)
          newMessages.push(toolMsg)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.logger.warn(`Tool ${call.name} failed: ${error}`)
          opts.emit({ type: 'tool_result', id: call.id, ok: false, error })
          const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify({ error }) }
          conversation.push(toolMsg)
          newMessages.push(toolMsg)
        }
      }
    }

    opts.emit({
      type: 'error',
      message: `Agent stopped: reached max iterations (${opts.maxIterations}) without final answer`,
    })
    return { finalAssistantText, newMessages, usage }
  }
}
