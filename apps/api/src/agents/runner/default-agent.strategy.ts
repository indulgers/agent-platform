import { Logger } from '@nestjs/common'
import type { ChatMessage, ToolSpec } from '../llm/llm.interface'
import type { AgentStrategy, RunnerResult, StrategyContext } from './agent-strategy.interface'

/**
 * The original act-until-stop loop, unchanged in behaviour: stream text, and
 * whenever the model issues tool calls, execute them and feed results back,
 * until the model stops or maxIterations is reached. This is the default
 * strategy; smarter strategies (plan→act→reflect) slot in behind the same seam.
 */
export class DefaultAgentStrategy implements AgentStrategy {
  readonly name = 'default'
  private readonly logger = new Logger(DefaultAgentStrategy.name)

  async run(ctx: StrategyContext): Promise<RunnerResult> {
    const toolSpecs: ToolSpec[] = ctx.tools.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))

    const userTurn: ChatMessage = {
      role: 'user',
      content: ctx.userMessage,
      attachments: ctx.userAttachments,
    }
    const conversation: ChatMessage[] = [
      { role: 'system', content: ctx.systemPrompt },
      ...ctx.history,
      userTurn,
    ]
    const newMessages: ChatMessage[] = [userTurn]
    let finalAssistantText = ''
    const usage = { promptTokens: 0, completionTokens: 0 }

    for (let iter = 0; iter < ctx.maxIterations; iter++) {
      if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }

      const { events, done } = ctx.provider.stream({
        model: ctx.model,
        messages: conversation,
        tools: toolSpecs,
        maxTokens: ctx.maxTokens,
        signal: ctx.signal,
      })

      for await (const evt of events) {
        if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }
        if (evt.kind === 'text_delta') {
          ctx.emit({ type: 'token', delta: evt.delta })
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
        ctx.emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args })
        const tool = ctx.tools.get(call.name)
        if (!tool) {
          const error = `Unknown tool: ${call.name}`
          ctx.emit({ type: 'tool_result', id: call.id, ok: false, error })
          const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify({ error }) }
          conversation.push(toolMsg)
          newMessages.push(toolMsg)
          continue
        }
        try {
          const parsed = tool.schema.parse(call.args)
          const result = await tool.execute(parsed, ctx.ctx)
          ctx.emit({ type: 'tool_result', id: call.id, ok: true, result })
          const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify(result) }
          conversation.push(toolMsg)
          newMessages.push(toolMsg)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.logger.warn(`Tool ${call.name} failed: ${error}`)
          ctx.emit({ type: 'tool_result', id: call.id, ok: false, error })
          const toolMsg: ChatMessage = { role: 'tool', toolCallId: call.id, content: JSON.stringify({ error }) }
          conversation.push(toolMsg)
          newMessages.push(toolMsg)
        }
      }
    }

    // Tool budget exhausted without a final answer. Rather than leaving the
    // user with a bare error, make one last completion with no tools so the
    // model must answer from what it already has.
    if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }
    const closing = ctx.provider.stream({
      model: ctx.model,
      messages: [
        ...conversation,
        {
          role: 'user',
          content:
            'You have run out of tool-use steps. Give your best final answer now using only ' +
            'what you already have; do not request more tools.',
        },
      ],
      tools: [],
      maxTokens: ctx.maxTokens,
      signal: ctx.signal,
    })
    for await (const evt of closing.events) {
      if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }
      if (evt.kind === 'text_delta') ctx.emit({ type: 'token', delta: evt.delta })
    }
    const closingAssembled = await closing.done
    if (closingAssembled.usage) {
      usage.promptTokens += closingAssembled.usage.promptTokens
      usage.completionTokens += closingAssembled.usage.completionTokens
    }
    finalAssistantText = closingAssembled.text
    newMessages.push({ role: 'assistant', content: closingAssembled.text })
    return { finalAssistantText, newMessages, usage }
  }
}
