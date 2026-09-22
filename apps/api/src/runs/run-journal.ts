import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { SseEvent } from '@agent-platform/shared'
import type { ChatMessage } from '../agents/llm/llm.interface'
import { PrismaService } from '../prisma/prisma.service'

type Emit = (event: SseEvent) => void

/** Factory for per-execution journals; the returned session owns all cursors. */
@Injectable()
export class RunJournal {
  constructor(private readonly prisma: PrismaService) {}

  open(input: { runId: string; conversationId: string; emit: Emit }): RunJournalSession {
    return new RunJournalSession(this.prisma, input.runId, input.conversationId, input.emit)
  }
}

/**
 * Incrementally records durable conversation and replay facts for one engine
 * invocation while forwarding every event (including transient tokens) live.
 */
export class RunJournalSession {
  private readonly replayEvents: SseEvent[] = []
  private persistedMessages = 1
  private flushedEvents = 0
  private nextStep: number | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly runId: string,
    private readonly conversationId: string,
    private readonly forward: Emit,
  ) {}

  emit = (event: SseEvent): void => {
    if (event.type === 'tool_call' || event.type === 'tool_result') {
      this.replayEvents.push(event)
    }
    this.forward(event)
  }

  async checkpoint(messages: ChatMessage[]): Promise<void> {
    for (; this.persistedMessages < messages.length; this.persistedMessages++) {
      const message = messages[this.persistedMessages]!
      await this.prisma.message.create({
        data: {
          conversationId: this.conversationId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls
            ? (message.toolCalls as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          toolCallId: message.toolCallId ?? null,
        },
      })
    }
  }

  /** Flushes only replay-worthy events; safe to call again during unwinding. */
  async flushSteps(): Promise<void> {
    while (this.flushedEvents < this.replayEvents.length) {
      const event = this.replayEvents[this.flushedEvents]!
      await this.append(event.type, event)
      this.flushedEvents++
    }
  }

  async finish(messages: ChatMessage[], answer: string): Promise<void> {
    await this.checkpoint(messages)
    await this.flushSteps()
    await this.append('answer', { text: answer })
  }

  private async append(kind: string, data: unknown) {
    if (this.nextStep === undefined) {
      this.nextStep = await this.prisma.runStep.count({ where: { runId: this.runId } })
    }
    await this.prisma.runStep.create({
      data: {
        runId: this.runId,
        seq: this.nextStep,
        kind,
        data: data as Prisma.InputJsonValue,
      },
    })
    this.nextStep++
  }
}
