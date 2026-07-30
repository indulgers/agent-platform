import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRunner } from '../agents/runner/agent-runner'
import { PROVIDER_RESOLVER, type ProviderResolver } from '../agents/provider-resolver'
import { calcCost } from '../agents/models.registry'
import type { AssistantToolCall, ChatMessage } from '../agents/llm/llm.interface'

const RUN_SYSTEM_PROMPT = `You are agent-platform, an autonomous task agent working toward a goal.
- Work in short steps. When unsure, call a tool rather than guess.
- Use the available tools; never invent tool results.
- When the goal is achieved, write a concise, direct final answer for the user.`

type Emit = (event: SseEvent) => void
const noop: Emit = () => {}

/**
 * Executes a durable Run to completion: resolve the model, drive the agent
 * strategy toward the Run's goal, persist the transcript + step log, and record
 * the terminal status/result. Independent of the queue so it is directly
 * testable against a real database with a fake model provider.
 */
@Injectable()
export class RunEngine {
  private readonly logger = new Logger(RunEngine.name)
  // Agent loop limits — defaults mirror config/env; read directly so the engine
  // stays constructible in tests without the full env schema.
  private readonly maxIterations = Number(process.env.AGENT_MAX_ITERATIONS ?? 8)
  private readonly maxTokens = Number(process.env.AGENT_MAX_TOKENS ?? 4096)

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AgentRunner,
    @Inject(PROVIDER_RESOLVER) private readonly resolver: ProviderResolver,
  ) {}

  async execute(runId: string, emit: Emit = noop): Promise<void> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: {
        conversation: { include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } } },
      },
    })
    if (!run) {
      this.logger.warn(`Run ${runId} not found; skipping`)
      return
    }

    await this.transition(runId, 'running', emit)

    const events: SseEvent[] = []
    const collect: Emit = e => {
      events.push(e)
      emit(e)
    }

    try {
      const { provider, model } = this.resolver.resolve(run.conversation.model)
      const history: ChatMessage[] = run.conversation.messages.map(m => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
        toolCalls: (m.toolCalls as unknown as AssistantToolCall[] | null) ?? undefined,
        toolCallId: m.toolCallId ?? undefined,
      }))

      const result = await this.runner.run({
        provider,
        model,
        systemPrompt: RUN_SYSTEM_PROMPT,
        history,
        userMessage: run.goal,
        ctx: { userId: run.userId, conversationId: run.conversationId },
        maxIterations: this.maxIterations,
        maxTokens: this.maxTokens,
        emit: collect,
      })

      await this.persistTranscript(run.conversationId, result.newMessages.slice(1))
      await this.appendSteps(runId, [
        ...toolSteps(events),
        { kind: 'answer', data: { text: result.finalAssistantText } },
      ])

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
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`Run ${runId} failed: ${message}`)
      await this.appendSteps(runId, toolSteps(events))
      await this.prisma.run.update({ where: { id: runId }, data: { status: 'failed', error: message } })
      emit({ type: 'run_status', runId, status: 'failed' })
    }
  }

  private async transition(runId: string, status: 'running', emit: Emit) {
    await this.prisma.run.update({ where: { id: runId }, data: { status } })
    emit({ type: 'run_status', runId, status })
  }

  private async persistTranscript(conversationId: string, messages: ChatMessage[]) {
    for (const m of messages) {
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
