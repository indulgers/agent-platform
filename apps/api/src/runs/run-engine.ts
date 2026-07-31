import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRunner } from '../agents/runner/agent-runner'
import { PlanActReflectStrategy } from '../agents/runner/plan-act-reflect.strategy'
import { PROVIDER_RESOLVER, type ProviderResolver } from '../agents/provider-resolver'
import type { PlanDraft, PlanStepDraft, RunnerOptions } from '../agents/runner/agent-strategy.interface'
import { calcCost } from '../agents/models.registry'
import type { AssistantToolCall, ChatMessage } from '../agents/llm/llm.interface'

const RUN_SYSTEM_PROMPT = `You are agent-platform, an autonomous task agent working toward a goal.
- Follow the approved plan, working in short steps. When unsure, call a tool rather than guess.
- Use the available tools; never invent tool results.
- When the goal is achieved, write a concise, direct final answer for the user.`

type Emit = (event: SseEvent) => void
const noop: Emit = () => {}

/**
 * Drives a durable Run through the plan→approve→execute lifecycle: propose a
 * plan (awaiting_approval), then — once approved — run the plan→act→reflect
 * strategy to completion, persisting the transcript + step log and recording the
 * terminal status/result. Independent of the queue so it is directly testable
 * against a real database with a fake model provider.
 */
