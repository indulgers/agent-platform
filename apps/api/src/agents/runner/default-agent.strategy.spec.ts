import { describe, it, expect } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { DefaultAgentStrategy } from './default-agent.strategy'
import type { StrategyContext } from './agent-strategy.interface'
import { FakeChatProvider } from '../testing/fake-chat-provider'
import { makeFakeTool, makeToolRegistryWith } from '../testing/fake-tool'

/**
 * Exercises the DefaultAgentStrategy directly at the AgentStrategy seam, proving
 * the extracted strategy behaves identically to the loop it replaced.
 */
function context(over: Partial<StrategyContext> & Pick<StrategyContext, 'provider' | 'tools'>): StrategyContext {
  return {
    model: 'fake-model',
    systemPrompt: 'you are a test agent',
    history: [],
    userMessage: 'hi',
    ctx: { userId: 'u1', conversationId: 'c1' },
    maxIterations: 8,
    maxTokens: 256,
    emit: () => {},
    ...over,
  }
}

describe('DefaultAgentStrategy', () => {
  it('runs a tool call then returns the final answer', async () => {
    const emitted: SseEvent[] = []
    const echo = makeFakeTool({ name: 'echo', result: { ok: true } })
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'echo', args: { v: 1 } }], finishReason: 'tool_calls' },
      { text: 'final', finishReason: 'stop' },
    ])
    const strategy = new DefaultAgentStrategy()

    const result = await strategy.run(
      context({ provider, tools: makeToolRegistryWith(echo), emit: e => emitted.push(e) }),
    )

    expect(emitted.some(e => e.type === 'tool_call')).toBe(true)
    expect(emitted.some(e => e.type === 'tool_result' && e.ok === true)).toBe(true)
    expect(result.finalAssistantText).toBe('final')
  })
})
