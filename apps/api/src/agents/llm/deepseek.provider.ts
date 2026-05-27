import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import { OpenAIProvider } from './openai.provider'
import type { ChatProviderName } from './llm.interface'

/**
 * DeepSeek exposes an OpenAI-protocol-compatible endpoint: same /v1/chat/completions
 * shape, same tool-calling format, same streaming framing. So we just inherit
 * OpenAIProvider.stream() verbatim and only swap the underlying client config.
 *
 * Model names to use in env: `deepseek-chat` (general) or `deepseek-reasoner` (R1).
 */
@Injectable()
export class DeepSeekProvider extends OpenAIProvider {
  override readonly name: ChatProviderName = 'deepseek'

  protected override createClient(): OpenAI | null {
    if (!process.env.DEEPSEEK_API_KEY) return null
    return new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      // `||` (not `??`) so empty-string from docker-compose (`KEY=` lines)
      // also falls back to the default. `??` would let `""` through and the
      // OpenAI SDK would silently use it, hanging every request.
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    })
  }

  protected override get missingKeyMessage(): string {
    return 'DEEPSEEK_API_KEY not configured'
  }
}
