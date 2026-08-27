import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import type { PrismaService } from '../prisma/prisma.service'
import type { RunEventsService } from './run-events'
import type { RunJobPayload } from './run-queue'
import { RunLifecycle } from './run-lifecycle'

function harness(status = 'planning') {
  const prisma = {
    run: {
      findUnique: vi.fn().mockResolvedValue({ status }),
      update: vi.fn().mockResolvedValue({}),
    },
    plan: { upsert: vi.fn(), update: vi.fn() },
  } as unknown as PrismaService
  const queue = { add: vi.fn() } as unknown as Queue<RunJobPayload>
  const events = { publish: vi.fn() } as unknown as RunEventsService
  return { prisma, queue, events, lifecycle: new RunLifecycle(prisma, queue, events) }
}

describe('RunLifecycle', () => {
  it('persists and publishes the same status when planning completes', async () => {
    const { prisma, events, lifecycle } = harness('planning')

    await lifecycle.apply({
      type: 'planning_completed',
      runId: 'run-1',
      steps: [{ index: 0, description: 'Research' }],
    })

    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'awaiting_approval' },
    })
    expect(events.publish).toHaveBeenCalledWith('run-1', {
      type: 'run_status',
      runId: 'run-1',
      status: 'awaiting_approval',
    })
  })

  it('approves a paused checkpoint atomically before enqueueing execution', async () => {
    const { prisma, queue, lifecycle } = harness('paused')

    await lifecycle.apply({ type: 'checkpoint_resolved', runId: 'run-1', approved: true })

    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        checkpointsApproved: { increment: 1 },
        pendingCheckpoint: expect.anything(),
        status: 'running',
      },
    })
    expect(queue.add).toHaveBeenCalledWith('execute', { runId: 'run-1' }, expect.any(Object))
  })

  it('rejects illegal transitions before mutating persistence', async () => {
    const { prisma, lifecycle } = harness('done')

    await expect(
      lifecycle.apply({ type: 'execution_started', runId: 'run-1' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.run.update).not.toHaveBeenCalled()
  })

  it('only flags a running interruption and terminally fails an idle run', async () => {
    const running = harness('running')
    await running.lifecycle.apply({ type: 'interrupted', runId: 'run-1' })
    expect(running.prisma.run.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { interruptRequested: true },
    })
    expect(running.events.publish).not.toHaveBeenCalled()

    const paused = harness('paused')
    await paused.lifecycle.apply({ type: 'interrupted', runId: 'run-2' })
    expect(paused.prisma.run.update).toHaveBeenCalledWith({
      where: { id: 'run-2' },
      data: expect.objectContaining({ status: 'failed', error: 'Interrupted by user' }),
    })
    expect(paused.events.publish).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({ type: 'run_status', status: 'failed' }),
    )
  })
})
