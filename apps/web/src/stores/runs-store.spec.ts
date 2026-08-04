import { describe, it, expect, beforeEach } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { useRunsStore } from './runs-store'

const feed = (events: SseEvent[]) => {
  for (const e of events) useRunsStore.getState().handleEvent(e)
}

describe('runs-store reducer', () => {
  beforeEach(() => useRunsStore.getState().reset())

  it('tracks run status and derives the pending action', () => {
    feed([{ type: 'run_status', runId: 'r1', status: 'awaiting_approval' }])
    expect(useRunsStore.getState().status).toBe('awaiting_approval')
    expect(useRunsStore.getState().pendingAction).toBe('plan')

    feed([{ type: 'run_status', runId: 'r1', status: 'running' }])
    expect(useRunsStore.getState().pendingAction).toBeNull()

    feed([{ type: 'run_status', runId: 'r1', status: 'paused' }])
    expect(useRunsStore.getState().pendingAction).toBe('checkpoint')

    feed([{ type: 'run_status', runId: 'r1', status: 'done' }])
    expect(useRunsStore.getState().status).toBe('done')
    expect(useRunsStore.getState().pendingAction).toBeNull()
  })

  it('captures a proposed plan', () => {
    feed([
      {
        type: 'plan_proposed',
        runId: 'r1',
        steps: [
          { index: 0, description: 'a' },
          { index: 1, description: 'b' },
        ],
      },
    ])
    expect(useRunsStore.getState().proposedSteps).toEqual([
      { index: 0, description: 'a' },
      { index: 1, description: 'b' },
    ])
  })

  it('records a checkpoint pause and clears it when running resumes', () => {
    feed([
      { type: 'checkpoint_hit', runId: 'r1', tool: 'sql_query', args: { q: 'DROP' } },
      { type: 'run_status', runId: 'r1', status: 'paused' },
    ])
    expect(useRunsStore.getState().checkpoint).toEqual({ tool: 'sql_query', args: { q: 'DROP' } })
    expect(useRunsStore.getState().pendingAction).toBe('checkpoint')

    feed([{ type: 'run_status', runId: 'r1', status: 'running' }])
    expect(useRunsStore.getState().checkpoint).toBeNull()
  })

  it('builds a tool timeline from call + result', () => {
    feed([
      { type: 'tool_call', id: 't1', name: 'http_fetch', args: { url: 'x' } },
      { type: 'tool_result', id: 't1', ok: true, result: { body: 'ok' } },
    ])
    const tools = useRunsStore.getState().tools
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ id: 't1', name: 'http_fetch', status: 'ok', result: { body: 'ok' } })
  })

  it('marks a failed tool result', () => {
    feed([
      { type: 'tool_call', id: 't1', name: 'http_fetch', args: {} },
      { type: 'tool_result', id: 't1', ok: false, error: 'boom' },
    ])
    expect(useRunsStore.getState().tools[0]).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('ignores a duplicate tool_call id (idempotent replay after checkpoint approval)', () => {
    feed([
      { type: 'tool_call', id: 't1', name: 'http_fetch', args: { url: 'x' } },
      { type: 'tool_call', id: 't1', name: 'http_fetch', args: { url: 'x' } },
    ])
    expect(useRunsStore.getState().tools).toHaveLength(1)
  })

  it('accumulates streaming answer tokens', () => {
    feed([
      { type: 'token', delta: 'Hel' },
      { type: 'token', delta: 'lo' },
    ])
    expect(useRunsStore.getState().answer).toBe('Hello')
  })

  it('hydrates from a durable snapshot', () => {
    useRunsStore.getState().loadSnapshot({
      id: 'r9',
      conversationId: 'c1',
      goal: 'do a thing',
      status: 'done',
      result: { answer: 'final text' },
      plan: { id: 'p1', steps: [{ index: 0, description: 'step' }] },
      steps: [
        { id: 's1', seq: 0, kind: 'tool_call', data: { type: 'tool_call', id: 't1', name: 'http_fetch', args: {} }, createdAt: '' },
        { id: 's2', seq: 1, kind: 'tool_result', data: { type: 'tool_result', id: 't1', ok: true, result: 42 }, createdAt: '' },
      ],
      createdAt: '',
      updatedAt: '',
    })
    const s = useRunsStore.getState()
    expect(s.runId).toBe('r9')
    expect(s.goal).toBe('do a thing')
    expect(s.status).toBe('done')
    expect(s.answer).toBe('final text')
    expect(s.proposedSteps).toEqual([{ index: 0, description: 'step' }])
    expect(s.tools).toHaveLength(1)
    expect(s.tools[0]).toMatchObject({ id: 't1', status: 'ok', result: 42 })
  })

  it('resets to a clean slate', () => {
    feed([
      { type: 'token', delta: 'x' },
      { type: 'run_status', runId: 'r1', status: 'running' },
    ])
    useRunsStore.getState().reset()
    const s = useRunsStore.getState()
    expect(s.status).toBeNull()
    expect(s.answer).toBe('')
    expect(s.tools).toEqual([])
  })
})
