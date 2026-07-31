import { describe, it, expect } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { PlanActReflectStrategy } from './plan-act-reflect.strategy'
import type { PlanDraft, StrategyContext } from './agent-strategy.interface'
import { FakeChatProvider } from '../testing/fake-chat-provider'
import { makeFakeTool, makeToolRegistryWith } from '../testing/fake-tool'

function context(
  over: Partial<StrategyContext> & Pick<StrategyContext, 'provider' | 'tools'>,
): StrategyContext {
  return {
    model: 'fake-model',
    systemPrompt: 'you are a test agent',
    history: [],
    userMessage: 'achieve the goal',
    ctx: { userId: 'u1', conversationId: 'c1' },
    maxIterations: 8,
    maxTokens: 256,
    emit: () => {},
    ...over,
  }
}

describe('PlanActReflectStrategy', () => {
  it('plan() parses a numbered list into ordered steps', async () => {
    const provider = new FakeChatProvider([
      { text: '1. Search the web\n2. Summarise the findings', finishReason: 'stop' },
    ])
    const strategy = new PlanActReflectStrategy()

    const draft = await strategy.plan(context({ provider, tools: makeToolRegistryWith() }))

    expect(draft.steps.map(s => s.description)).toEqual(['Search the web', 'Summarise the findings'])
    expect(draft.steps.map(s => s.index)).toEqual([0, 1])
  })

  it('run() reflects and replans after a tool failure', async () => {
    const failing = makeFakeTool({ name: 'search', fail: 'network down' })
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'search', args: {} }], finishReason: 'tool_calls' },
      { text: 'recovered without the tool', finishReason: 'stop' },
    ])
    const strategy = new PlanActReflectStrategy()
    const plan: PlanDraft = { steps: [{ index: 0, description: 'use search' }] }
    const emitted: SseEvent[] = []

    const result = await strategy.run(
      context({ provider, tools: makeToolRegistryWith(failing), plan, emit: e => emitted.push(e) }),
    )

    // The failing tool surfaced as a failed result...
    expect(emitted.some(e => e.type === 'tool_result' && e.ok === false)).toBe(true)
    // ...and a reflection was injected into the follow-up model call.
    expect(provider.calls.length).toBe(2)
    expect(JSON.stringify(provider.calls[1]!.messages)).toMatch(/reflect/i)
    expect(result.finalAssistantText).toBe('recovered without the tool')
  })

  it('run() retries a transient tool failure before reporting the result', async () => {
    let toolCalls = 0
    const flaky = makeFakeTool({
      name: 'flaky',
      failTimes: 1,
      result: { ok: true },
      onCall: () => {
        toolCalls++
      },
    })
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'flaky', args: {} }], finishReason: 'tool_calls' },
      { text: 'succeeded', finishReason: 'stop' },
    ])
    const strategy = new PlanActReflectStrategy()
    const emitted: SseEvent[] = []

    const result = await strategy.run(
      context({ provider, tools: makeToolRegistryWith(flaky), emit: e => emitted.push(e) }),
    )

    // Failed once, retried, then succeeded — no failed tool_result surfaced.
    expect(toolCalls).toBe(2)
    const toolResults = emitted.filter(e => e.type === 'tool_result')
    expect(toolResults.length).toBe(1)
    expect(toolResults.every(e => e.type === 'tool_result' && e.ok)).toBe(true)
    expect(result.finalAssistantText).toBe('succeeded')
  })

  it('run() pauses before a tool that requires approval', async () => {
    let executed = false
    const danger = makeFakeTool({ name: 'delete_all', requiresApproval: true, onCall: () => { executed = true } })
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'delete_all', args: {} }], finishReason: 'tool_calls' },
    ])
    const strategy = new PlanActReflectStrategy()
    const emitted: SseEvent[] = []

    await strategy.run(
      context({
        provider,
        tools: makeToolRegistryWith(danger),
        emit: e => emitted.push(e),
        requestCheckpoint: async () => 'pause',
      }),
    )

    expect(executed).toBe(false)
    expect(emitted.some(e => e.type === 'tool_result')).toBe(false)
  })

  it('run() executes an approval-gated tool when the checkpoint proceeds', async () => {
    let executed = false
    const danger = makeFakeTool({
      name: 'delete_all',
      requiresApproval: true,
      result: { ok: true },
      onCall: () => { executed = true },
    })
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'delete_all', args: {} }], finishReason: 'tool_calls' },
      { text: 'deleted', finishReason: 'stop' },
    ])
    const strategy = new PlanActReflectStrategy()

    const result = await strategy.run(
      context({
        provider,
        tools: makeToolRegistryWith(danger),
        requestCheckpoint: async () => 'proceed',
      }),
    )

    expect(executed).toBe(true)
    expect(result.finalAssistantText).toBe('deleted')
  })

  it('run() injects the approved plan into the system prompt', async () => {
    const provider = new FakeChatProvider([{ text: 'done', finishReason: 'stop' }])
    const strategy = new PlanActReflectStrategy()
    const plan: PlanDraft = { steps: [{ index: 0, description: 'do the thing' }] }

    await strategy.run(context({ provider, tools: makeToolRegistryWith(), plan }))

    const system = provider.calls[0]!.messages.find(m => m.role === 'system')
    expect(system?.content).toMatch(/do the thing/)
  })
})
