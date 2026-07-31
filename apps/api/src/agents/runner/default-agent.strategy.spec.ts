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

  it('still returns a final answer when the tool budget is exhausted', async () => {
    const emitted: SseEvent[] = []
    const echo = makeFakeTool({ name: 'echo', result: { ok: true } })
    // Every in-loop turn calls a tool (never stops); the closing tools-off call
    // produces the answer.
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'echo', args: {} }], finishReason: 'tool_calls' },
      { toolCalls: [{ id: 'c2', name: 'echo', args: {} }], finishReason: 'tool_calls' },
      { text: 'here is my best answer', finishReason: 'stop' },
    ])
    const strategy = new DefaultAgentStrategy()

    const result = await strategy.run(
      context({ provider, tools: makeToolRegistryWith(echo), maxIterations: 2, emit: e => emitted.push(e) }),
    )

    expect(result.finalAssistantText).toBe('here is my best answer')
    // The closing call runs with no tools.
    expect(provider.calls[provider.calls.length - 1]!.tools).toEqual([])
    // No bare "reached max iterations" error surfaced to the user.
    expect(emitted.some(e => e.type === 'error')).toBe(false)
  })
})
