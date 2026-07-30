import { Module } from '@nestjs/common'
import { RunsService } from './runs.service'
import { RunsController } from './runs.controller'
import { ConversationsModule } from '../conversations/conversations.module'

@Module({
  imports: [ConversationsModule],
  providers: [RunsService],
  controllers: [RunsController],
  exports: [RunsService],
})
export class RunsModule {}
