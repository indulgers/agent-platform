import type { ChatProviderName } from './llm/llm.interface'

/**
 * Static catalog of models the user can pick from the model dropdown.
 *
 * - `id` is the LLM-side identifier (what we send to the provider's API).
 * - `provider` decides which ChatProvider implementation handles the call.
 * - `costPer1M` is in USD per 1 000 000 tokens (input / output separately).
 *   Values are best-effort published pricing — update when providers change.
 * - `supportsVision` gates whether attachments-with-images surface a warning.
 *
 * To add a model, append an entry — that's the whole change.
 */

export interface ModelEntry {
  id: string
  provider: ChatProviderName
  displayName: string
  description: string
  supportsVision: boolean
  costPer1M: {
    input: number
    output: number
  }
}

export const MODEL_REGISTRY: readonly ModelEntry[] = [
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    description: 'Flagship OpenAI model · vision · tools',
    supportsVision: true,
    costPer1M: { input: 2.5, output: 10.0 },
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o mini',
    description: 'Cheap and fast · vision · tools',
    supportsVision: true,
    costPer1M: { input: 0.15, output: 0.6 },
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    description: 'Anthropic main · vision · long context',
    supportsVision: true,
    costPer1M: { input: 3.0, output: 15.0 },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    description: 'Cheap and fast · vision',
    supportsVision: true,
    costPer1M: { input: 0.8, output: 4.0 },
  },
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek V3',
    description: 'General-purpose · tools',
    supportsVision: false,
    costPer1M: { input: 0.27, output: 1.1 },
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    displayName: 'DeepSeek R1',
    description: 'Reasoning · no function calling',
    supportsVision: false,
    costPer1M: { input: 0.55, output: 2.19 },
  },
] as const

export function findModel(id: string | null | undefined): ModelEntry | undefined {
  if (!id) return undefined
  return MODEL_REGISTRY.find(m => m.id === id)
}

/** Cost for a single message given input / output token counts. Rounded to 5 decimals. */
export function calcCost(modelId: string, promptTokens: number, completionTokens: number): number {
  const m = findModel(modelId)
  if (!m) return 0
  const dollars = (promptTokens / 1_000_000) * m.costPer1M.input + (completionTokens / 1_000_000) * m.costPer1M.output
  return Math.round(dollars * 1e5) / 1e5
}
