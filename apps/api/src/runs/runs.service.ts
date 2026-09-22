import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../conversations/conversations.service'
import type { ApprovePlanInput, CreateRunInput } from '@agent-platform/shared'
import { RunLifecycle } from './run-lifecycle'

/** How much of a goal to use as the auto-created conversation title. */
const TITLE_MAX_LEN = 48

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly lifecycle: RunLifecycle,
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
    await this.lifecycle.apply({ type: 'created', runId: run.id })
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
    await this.lifecycle.apply({ type: 'plan_approved', runId: id, steps: input.steps })
    return this.get(userId, id)
  }

  /**
   * Stop a Run. A `running` Run is flagged so the engine unwinds at its next
   * checkpoint; a Run that isn't actively executing (`planning`,
   * `awaiting_approval`, `paused`) has no job to observe the flag, so it is
   * failed directly and live watchers are notified. No-op-safe on finished Runs.
   */
  async interrupt(userId: string, id: string) {
    const run = await this.get(userId, id)
    if (run.status === 'done' || run.status === 'failed') {
      throw new BadRequestException(`Run is already ${run.status}`)
    }
    await this.lifecycle.apply({ type: 'interrupted', runId: id })
    return this.get(userId, id)
  }

  /**
   * Resolve a paused approval checkpoint. Approving records the approval and
   * re-enqueues execution (which replays and now runs the approved step);
   * rejecting fails the Run.
   */
  async resolveCheckpoint(userId: string, id: string, approve: boolean) {
    const run = await this.get(userId, id)
    if (run.status !== 'paused') {
      throw new BadRequestException(`Run is ${run.status}, not paused`)
    }
    await this.lifecycle.apply({ type: 'checkpoint_resolved', runId: id, approved: approve })
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
