import { Inject, Injectable, Logger } from '@nestjs/common'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRunner } from '../agents/runner/agent-runner'
import { PlanActReflectStrategy } from '../agents/runner/plan-act-reflect.strategy'
import { PROVIDER_RESOLVER, type ProviderResolver } from '../agents/provider-resolver'
import type {
  PlanDraft,
  PlanStepDraft,
  RunnerOptions,
} from '../agents/runner/agent-strategy.interface'
import { calcCost } from '../agents/models.registry'
import { toChatMessage } from '../agents/chat-message.mapper'
import type { ChatMessage } from '../agents/llm/llm.interface'
import { RunLifecycle } from './run-lifecycle'
import { RunJournal } from './run-journal'

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
    private readonly lifecycle: RunLifecycle,
    private readonly journals: RunJournal,
  ) {}

  /** Planning phase: propose a plan for the goal and pause for approval. */
  async plan(runId: string, emit: Emit = noop): Promise<void> {
    const run = await this.loadRun(runId)
    if (!run) return
    try {
      const draft = await this.runner.plan(this.optionsFor(run, emit), this.strategy)
      await this.lifecycle.apply({ type: 'planning_completed', runId, steps: draft.steps }, emit)
    } catch (err) {
      await this.fail(runId, err, emit)
    }
  }

  /** Execution phase: run the approved plan to completion. */
  async execute(runId: string, emit: Emit = noop): Promise<void> {
    const run = await this.loadRun(runId)
    if (!run) return
    if (run.status === 'done' || run.status === 'failed' || run.status === 'paused') return

    await this.lifecycle.apply({ type: 'execution_started', runId }, emit)

    const journal = this.journals.open({
      runId,
      conversationId: run.conversationId,
      emit,
    })

    const ac = new AbortController()

    try {
      const plan = run.plan ? { steps: run.plan.steps as unknown as PlanStepDraft[] } : undefined
      const options = this.optionsFor(run, journal.emit, plan)
      const model = options.model

      options.signal = ac.signal
      options.checkpoint = async msgs => {
        await journal.checkpoint(msgs)
        if (await this.interruptRequested(runId)) ac.abort()
      }

      // Approval checkpoints: proceed for those already approved this Run,
      // otherwise pause and wait for the approve-checkpoint endpoint.
      const approvedSoFar = run.checkpointsApproved
      let checkpointSeq = 0
      let paused = false
      options.requestCheckpoint = async call => {
        checkpointSeq++
        if (checkpointSeq <= approvedSoFar) return 'proceed'
        paused = true
        await this.lifecycle.apply({ type: 'checkpoint_paused', runId, call }, emit)
        return 'pause'
      }

      const result = await this.runner.run(options, this.strategy)

      if (paused) {
        // Persist audit steps only; the pending assistant/tool turn is replayed
        // (and executed) after approval. Status is already `paused`.
        await journal.flushSteps()
        return
      }

      await journal.finish(result.newMessages, result.finalAssistantText)

      if (ac.signal.aborted) {
        await this.lifecycle.apply({ type: 'failed', runId, error: 'Interrupted by user' }, emit)
        return
      }

      const usage = {
        model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        costUsd: calcCost(model, result.usage.promptTokens, result.usage.completionTokens),
      }
      await this.lifecycle.apply(
        {
          type: 'completed',
          runId,
          answer: result.finalAssistantText,
          usage,
        },
        emit,
      )
    } catch (err) {
      try {
        await journal.flushSteps()
      } catch (flushError) {
        this.logger.warn(`Run ${runId} step flush failed: ${String(flushError)}`)
      }
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
    run: {
      userId: string
      conversationId: string
      goal: string
      conversation: {
        model: string | null
        messages: { role: string; content: string; toolCalls: unknown; toolCallId: string | null }[]
      }
    },
    emit: Emit,
    plan?: PlanDraft,
  ): RunnerOptions {
    const { provider, model } = this.resolver.resolve(run.conversation.model)
    const history: ChatMessage[] = run.conversation.messages.map(toChatMessage)
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

  private async fail(runId: string, err: unknown, emit: Emit) {
    const message = err instanceof Error ? err.message : String(err)
    this.logger.error(`Run ${runId} failed: ${message}`)
    await this.lifecycle.apply({ type: 'failed', runId, error: message }, emit)
  }
}
