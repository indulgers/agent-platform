import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Job } from 'bullmq'
import { PrismaService } from '../prisma/prisma.service'
import { AGENT_QUEUE, type AgentJobPayload } from './queue'

@Processor(AGENT_QUEUE)
export class TaskProcessor extends WorkerHost {
  private readonly logger = new Logger(TaskProcessor.name)

  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async process(job: Job<AgentJobPayload>): Promise<unknown> {
    const { taskId } = job.data
    await this.prisma.task.update({ where: { id: taskId }, data: { status: 'running' } })
    try {
      // Replace with real long-running work. For the skeleton: noop + record the payload.
      this.logger.log(`Running task ${taskId} of type ${job.data.type}`)
      const result = { echo: job.data.payload }
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: 'done', result: result as unknown as Prisma.InputJsonValue },
      })
      return result
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await this.prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error } })
      throw err
    }
  }
}
