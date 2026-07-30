import { Logger } from '@nestjs/common'
import type { ChatMessage, ToolSpec } from '../llm/llm.interface'
import type {
  AgentStrategy,
  PlanDraft,
  PlanStepDraft,
  RunnerResult,
  StrategyContext,
} from './agent-strategy.interface'

const PLANNER_PROMPT = `You are a planner. Break the user's goal into a short ordered list of
concrete steps. Reply with ONLY a numbered list, one step per line, no preamble.`

/**
 * Plan → act → reflect. First propose an ordered plan (approved by the user
 * out-of-band). Then execute: stream text, call tools, and after any step whose
 * tool failed, inject a reflection so the model revises its approach on the next
 * iteration. Falls back to a final answer when the model stops.
 */
export class PlanActReflectStrategy implements AgentStrategy {
  readonly name = 'plan-act-reflect'
  private readonly logger = new Logger(PlanActReflectStrategy.name)

  async plan(ctx: StrategyContext): Promise<PlanDraft> {
    const { events, done } = ctx.provider.stream({
      model: ctx.model,
      messages: [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: ctx.userMessage },
      ],
      tools: [],
      maxTokens: ctx.maxTokens,
      signal: ctx.signal,
    })
    // Drain the stream so real providers resolve `done`.
    for await (const _ of events) void _
    const assembled = await done
    return { steps: parsePlan(assembled.text) }
  }

  async run(ctx: StrategyContext): Promise<RunnerResult> {
    const toolSpecs: ToolSpec[] = ctx.tools.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))

    const systemContent = ctx.plan
      ? `${ctx.systemPrompt}\n\nApproved plan:\n${renderPlan(ctx.plan.steps)}`
      : ctx.systemPrompt

    const userTurn: ChatMessage = { role: 'user', content: ctx.userMessage, attachments: ctx.userAttachments }
    const conversation: ChatMessage[] = [
      { role: 'system', content: systemContent },
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
        if (evt.kind === 'text_delta') ctx.emit({ type: 'token', delta: evt.delta })
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

      const failures: string[] = []
      for (const call of assembled.toolCalls) {
        ctx.emit({ type: 'tool_call', id: call.id, name: call.name, args: call.args })
        const tool = ctx.tools.get(call.name)
        if (!tool) {
          const error = `Unknown tool: ${call.name}`
          failures.push(`${call.name}: ${error}`)
          ctx.emit({ type: 'tool_result', id: call.id, ok: false, error })
          pushToolMessage(conversation, newMessages, call.id, { error })
          continue
        }
        try {
          const parsed = tool.schema.parse(call.args)
          const result = await tool.execute(parsed, ctx.ctx)
          ctx.emit({ type: 'tool_result', id: call.id, ok: true, result })
          pushToolMessage(conversation, newMessages, call.id, result)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          this.logger.warn(`Tool ${call.name} failed: ${error}`)
          failures.push(`${call.name}: ${error}`)
          ctx.emit({ type: 'tool_result', id: call.id, ok: false, error })
          pushToolMessage(conversation, newMessages, call.id, { error })
        }
      }

      // Reflect: when a step failed, prompt the model to revise before retrying.
      if (failures.length > 0) {
        const reflection: ChatMessage = {
          role: 'user',
          content:
            `A step failed: ${failures.join('; ')}. Reflect on why it failed and revise your ` +
            `approach for the remaining plan before trying again.`,
        }
        conversation.push(reflection)
        newMessages.push(reflection)
      }
    }

    ctx.emit({
      type: 'error',
      message: `Agent stopped: reached max iterations (${ctx.maxIterations}) without final answer`,
    })
    return { finalAssistantText, newMessages, usage }
  }
}

function pushToolMessage(
  conversation: ChatMessage[],
  newMessages: ChatMessage[],
  toolCallId: string,
  payload: unknown,
) {
  const toolMsg: ChatMessage = { role: 'tool', toolCallId, content: JSON.stringify(payload) }
  conversation.push(toolMsg)
  newMessages.push(toolMsg)
}

/** Parse a numbered/bulleted list into ordered plan steps. */
export function parsePlan(text: string): PlanStepDraft[] {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^(\d+[.)]|[-*])\s*/, '').trim())
    .filter(Boolean)
  const steps = lines.length > 0 ? lines : [text.trim()].filter(Boolean)
  return steps.map((description, index) => ({ index, description }))
}

function renderPlan(steps: PlanStepDraft[]): string {
  return steps.map(s => `${s.index + 1}. ${s.description}`).join('\n')
}
