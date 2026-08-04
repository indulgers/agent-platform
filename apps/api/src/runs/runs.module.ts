import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { RunsService } from './runs.service'
import { RunsController } from './runs.controller'
import { RunEngine } from './run-engine'
import { RunProcessor } from './run.processor'
import { RunEventsService } from './run-events'
import { RUN_QUEUE } from './run-queue'
import { ConversationsModule } from '../conversations/conversations.module'
import { AgentsModule } from '../agents/agents.module'

@Module({
  imports: [BullModule.registerQueue({ name: RUN_QUEUE }), ConversationsModule, AgentsModule],
  providers: [RunsService, RunEngine, RunProcessor, RunEventsService],
  controllers: [RunsController],
  exports: [RunsService],
})
export class RunsModule {}
