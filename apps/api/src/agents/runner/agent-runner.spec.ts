import { describe, it, expect } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { AgentRunner } from './agent-runner'
import { FakeChatProvider } from '../testing/fake-chat-provider'
import { makeFakeTool, makeToolRegistryWith } from '../testing/fake-tool'
import type { RunnerOptions } from './agent-runner'

/**
 * These tests exercise the real AgentRunner through the pre-agreed seam: the
 * ChatProvider interface. A scripted FakeChatProvider drives the loop with no
 * network, so agent behaviour is observable via the emitted SseEvents and the
 * returned result. This fixture is the foundation every later ticket builds on.
 */

function baseOptions(over: Partial<RunnerOptions>): RunnerOptions {
  const emitted: SseEvent[] = []
  return {
    provider: over.provider!,
    model: 'fake-model',
    systemPrompt: 'you are a test agent',
    history: [],
    userMessage: 'hi',
    ctx: { userId: 'u1', conversationId: 'c1' },
    maxIterations: 8,
    maxTokens: 256,
    emit: e => emitted.push(e),
    ...over,
  }
}

describe('AgentRunner (via ChatProvider seam)', () => {
  it('streams assistant text and returns the final answer when the model stops', async () => {
    const emitted: SseEvent[] = []
    const provider = new FakeChatProvider([
      { text: 'Hello world', finishReason: 'stop' },
    ])
    const runner = new AgentRunner(makeToolRegistryWith())

    const result = await runner.run(baseOptions({ provider, emit: e => emitted.push(e) }))

    const streamed = emitted
      .filter(e => e.type === 'token')
      .map(e => (e as { delta: string }).delta)
      .join('')
    expect(streamed).toBe('Hello world')
    expect(result.finalAssistantText).toBe('Hello world')
  })

  it('executes a scripted tool call and feeds the result back to the model', async () => {
    const emitted: SseEvent[] = []
    const calls: unknown[] = []
    const echo = makeFakeTool({
      name: 'echo',
      result: { ok: true },
      onCall: input => calls.push(input),
    })
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'call-1', name: 'echo', args: { v: 1 } }], finishReason: 'tool_calls' },
      { text: 'done', finishReason: 'stop' },
    ])
    const runner = new AgentRunner(makeToolRegistryWith(echo))

    const result = await runner.run(baseOptions({ provider, emit: e => emitted.push(e) }))

    const toolCall = emitted.find(e => e.type === 'tool_call') as { name: string } | undefined
    const toolResult = emitted.find(e => e.type === 'tool_result') as { ok: boolean } | undefined
    expect(toolCall?.name).toBe('echo')
    expect(toolResult?.ok).toBe(true)
    expect(calls).toEqual([{ v: 1 }])
    expect(result.finalAssistantText).toBe('done')
  })
})