@Injectable()
export class RunEngine {
  private readonly logger = new Logger(RunEngine.name)
  private readonly strategy = new PlanActReflectStrategy()
  // Agent loop limits — defaults mirror config/env; read directly so the engine
  // stays constructible in tests without the full env schema.
  private readonly maxIterations = Number(process.env.AGENT_MAX_ITERATIONS ?? 8)
  private readonly maxTokens = Number(process.env.AGENT_MAX_TOKENS ?? 4096)

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AgentRunner,
    @Inject(PROVIDER_RESOLVER) private readonly resolver: ProviderResolver,
  ) {}

  /** Planning phase: propose a plan for the goal and pause for approval. */
  async plan(runId: string, emit: Emit = noop): Promise<void> {
    const run = await this.loadRun(runId)
    if (!run) return
    try {
      const draft = await this.runner.plan(this.optionsFor(run, emit), this.strategy)
      await this.prisma.plan.upsert({
        where: { runId },
        create: { runId, steps: draft.steps as unknown as Prisma.InputJsonValue },
        update: { steps: draft.steps as unknown as Prisma.InputJsonValue, approvedAt: null },
      })
      await this.prisma.run.update({ where: { id: runId }, data: { status: 'awaiting_approval' } })
      emit({ type: 'plan_proposed', runId, steps: draft.steps })
      emit({ type: 'run_status', runId, status: 'awaiting_approval' })
    } catch (err) {
      await this.fail(runId, err, emit)
    }
  }

  /** Execution phase: run the approved plan to completion. */
  async execute(runId: string, emit: Emit = noop): Promise<void> {
    const run = await this.loadRun(runId)
    if (!run) return

    await this.transition(runId, 'running', emit)

    const events: SseEvent[] = []
    const collect: Emit = e => {
      events.push(e)
      emit(e)
    }

    const ac = new AbortController()

    try {
      const plan = run.plan ? { steps: run.plan.steps as unknown as PlanStepDraft[] } : undefined
      const options = this.optionsFor(run, collect, plan)
      const model = options.model

      // Persist the transcript incrementally so progress survives a crash, and
      // abort at the next checkpoint when an interrupt has been requested.
      // Index 0 of newMessages is the goal (userTurn), never a transcript row.
      let persisted = 1
      const persistDelta = async (msgs: ChatMessage[]) => {
        for (; persisted < msgs.length; persisted++) {
          await this.persistMessage(run.conversationId, msgs[persisted]!)
        }
      }
      options.signal = ac.signal
      options.checkpoint = async msgs => {
        await persistDelta(msgs)
        if (await this.interruptRequested(runId)) ac.abort()
      }

      const result = await this.runner.run(options, this.strategy)
      await persistDelta(result.newMessages)
      await this.appendSteps(runId, [
        ...toolSteps(events),
        { kind: 'answer', data: { text: result.finalAssistantText } },
      ])

      if (ac.signal.aborted) {
        await this.prisma.run.update({
          where: { id: runId },
          data: { status: 'failed', error: 'Interrupted by user' },
        })
        emit({ type: 'run_status', runId, status: 'failed' })
        return
      }

      const usage = {
        model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        costUsd: calcCost(model, result.usage.promptTokens, result.usage.completionTokens),
      }
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          status: 'done',
          result: { answer: result.finalAssistantText } as Prisma.InputJsonValue,
          usage: usage as unknown as Prisma.InputJsonValue,
        },
      })
      emit({ type: 'run_status', runId, status: 'done' })
    } catch (err) {
      await this.appendSteps(runId, toolSteps(events))
      await this.fail(runId, err, emit)
    }
  }

  private interruptRequested(runId: string): Promise<boolean> {
    return this.prisma.run
      .findUnique({ where: { id: runId }, select: { interruptRequested: true } })
      .then(r => !!r?.interruptRequested)
  }

  private loadRun(runId: string) {
    return this.prisma.run
      .findUnique({
        where: { id: runId },
        include: {
          plan: true,
          conversation: { include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } } },
        },
      })
      .then(run => {
        if (!run) this.logger.warn(`Run ${runId} not found; skipping`)
        return run
      })
  }

  private optionsFor(
    run: { userId: string; conversationId: string; goal: string; conversation: { model: string | null; messages: { role: string; content: string; toolCalls: unknown; toolCallId: string | null }[] } },
    emit: Emit,
    plan?: PlanDraft,
  ): RunnerOptions {
    const { provider, model } = this.resolver.resolve(run.conversation.model)
    const history: ChatMessage[] = run.conversation.messages.map(m => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
      toolCalls: (m.toolCalls as unknown as AssistantToolCall[] | null) ?? undefined,
      toolCallId: m.toolCallId ?? undefined,
    }))
    return {
      provider,
      model,
      systemPrompt: RUN_SYSTEM_PROMPT,
      history,
      userMessage: run.goal,
      plan,
      ctx: { userId: run.userId, conversationId: run.conversationId },
      maxIterations: this.maxIterations,
      maxTokens: this.maxTokens,
      emit,
    }
  }

  private async transition(runId: string, status: 'running', emit: Emit) {
    await this.prisma.run.update({ where: { id: runId }, data: { status } })
    emit({ type: 'run_status', runId, status })
  }

  private async fail(runId: string, err: unknown, emit: Emit) {
    const message = err instanceof Error ? err.message : String(err)
    this.logger.error(`Run ${runId} failed: ${message}`)
    await this.prisma.run.update({ where: { id: runId }, data: { status: 'failed', error: message } })
    emit({ type: 'run_status', runId, status: 'failed' })
  }

  private async persistMessage(conversationId: string, m: ChatMessage) {
    await this.prisma.message.create({
      data: {
        conversationId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ? (m.toolCalls as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        toolCallId: m.toolCallId ?? null,
      },
    })
  }

  private async appendSteps(runId: string, steps: { kind: string; data: unknown }[]) {
    let seq = await this.prisma.runStep.count({ where: { runId } })
    for (const step of steps) {
      await this.prisma.runStep.create({
        data: { runId, seq: seq++, kind: step.kind, data: step.data as Prisma.InputJsonValue },
      })
    }
  }
}

/** The significant, replay-worthy events from a run, as ordered step records. */
function toolSteps(events: SseEvent[]): { kind: string; data: unknown }[] {
  return events
    .filter(e => e.type === 'tool_call' || e.type === 'tool_result')
    .map(e => ({ kind: e.type, data: e }))
}
