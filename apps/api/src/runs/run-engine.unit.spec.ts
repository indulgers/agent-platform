import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRunner } from '../agents/runner/agent-runner'
import type { ProviderResolver } from '../agents/provider-resolver'
import type { PrismaService } from '../prisma/prisma.service'
import { RunEngine } from './run-engine'
import type { RunJournal } from './run-journal'
import type { RunLifecycle } from './run-lifecycle'

function harness(status: 'planning' | 'paused' | 'done' | 'failed') {
  const run = {
    id: 'run-1',
    status,
    userId: 'user-1',
    conversationId: 'conversation-1',
    goal: 'finish the work',
    checkpointsApproved: 0,
    plan: null,
    conversation: { model: null, messages: [] },
  }
  const prisma = {
    run: { findUnique: vi.fn().mockResolvedValue(run) },
  } as unknown as PrismaService
  const runner = {
    run: vi.fn().mockResolvedValue({
      finalAssistantText: 'done',
      newMessages: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    }),
  } as unknown as AgentRunner
  const resolver = {
    resolve: vi.fn().mockReturnValue({ provider: {}, model: 'fake-model' }),
  } as unknown as ProviderResolver
  const lifecycle = { apply: vi.fn().mockResolvedValue(undefined) } as unknown as RunLifecycle
  const session = {
    emit: vi.fn(),
    checkpoint: vi.fn().mockResolvedValue(undefined),
    flushSteps: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined),
  }
  const journals = { open: vi.fn().mockReturnValue(session) } as unknown as RunJournal
  return {
    runner,
    lifecycle,
    journals,
    session,
    engine: new RunEngine(prisma, runner, resolver, lifecycle, journals),
  }
}

describe('RunEngine execution reliability', () => {
  it.each(['done', 'failed', 'paused'] as const)(
    'ignores a duplicate execute job for a %s Run',
    async status => {
      const { runner, lifecycle, journals, engine } = harness(status)

      await engine.execute('run-1')

      expect(lifecycle.apply).not.toHaveBeenCalled()
      expect(journals.open).not.toHaveBeenCalled()
      expect(runner.run).not.toHaveBeenCalled()
    },
  )

  it('still records the original failure when flushing journal steps also fails', async () => {
    const { runner, lifecycle, session, engine } = harness('planning')
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    vi.mocked(runner.run).mockRejectedValue(new Error('provider unavailable'))
    vi.mocked(session.flushSteps).mockRejectedValue(new Error('database unavailable during flush'))

    await expect(engine.execute('run-1')).resolves.toBeUndefined()

    expect(lifecycle.apply).toHaveBeenLastCalledWith(
      {
        type: 'failed',
        runId: 'run-1',
        error: 'provider unavailable',
      },
      expect.any(Function),
    )
    expect(warn).toHaveBeenCalledWith(
      'Run run-1 step flush failed: Error: database unavailable during flush',
    )
  })
})
