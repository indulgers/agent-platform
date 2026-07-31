import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Prisma } from '@prisma/client'
import { Queue } from 'bullmq'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../conversations/conversations.service'
import { RUN_QUEUE, type RunJobPayload } from './run-queue'
import type { ApprovePlanInput, CreateRunInput } from '@agent-platform/shared'

/** How much of a goal to use as the auto-created conversation title. */
const TITLE_MAX_LEN = 48

/** Transient failures retry with exponential backoff before the Run is failed. */
const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 500,
}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    @InjectQueue(RUN_QUEUE) private readonly queue: Queue<RunJobPayload>,
  ) {}

  /**
   * Launch a Run for a goal. Reuses the supplied conversation (verifying
   * ownership) or starts a fresh one titled from the goal. The Run is created
   * in `planning` and enqueued for the planning phase; it pauses for approval
   * before it executes.
   */
  async create(userId: string, input: CreateRunInput) {
    let conversationId = input.conversationId
    if (conversationId) {
      await this.conversations.assertOwner(userId, conversationId)
    } else {
      const convo = await this.conversations.create(userId, input.goal.slice(0, TITLE_MAX_LEN))
      conversationId = convo.id
    }

    const run = await this.prisma.run.create({
      data: { userId, conversationId, goal: input.goal, status: 'planning' },
      include: { plan: true, steps: { orderBy: { seq: 'asc' } } },
    })
    await this.queue.add('plan', { runId: run.id }, JOB_OPTS)
    return run
  }

  /**
   * Approve (optionally editing) the proposed plan and start execution. Only the
   * owner of a Run awaiting approval may do this.
   */
  async approvePlan(userId: string, id: string, input: ApprovePlanInput) {
    const run = await this.get(userId, id)
    if (run.status !== 'awaiting_approval') {
      throw new BadRequestException(`Run is ${run.status}, not awaiting approval`)
    }
    const editedSteps = input.steps
    await this.prisma.plan.update({
      where: { runId: id },
      data: {
        approvedAt: new Date(),
        ...(editedSteps ? { steps: editedSteps as unknown as Prisma.InputJsonValue } : {}),
      },
    })
    await this.queue.add('execute', { runId: id }, JOB_OPTS)
    return this.get(userId, id)
  }

  /**
   * Request interruption of an in-flight Run. The engine stops at its next
   * checkpoint and marks the Run failed ("Interrupted by user"). No-op-safe on
   * Runs that have already finished.
   */
  async interrupt(userId: string, id: string) {
    const run = await this.get(userId, id)
    if (run.status === 'done' || run.status === 'failed') {
      throw new BadRequestException(`Run is already ${run.status}`)
    }
    await this.prisma.run.update({ where: { id }, data: { interruptRequested: true } })
    return this.get(userId, id)
  }

  /** A user's Runs, most-recently-updated first. */
  async list(userId: string) {
    return this.prisma.run.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        conversationId: true,
        goal: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  }

  /** A single Run with its plan + ordered step log. Owner-only. */
  async get(userId: string, id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: { plan: true, steps: { orderBy: { seq: 'asc' } } },
    })
    if (!run) throw new NotFoundException('Run not found')
    if (run.userId !== userId) throw new ForbiddenException('Not your run')
    return run
  }
}
