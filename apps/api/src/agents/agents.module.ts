import { Module } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AgentsController } from './agents.controller'
import { AgentRunner } from './runner/agent-runner'
import { OpenAIProvider } from './llm/openai.provider'
import { AnthropicProvider } from './llm/anthropic.provider'
import { DeepSeekProvider } from './llm/deepseek.provider'
import { ToolRegistry } from './tools'
import { ConversationsModule } from '../conversations/conversations.module'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [ConversationsModule, MemoryModule],
  providers: [AgentsService, AgentRunner, OpenAIProvider, AnthropicProvider, DeepSeekProvider, ToolRegistry],
  controllers: [AgentsController],
})
export class AgentsModule {}
