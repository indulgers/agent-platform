import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Prisma } from '@prisma/client'
import { Queue } from 'bullmq'
import { PrismaService } from '../prisma/prisma.service'
import { AGENT_QUEUE, type AgentJobPayload } from './queue'

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AGENT_QUEUE) private readonly queue: Queue<AgentJobPayload>,
  ) {}

  async enqueue(args: { userId: string; type: string; payload: Record<string, unknown> }) {
    const task = await this.prisma.task.create({
      data: {
        userId: args.userId,
        type: args.type,
        payload: args.payload as Prisma.InputJsonValue,
        status: 'queued',
      },
    })
    await this.queue.add(args.type, { taskId: task.id, userId: args.userId, type: args.type, payload: args.payload })
    return task
  }

  async get(userId: string, id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } })
    if (!task) throw new NotFoundException('Task not found')
    if (task.userId !== userId) throw new ForbiddenException('Not your task')
    return task
  }
}
