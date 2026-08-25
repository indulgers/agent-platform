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
import { McpService } from './mcp/mcp.service'
import { ConversationsModule } from '../conversations/conversations.module'
import { MemoryModule } from '../memory/memory.module'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConversationsModule, MemoryModule, ConnectorsModule],
  providers: [
    AgentsService,
    AgentRunner,
    OpenAIProvider,
    AnthropicProvider,
    DeepSeekProvider,
    ToolRegistry,
    McpService,
    EnvProviderResolver,
    { provide: PROVIDER_RESOLVER, useExisting: EnvProviderResolver },
  ],
  controllers: [AgentsController, ModelsController],
  // Exported so the RunEngine (runs module) can host agent runs.
  exports: [AgentRunner, PROVIDER_RESOLVER],
})
export class AgentsModule {}
