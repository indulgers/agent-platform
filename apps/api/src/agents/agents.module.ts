import { Module } from '@nestjs/common'
import { AgentsService } from './agents.service'
import { AgentsController } from './agents.controller'
import { ModelsController } from './models.controller'
import { AgentRunner } from './runner/agent-runner'
import { OpenAIProvider } from './llm/openai.provider'
import { AnthropicProvider } from './llm/anthropic.provider'
import { DeepSeekProvider } from './llm/deepseek.provider'
import { ToolRegistry } from './tools'
import { EnvProviderResolver, PROVIDER_RESOLVER } from './provider-resolver'
import { ConversationsModule } from '../conversations/conversations.module'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [ConversationsModule, MemoryModule],
  providers: [
    AgentsService,
    AgentRunner,
    OpenAIProvider,
    AnthropicProvider,
    DeepSeekProvider,
    ToolRegistry,
    EnvProviderResolver,
    { provide: PROVIDER_RESOLVER, useExisting: EnvProviderResolver },
  ],
  controllers: [AgentsController, ModelsController],
  // Exported so the RunEngine (runs module) can host agent runs.
  exports: [AgentRunner, PROVIDER_RESOLVER],
})
export class AgentsModule {}
