import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../conversations/conversations.service'
import type { CreateRunInput } from '@agent-platform/shared'

/** How much of a goal to use as the auto-created conversation title. */
const TITLE_MAX_LEN = 48

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Launch a Run for a goal. Reuses the supplied conversation (verifying
   * ownership) or starts a fresh one titled from the goal. The Run is created
   * in `planning` with no plan and an empty step log — execution comes later.
   */
  async create(userId: string, input: CreateRunInput) {
    let conversationId = input.conversationId
    if (conversationId) {
      await this.conversations.assertOwner(userId, conversationId)
    } else {
      const convo = await this.conversations.create(userId, input.goal.slice(0, TITLE_MAX_LEN))
      conversationId = convo.id
    }

    return this.prisma.run.create({
      data: { userId, conversationId, goal: input.goal, status: 'planning' },
      include: { plan: true, steps: { orderBy: { seq: 'asc' } } },
    })
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
