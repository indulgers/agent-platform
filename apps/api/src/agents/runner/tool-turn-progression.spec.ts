import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { SseEvent } from '@agent-platform/shared'
import type { ToolDefinition } from '../tools/tool.interface'
import { FakeChatProvider } from '../testing/fake-chat-provider'
import { makeToolRegistryWith } from '../testing/fake-tool'
import type { StrategyContext } from './agent-strategy.interface'
import { DEFAULT_TURN_POLICY, ToolTurnProgression } from './tool-turn-progression'

function context(provider: FakeChatProvider, tools: ToolDefinition[], emitted: SseEvent[]): StrategyContext {
  return {
    provider,
    tools: makeToolRegistryWith(...tools),
    model: 'fake-model',
    systemPrompt: 'system',
    history: [],
    userMessage: 'goal',
    ctx: { userId: 'user-1', conversationId: 'conversation-1' },
    maxIterations: 3,
    maxTokens: 256,
    emit: event => emitted.push(event),
  }
}

describe('ToolTurnProgression', () => {
  it('transcribes unknown tools as failed tool messages for the next turn', async () => {
    const emitted: SseEvent[] = []
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'missing-1', name: 'missing', args: {} }], finishReason: 'tool_calls' },
      { text: 'recovered', finishReason: 'stop' },
    ])

    const result = await new ToolTurnProgression().run(
      context(provider, [], emitted),
      'system',
      DEFAULT_TURN_POLICY,
    )

    expect(result.finalAssistantText).toBe('recovered')
    expect(emitted).toContainEqual({
      type: 'tool_result',
      id: 'missing-1',
      ok: false,
      error: 'Unknown tool: missing',
    })
    expect(provider.calls[1]!.messages).toContainEqual({
      role: 'tool',
      toolCallId: 'missing-1',
      content: '{"error":"Unknown tool: missing"}',
    })
  })

  it('reports validation failures without executing the tool', async () => {
    let executions = 0
    const strictTool: ToolDefinition = {
      name: 'strict',
      description: 'strict input',
      schema: z.object({ value: z.string() }),
      parameters: { type: 'object' },
      execute: async () => { executions++; return {} },
    }
    const emitted: SseEvent[] = []
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'strict-1', name: 'strict', args: { value: 42 } }], finishReason: 'tool_calls' },
      { text: 'fixed', finishReason: 'stop' },
    ])

    await new ToolTurnProgression().run(
      context(provider, [strictTool], emitted),
      'system',
      DEFAULT_TURN_POLICY,
    )

    expect(executions).toBe(0)
    expect(emitted.some(event => event.type === 'tool_result' && !event.ok)).toBe(true)
  })

  it('records tool errors and accumulates usage across model turns', async () => {
    const failing: ToolDefinition = {
      name: 'failing',
      description: 'fails',
      schema: z.object({}),
      parameters: { type: 'object' },
      execute: async () => { throw new Error('remote failed') },
    }
    const provider = new FakeChatProvider([
      {
        toolCalls: [{ id: 'failure-1', name: 'failing', args: {} }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 10, completionTokens: 2 },
      },
      { text: 'fallback', finishReason: 'stop', usage: { promptTokens: 7, completionTokens: 3 } },
    ])

    const result = await new ToolTurnProgression().run(
      context(provider, [failing], []),
      'system',
      DEFAULT_TURN_POLICY,
    )

    expect(result.usage).toEqual({ promptTokens: 17, completionTokens: 5 })
    expect(result.newMessages).toContainEqual({
      role: 'tool',
      toolCallId: 'failure-1',
      content: '{"error":"remote failed"}',
    })
  })
})
