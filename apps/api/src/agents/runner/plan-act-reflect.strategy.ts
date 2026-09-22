import type {
  AgentStrategy,
  PlanDraft,
  PlanStepDraft,
  RunnerResult,
  StrategyContext,
} from './agent-strategy.interface'
import { PLAN_ACT_REFLECT_TURN_POLICY, ToolTurnProgression } from './tool-turn-progression'

const PLANNER_PROMPT = `You are a planner. Break the user's goal into a short ordered list of
concrete steps. Reply with ONLY a numbered list, one step per line, no preamble.`

/** Plan, then apply retry/reflection/checkpoint policy to shared tool turns. */
export class PlanActReflectStrategy implements AgentStrategy {
  readonly name = 'plan-act-reflect'
  private readonly turns = new ToolTurnProgression()

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
    for await (const _ of events) void _
    const assembled = await done
    return { steps: parsePlan(assembled.text) }
  }

  run(ctx: StrategyContext): Promise<RunnerResult> {
    const systemContent = ctx.plan
      ? `${ctx.systemPrompt}\n\nApproved plan:\n${renderPlan(ctx.plan.steps)}`
      : ctx.systemPrompt
    return this.turns.run(ctx, systemContent, PLAN_ACT_REFLECT_TURN_POLICY)
  }
}

/** Parse a numbered/bulleted list into ordered plan steps. */
export function parsePlan(text: string): PlanStepDraft[] {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^(\d+[.)]|[-*])\s*/, '').trim())
    .filter(Boolean)
  const steps = lines.length > 0 ? lines : [text.trim()].filter(Boolean)
  return steps.map((description, index) => ({ index, description }))
}

function renderPlan(steps: PlanStepDraft[]): string {
  return steps.map(step => `${step.index + 1}. ${step.description}`).join('\n')
}
