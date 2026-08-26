import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Prisma, type RunStatus } from '@prisma/client'
import type { SseEvent } from '@agent-platform/shared'
import type { Queue } from 'bullmq'
import { PrismaService } from '../prisma/prisma.service'
import { RunEventsService } from './run-events'
import { RUN_QUEUE, type RunJobPayload } from './run-queue'
import type { PlanStepDraft } from '../agents/runner/agent-strategy.interface'

export const RUN_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 500,
}

export type RunLifecycleAction =
  | { type: 'created'; runId: string }
  | { type: 'planning_completed'; runId: string; steps: PlanStepDraft[] }
  | { type: 'plan_approved'; runId: string; steps?: PlanStepDraft[] }
  | { type: 'execution_started'; runId: string }
  | { type: 'checkpoint_paused'; runId: string; call: { name: string; args: unknown } }
  | { type: 'checkpoint_resolved'; runId: string; approved: boolean }
  | { type: 'interrupted'; runId: string }
  | { type: 'completed'; runId: string; answer: string; usage: Record<string, unknown> }
  | { type: 'failed'; runId: string; error: string }

type Emit = (event: SseEvent) => void | Promise<void>

/**
 * Owns every durable Run state transition and its matching live status event.
 * Callers describe facts with a discriminated action; this module enforces the
 * legal predecessor state and handles any queue hand-off implied by the fact.
 */
@Injectable()
export class RunLifecycle {
  private readonly logger = new Logger(RunLifecycle.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(RUN_QUEUE) private readonly queue: Queue<RunJobPayload>,
    private readonly events: RunEventsService,
  ) {}

  async apply(action: RunLifecycleAction, emit?: Emit): Promise<void> {
    if (action.type === 'created') {
      await this.queue.add('plan', { runId: action.runId }, RUN_JOB_OPTIONS)
      return
    }

    const current = await this.status(action.runId)
    switch (action.type) {
      case 'planning_completed':
        this.assert(current, ['planning'], action.type)
        await this.prisma.plan.upsert({
          where: { runId: action.runId },
          create: { runId: action.runId, steps: action.steps as unknown as Prisma.InputJsonValue },
          update: { steps: action.steps as unknown as Prisma.InputJsonValue, approvedAt: null },
        })
        await this.prisma.run.update({
          where: { id: action.runId },
          data: { status: 'awaiting_approval' },
        })
        await this.publish(action.runId, { type: 'plan_proposed', runId: action.runId, steps: action.steps }, emit)
        await this.publish(action.runId, {
          type: 'run_status',
          runId: action.runId,
          status: 'awaiting_approval',
        }, emit)
        return
      case 'plan_approved':
        this.assert(current, ['awaiting_approval'], action.type)
        await this.prisma.plan.update({
          where: { runId: action.runId },
          data: {
            approvedAt: new Date(),
            ...(action.steps ? { steps: action.steps as unknown as Prisma.InputJsonValue } : {}),
          },
        })
        await this.queue.add('execute', { runId: action.runId }, RUN_JOB_OPTIONS)
        return
      case 'execution_started':
        // `planning` remains valid for the queue-independent RunEngine seam;
        // production flow normally arrives from `awaiting_approval`.
        this.assert(current, ['planning', 'awaiting_approval', 'running'], action.type)
        await this.setStatus(action.runId, 'running', {}, emit)
        return
      case 'checkpoint_paused':
        this.assert(current, ['running'], action.type)
        await this.prisma.run.update({
          where: { id: action.runId },
          data: {
            status: 'paused',
            pendingCheckpoint: action.call as unknown as Prisma.InputJsonValue,
          },
        })
        await this.publish(action.runId, {
          type: 'checkpoint_hit',
          runId: action.runId,
          tool: action.call.name,
          args: action.call.args,
        }, emit)
        await this.publish(action.runId, {
          type: 'run_status',
          runId: action.runId,
          status: 'paused',
        }, emit)
        return
      case 'checkpoint_resolved':
        this.assert(current, ['paused'], action.type)
        if (action.approved) {
          await this.setStatus(action.runId, 'running', {
            checkpointsApproved: { increment: 1 },
            pendingCheckpoint: Prisma.JsonNull,
          }, emit)
          await this.queue.add('execute', { runId: action.runId }, RUN_JOB_OPTIONS)
        } else {
          await this.setStatus(action.runId, 'failed', {
            error: 'Checkpoint rejected by user',
            pendingCheckpoint: Prisma.JsonNull,
          }, emit)
        }
        return
      case 'interrupted':
        this.assert(current, ['planning', 'awaiting_approval', 'running', 'paused'], action.type)
        if (current === 'running') {
          await this.prisma.run.update({
            where: { id: action.runId },
            data: { interruptRequested: true },
          })
        } else {
          await this.setStatus(action.runId, 'failed', {
            error: 'Interrupted by user',
            interruptRequested: true,
            pendingCheckpoint: Prisma.JsonNull,
          }, emit)
        }
        return
      case 'completed':
        this.assert(current, ['running'], action.type)
        await this.setStatus(action.runId, 'done', {
          result: { answer: action.answer } as Prisma.InputJsonValue,
          usage: action.usage as Prisma.InputJsonValue,
        }, emit)
        return
      case 'failed':
        this.assert(current, ['planning', 'awaiting_approval', 'running', 'paused'], action.type)
        this.logger.error(`Run ${action.runId} failed: ${action.error}`)
        await this.setStatus(action.runId, 'failed', { error: action.error }, emit)
    }
  }

  private async status(runId: string): Promise<RunStatus> {
    const run = await this.prisma.run.findUnique({ where: { id: runId }, select: { status: true } })
    if (!run) throw new BadRequestException(`Run ${runId} does not exist`)
    return run.status
  }

  private assert(current: RunStatus, allowed: RunStatus[], action: RunLifecycleAction['type']) {
    if (!allowed.includes(current)) {
      throw new BadRequestException(`Cannot apply ${action} while Run is ${current}`)
    }
  }

  private async setStatus(
    runId: string,
    status: RunStatus,
    extra: Record<string, unknown>,
    emit?: Emit,
  ) {
    await this.prisma.run.update({ where: { id: runId }, data: { status, ...extra } })
    await this.publish(runId, { type: 'run_status', runId, status }, emit)
  }

  private async publish(runId: string, event: SseEvent, emit?: Emit) {
    if (emit) await emit(event)
    else await this.events.publish(runId, event)
  }
}
