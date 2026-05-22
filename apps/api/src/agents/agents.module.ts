import { Module } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AgentsController } from './agents.controller'
import { AgentRunner } from './runner/agent-runner'
import { OpenAIProvider } from './llm/openai.provider'
import { AnthropicProvider } from './llm/anthropic.provider'
import { ToolRegistry } from './tools'
import { ConversationsModule } from '../conversations/conversations.module'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [ConversationsModule, MemoryModule],
  providers: [AgentsService, AgentRunner, OpenAIProvider, AnthropicProvider, ToolRegistry],
  controllers: [AgentsController],
})
export class AgentsModule {}
