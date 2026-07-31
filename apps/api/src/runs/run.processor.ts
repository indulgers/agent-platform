import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { RunEngine } from './run-engine'
import { RUN_QUEUE, type RunJobPayload } from './run-queue'

/**
 * BullMQ worker that drives durable Runs. Thin glue: the real work lives in
 * RunEngine so it stays testable without a queue.
 */
@Processor(RUN_QUEUE)
export class RunProcessor extends WorkerHost {
  private readonly logger = new Logger(RunProcessor.name)

  constructor(private readonly engine: RunEngine) {
    super()
  }

  async process(job: Job<RunJobPayload>): Promise<void> {
    this.logger.log(`Run ${job.data.runId}: ${job.name}`)
    if (job.name === 'plan') {
      await this.engine.plan(job.data.runId)
    } else {
      await this.engine.execute(job.data.runId)
    }
  }
}
