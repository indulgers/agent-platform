import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import type { SseEvent } from '@agent-platform/shared'
import { RunEngine } from './run-engine'
import { RunEventsService } from './run-events'
import { RUN_QUEUE, type RunJobPayload } from './run-queue'

/**
 * BullMQ worker that drives durable Runs. Thin glue: the real work lives in
 * RunEngine so it stays testable without a queue. Live SseEvents produced by the
 * engine are published to Redis so subscribers on any replica can watch.
 */
@Processor(RUN_QUEUE)
export class RunProcessor extends WorkerHost {
  private readonly logger = new Logger(RunProcessor.name)

  constructor(
    private readonly engine: RunEngine,
    private readonly events: RunEventsService,
  ) {
    super()
  }

  async process(job: Job<RunJobPayload>): Promise<void> {
    this.logger.log(`Run ${job.data.runId}: ${job.name}`)
    const emit = (event: SseEvent) => {
      void this.events.publish(job.data.runId, event)
    }
    if (job.name === 'plan') {
      await this.engine.plan(job.data.runId, emit)
    } else {
      await this.engine.execute(job.data.runId, emit)
    }
  }
}
