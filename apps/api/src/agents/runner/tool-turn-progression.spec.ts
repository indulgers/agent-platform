import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { SseEvent } from '@agent-platform/shared'
import type { ChatMessage } from '../llm/llm.interface'
import type { ToolDefinition } from '../tools/tool.interface'
import { FakeChatProvider } from '../testing/fake-chat-provider'
import { makeToolRegistryWith } from '../testing/fake-tool'
import type { StrategyContext } from './agent-strategy.interface'
import {
  DEFAULT_TURN_POLICY,
  PLAN_ACT_REFLECT_TURN_POLICY,
  ToolTurnProgression,
} from './tool-turn-progression'

function context(
  provider: FakeChatProvider,
  tools: ToolDefinition[],
  emitted: SseEvent[],
): StrategyContext {
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
  afterEach(() => vi.restoreAllMocks())

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
      execute: async () => {
        executions++
        return {}
      },
    }
    const emitted: SseEvent[] = []
    const provider = new FakeChatProvider([
      {
        toolCalls: [{ id: 'strict-1', name: 'strict', args: { value: 42 } }],
        finishReason: 'tool_calls',
      },
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
      execute: async () => {
        throw new Error('remote failed')
      },
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

  it('forwards the run AbortSignal to tool execution', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const tool: ToolDefinition = {
      name: 'observe_signal',
      description: 'records context',
      schema: z.object({}),
      parameters: { type: 'object' },
      execute: async (_input, toolContext) => {
        receivedSignal = toolContext.signal
        return { ok: true }
      },
    }
    const provider = new FakeChatProvider([
      {
        toolCalls: [{ id: 'signal-1', name: 'observe_signal', args: {} }],
        finishReason: 'tool_calls',
      },
      { text: 'done', finishReason: 'stop' },
    ])
    const ctx = context(provider, [tool], [])
    ctx.signal = controller.signal

    await new ToolTurnProgression().run(ctx, 'system', DEFAULT_TURN_POLICY)

    expect(receivedSignal).toBe(controller.signal)
  })

  it('stops the tool batch without retrying when a tool aborts the run', async () => {
    const controller = new AbortController()
    let abortedAttempts = 0
    let laterExecutions = 0
    const aborting: ToolDefinition = {
      name: 'aborting',
      description: 'aborts the run',
      schema: z.object({}),
      parameters: { type: 'object' },
      execute: async () => {
        abortedAttempts++
        controller.abort()
        throw new Error('request aborted')
      },
    }
    const later: ToolDefinition = {
      name: 'later',
      description: 'must not run after abort',
      schema: z.object({}),
      parameters: { type: 'object' },
      execute: async () => {
        laterExecutions++
        return { ok: true }
      },
    }
    const provider = new FakeChatProvider([
      {
        toolCalls: [
          { id: 'abort-1', name: 'aborting', args: {} },
          { id: 'later-1', name: 'later', args: {} },
        ],
        finishReason: 'tool_calls',
      },
    ])
    const emitted: SseEvent[] = []
    const ctx = context(provider, [aborting, later], emitted)
    ctx.signal = controller.signal

    await expect(
      new ToolTurnProgression().run(ctx, 'system', PLAN_ACT_REFLECT_TURN_POLICY),
    ).resolves.toMatchObject({ finalAssistantText: '' })

    expect(abortedAttempts).toBe(1)
    expect(laterExecutions).toBe(0)
    expect(emitted.some(event => event.type === 'tool_result')).toBe(false)
  })

  it('retries transient tool failures with policy backoff', async () => {
    const delays: number[] = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      delays.push(delay ?? 0)
      callback()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    let attempts = 0
    const tool: ToolDefinition = {
      name: 'flaky',
      description: 'fails twice',
      schema: z.object({}),
      parameters: { type: 'object' },
      execute: async () => {
        attempts++
        if (attempts < 3) throw new Error(`failure ${attempts}`)
        return { ok: true }
      },
    }
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'flaky-1', name: 'flaky', args: {} }], finishReason: 'tool_calls' },
      { text: 'recovered', finishReason: 'stop' },
    ])

    const result = await new ToolTurnProgression().run(
      context(provider, [tool], []),
      'system',
      PLAN_ACT_REFLECT_TURN_POLICY,
    )

    expect(result.finalAssistantText).toBe('recovered')
    expect(attempts).toBe(3)
    expect(delays).toEqual([50, 100])
  })

  it('pauses before an approval-gated tool and returns without executing it', async () => {
    let executions = 0
    const tool: ToolDefinition = {
      name: 'dangerous',
      description: 'requires approval',
      schema: z.object({}),
      parameters: { type: 'object' },
      requiresApproval: true,
      execute: async () => {
        executions++
        return { ok: true }
      },
    }
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'danger-1', name: 'dangerous', args: {} }], finishReason: 'tool_calls' },
    ])
    const ctx = context(provider, [tool], [])
    ctx.requestCheckpoint = async () => 'pause'

    const result = await new ToolTurnProgression().run(ctx, 'system', PLAN_ACT_REFLECT_TURN_POLICY)

    expect(executions).toBe(0)
    expect(provider.calls).toHaveLength(1)
    expect(result.newMessages.some(message => message.role === 'tool')).toBe(false)
  })

  it('adds a reflection message and checkpoints after a failed tool turn', async () => {
    const failing: ToolDefinition = {
      name: 'failing',
      description: 'always fails',
      schema: z.object({}),
      parameters: { type: 'object' },
      execute: async () => {
        throw new Error('remote failed')
      },
    }
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'failure-1', name: 'failing', args: {} }], finishReason: 'tool_calls' },
      { text: 'revised answer', finishReason: 'stop' },
    ])
    const ctx = context(provider, [failing], [])
    const checkpoints: ChatMessage[][] = []
    ctx.checkpoint = async messages => {
      checkpoints.push([...messages])
    }

    await new ToolTurnProgression().run(ctx, 'system', {
      ...PLAN_ACT_REFLECT_TURN_POLICY,
      toolRetries: 0,
    })

    expect(provider.calls[1]!.messages).toContainEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('Reflect on why it failed'),
      }),
    )
    expect(checkpoints).toHaveLength(1)
  })

  it('emits an error when the plan-act-reflect iteration budget is exhausted', async () => {
    const emitted: SseEvent[] = []
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'loop-1', name: 'missing', args: {} }], finishReason: 'tool_calls' },
    ])
    const ctx = context(provider, [], emitted)
    ctx.maxIterations = 1

    const result = await new ToolTurnProgression().run(ctx, 'system', PLAN_ACT_REFLECT_TURN_POLICY)

    expect(result.finalAssistantText).toBe('')
    expect(emitted).toContainEqual({
      type: 'error',
      message: 'Agent stopped: reached max iterations (1) without final answer',
    })
  })

  it('uses a tools-free closing turn for close-without-tools exhaustion', async () => {
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'loop-1', name: 'missing', args: {} }], finishReason: 'tool_calls' },
      { text: 'best available answer', finishReason: 'stop' },
    ])
    const ctx = context(provider, [], [])
    ctx.maxIterations = 1

    const result = await new ToolTurnProgression().run(ctx, 'system', {
      ...PLAN_ACT_REFLECT_TURN_POLICY,
      exhaustion: 'close_without_tools',
    })

    expect(result.finalAssistantText).toBe('best available answer')
    expect(provider.calls[1]!.tools).toEqual([])
    expect(provider.calls[1]!.messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('do not request more tools'),
    })
  })
})
