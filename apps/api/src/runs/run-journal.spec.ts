import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../prisma/prisma.service'
import type { ChatMessage } from '../agents/llm/llm.interface'
import { RunJournal } from './run-journal'

function harness(existingSteps = 0) {
  const prisma = {
    message: { create: vi.fn().mockResolvedValue({}) },
    runStep: {
      count: vi.fn().mockResolvedValue(existingSteps),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService
  const emitted: unknown[] = []
  const journal = new RunJournal(prisma).open({
    runId: 'run-1',
    conversationId: 'conversation-1',
    emit: event => emitted.push(event),
  })
  return { prisma, emitted, journal }
}

describe('RunJournal', () => {
  it('persists only messages added after the user goal cursor', async () => {
    const { prisma, journal } = harness()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'working' },
      { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' },
    ]

    await journal.checkpoint(messages)
    await journal.checkpoint(messages)

    expect(prisma.message.create).toHaveBeenCalledTimes(2)
    expect(prisma.message.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'goal' }) }),
    )
  })

  it('replays tool facts in order without persisting transient tokens', async () => {
    const { prisma, emitted, journal } = harness(4)
    journal.emit({ type: 'token', delta: 'live only' })
    journal.emit({ type: 'tool_call', id: 'call-1', name: 'echo', args: { value: 1 } })
    journal.emit({ type: 'tool_result', id: 'call-1', ok: true, result: { echoed: 1 } })

    await journal.flushSteps()

    expect(emitted).toHaveLength(3)
    expect(prisma.runStep.create).toHaveBeenCalledTimes(2)
    expect(prisma.runStep.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ seq: 4, kind: 'tool_call' }) }),
    )
    expect(prisma.runStep.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ seq: 5, kind: 'tool_result' }) }),
    )
  })

  it('flushes replay events once and appends the final answer after them', async () => {
    const { prisma, journal } = harness()
    journal.emit({ type: 'tool_call', id: 'call-1', name: 'echo', args: {} })
    await journal.flushSteps()
    await journal.finish([{ role: 'user', content: 'goal' }], 'answer')

    expect(prisma.runStep.create).toHaveBeenCalledTimes(2)
    expect(prisma.runStep.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 1, kind: 'answer' }) }),
    )
  })

  it('retries the same event and sequence after a step write fails', async () => {
    const { prisma, journal } = harness(7)
    vi.mocked(prisma.runStep.create)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue({} as never)
    journal.emit({ type: 'tool_call', id: 'call-1', name: 'echo', args: {} })

    await expect(journal.flushSteps()).rejects.toThrow('database unavailable')
    await journal.flushSteps()

    expect(prisma.runStep.create).toHaveBeenCalledTimes(2)
    expect(prisma.runStep.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ seq: 7, kind: 'tool_call' }) }),
    )
  })
})
