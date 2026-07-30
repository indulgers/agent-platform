import { Injectable } from '@nestjs/common'
import type { ChatProvider } from './llm/llm.interface'
import { OpenAIProvider } from './llm/openai.provider'
import { AnthropicProvider } from './llm/anthropic.provider'
import { DeepSeekProvider } from './llm/deepseek.provider'
import { findModel } from './models.registry'
import { loadEnv } from '../config/env'

export interface ResolvedModel {
  provider: ChatProvider
  model: string
}

/**
 * Maps a conversation's model override (or the env default) to a concrete
 * provider + model id. Extracted as a seam so the RunEngine can be driven by a
 * fake provider in tests without touching real APIs.
 */
export interface ProviderResolver {
  resolve(modelOverride: string | null | undefined): ResolvedModel
}

/** DI token for ProviderResolver (an interface has no runtime token of its own). */
export const PROVIDER_RESOLVER = 'PROVIDER_RESOLVER'

@Injectable()
export class EnvProviderResolver implements ProviderResolver {
  private readonly env = loadEnv()

  constructor(
    private readonly openai: OpenAIProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly deepseek: DeepSeekProvider,
  ) {}

  resolve(modelOverride: string | null | undefined): ResolvedModel {
    const entry = findModel(modelOverride)
    if (entry) return { provider: this.byName(entry.provider), model: entry.id }
    return {
      provider: this.byName(this.env.LLM_DEFAULT_PROVIDER),
      model: this.env.LLM_DEFAULT_MODEL,
    }
  }

  private byName(name: string): ChatProvider {
    switch (name) {
      case 'openai':
        return this.openai
      case 'deepseek':
        return this.deepseek
      case 'anthropic':
      default:
        return this.anthropic
    }
  }
}
