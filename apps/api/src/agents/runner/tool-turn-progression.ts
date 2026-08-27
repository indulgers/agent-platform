import { Logger } from '@nestjs/common'
import type { ChatMessage, ToolSpec } from '../llm/llm.interface'
import type { ToolDefinition } from '../tools/tool.interface'
import type { RunnerResult, StrategyContext } from './agent-strategy.interface'

export interface ToolTurnPolicy {
  toolRetries: number
  toolRetryBaseMs: number
  approvalCheckpoints: boolean
  reflectOnFailure: boolean
  checkpointAfterTurn: boolean
  exhaustion: 'close_without_tools' | 'emit_error'
}

export const DEFAULT_TURN_POLICY: ToolTurnPolicy = {
  toolRetries: 0,
  toolRetryBaseMs: 0,
  approvalCheckpoints: false,
  reflectOnFailure: false,
  checkpointAfterTurn: false,
  exhaustion: 'close_without_tools',
}

export const PLAN_ACT_REFLECT_TURN_POLICY: ToolTurnPolicy = {
  toolRetries: 2,
  toolRetryBaseMs: 50,
  approvalCheckpoints: true,
  reflectOnFailure: true,
  checkpointAfterTurn: true,
  exhaustion: 'emit_error',
}

/**
 * Shared model/tool turn protocol. Strategies provide only policy: this module
 * owns streaming, validation, transcription, usage and abort boundaries.
 */
export class ToolTurnProgression {
  private readonly logger = new Logger(ToolTurnProgression.name)

  async run(
    ctx: StrategyContext,
    systemContent: string,
    policy: ToolTurnPolicy,
  ): Promise<RunnerResult> {
    const toolSpecs: ToolSpec[] = ctx.tools.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
    const userTurn: ChatMessage = {
      role: 'user',
      content: ctx.userMessage,
      attachments: ctx.userAttachments,
    }
    const conversation: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...ctx.history,
      userTurn,
    ]
    const newMessages: ChatMessage[] = [userTurn]
    let finalAssistantText = ''
    const usage = { promptTokens: 0, completionTokens: 0 }

    for (let iteration = 0; iteration < ctx.maxIterations; iteration++) {
      if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }

      const turn = ctx.provider.stream({
        model: ctx.model,
        messages: conversation,
        tools: toolSpecs,
        maxTokens: ctx.maxTokens,
        signal: ctx.signal,
      })
      for await (const event of turn.events) {
        if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }
        if (event.kind === 'text_delta') ctx.emit({ type: 'token', delta: event.delta })
      }

      const assembled = await turn.done
      finalAssistantText = assembled.text
      this.addUsage(usage, assembled.usage)
      const assistant: ChatMessage = {
        role: 'assistant',
        content: assembled.text,
        toolCalls: assembled.toolCalls.length > 0 ? assembled.toolCalls : undefined,
      }
      conversation.push(assistant)
      newMessages.push(assistant)

      if (assembled.finishReason !== 'tool_calls' || assembled.toolCalls.length === 0) {
        return { finalAssistantText, newMessages, usage }
      }

      const failures: string[] = []
      for (const call of assembled.toolCalls) {
        ctx.emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args })
        const tool = ctx.tools.get(call.name)
        if (!tool) {
          const error = `Unknown tool: ${call.name}`
          failures.push(`${call.name}: ${error}`)
          this.recordToolResult(ctx, conversation, newMessages, call.id, { error }, error)
          continue
        }

        if (policy.approvalCheckpoints && tool.requiresApproval) {
          const decision =
            (await ctx.requestCheckpoint?.({ name: call.name, args: call.args })) ?? 'proceed'
          if (decision === 'pause') return { finalAssistantText, newMessages, usage }
        }

        try {
          const parsed = tool.schema.parse(call.args)
          const result = await this.execute(tool, parsed, ctx, policy)
          this.recordToolResult(ctx, conversation, newMessages, call.id, result)
        } catch (caught) {
          const error = caught instanceof Error ? caught.message : String(caught)
          this.logger.warn(`Tool ${call.name} failed: ${error}`)
          failures.push(`${call.name}: ${error}`)
          this.recordToolResult(ctx, conversation, newMessages, call.id, { error }, error)
        }
      }

      if (policy.reflectOnFailure && failures.length > 0) {
        const reflection: ChatMessage = {
          role: 'user',
          content:
            `A step failed: ${failures.join('; ')}. Reflect on why it failed and revise your ` +
            `approach for the remaining plan before trying again.`,
        }
        conversation.push(reflection)
        newMessages.push(reflection)
      }
      if (policy.checkpointAfterTurn) await ctx.checkpoint?.(newMessages)
    }

    if (policy.exhaustion === 'emit_error') {
      ctx.emit({
        type: 'error',
        message: `Agent stopped: reached max iterations (${ctx.maxIterations}) without final answer`,
      })
      return { finalAssistantText, newMessages, usage }
    }

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
    for await (const event of closing.events) {
      if (ctx.signal?.aborted) return { finalAssistantText, newMessages, usage }
      if (event.kind === 'text_delta') ctx.emit({ type: 'token', delta: event.delta })
    }
    const assembled = await closing.done
    this.addUsage(usage, assembled.usage)
    finalAssistantText = assembled.text
    newMessages.push({ role: 'assistant', content: assembled.text })
    return { finalAssistantText, newMessages, usage }
  }

  private async execute(
    tool: ToolDefinition,
    input: unknown,
    ctx: StrategyContext,
    policy: ToolTurnPolicy,
  ): Promise<unknown> {
    let lastError: unknown
    for (let attempt = 0; attempt <= policy.toolRetries; attempt++) {
      try {
        return await tool.execute(input, ctx.ctx)
      } catch (error) {
        lastError = error
        if (attempt < policy.toolRetries) {
          await new Promise(resolve => setTimeout(resolve, policy.toolRetryBaseMs * (attempt + 1)))
        }
      }
    }
    throw lastError
  }

  private recordToolResult(
    ctx: StrategyContext,
    conversation: ChatMessage[],
    newMessages: ChatMessage[],
    id: string,
    payload: unknown,
    error?: string,
  ) {
    if (error) ctx.emit({ type: 'tool_result', id, ok: false, error })
    else ctx.emit({ type: 'tool_result', id, ok: true, result: payload })
    const message: ChatMessage = { role: 'tool', toolCallId: id, content: JSON.stringify(payload) }
    conversation.push(message)
    newMessages.push(message)
  }

  private addUsage(
    total: { promptTokens: number; completionTokens: number },
    report?: { promptTokens: number; completionTokens: number },
  ) {
    if (!report) return
    total.promptTokens += report.promptTokens
    total.completionTokens += report.completionTokens
  }
}
