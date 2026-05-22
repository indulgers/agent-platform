import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'
import { TaskProcessor } from './task.processor'
import { AGENT_QUEUE } from './queue'

@Module({
  imports: [BullModule.registerQueue({ name: AGENT_QUEUE })],
  providers: [TasksService, TaskProcessor],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
