import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRunner } from '../agents/runner/agent-runner'
import type { ProviderResolver } from '../agents/provider-resolver'
import { FakeChatProvider } from '../agents/testing/fake-chat-provider'
import { makeFakeTool, makeToolRegistryWith } from '../agents/testing/fake-tool'
import { RunEngine } from './run-engine'
import { RunLifecycle } from './run-lifecycle'
import type { Queue } from 'bullmq'
import type { RunJobPayload } from './run-queue'
import type { RunEventsService } from './run-events'
import { RunJournal } from './run-journal'

/**
 * Integration test at the RunEngine seam (queue + persistence boundary): a real
 * Postgres, the real AgentRunner, and a fake model provider. Proves the
 * plan→approve→execute lifecycle, durable resume, and interruption — no network,
 * no BullMQ worker.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip

/** A ProviderResolver that always returns the given (inspectable) provider. */
function resolverWith(provider: FakeChatProvider): ProviderResolver {
  return { resolve: () => ({ provider, model: 'fake-model' }) }
}

const queue = { add: async () => undefined } as unknown as Queue<RunJobPayload>
const events = { publish: async () => undefined } as unknown as RunEventsService

describeDb('RunEngine (integration — real Postgres)', () => {
  const prisma = new PrismaService()
  let userId = ''

  beforeAll(async () => {
    await prisma.$connect()
    const u = await prisma.user.create({ data: { email: `eng-${Date.now()}@test.local`, passwordHash: 'x' } })
    userId = u.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  async function newRun(goal: string) {
    const convo = await prisma.conversation.create({ data: { userId, title: goal.slice(0, 20) } })
    return prisma.run.create({ data: { userId, conversationId: convo.id, goal, status: 'planning' } })
  }

  function engine(runner: AgentRunner, resolver: ProviderResolver) {
    return new RunEngine(
      prisma,
      runner,
      resolver,
      new RunLifecycle(prisma, queue, events),
      new RunJournal(prisma),
    )
  }

  it('runs a goal to completion, persisting steps, transcript and result', async () => {
    const run = await newRun('use the tool then answer')
    const echo = makeFakeTool({ name: 'echo', result: { ok: true } })
    const runner = new AgentRunner(makeToolRegistryWith(echo))
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'echo', args: { v: 1 } }], finishReason: 'tool_calls' },
      { text: 'the answer', finishReason: 'stop' },
    ])
    const runEngine = engine(runner, resolverWith(provider))

    const emitted: SseEvent[] = []
    await runEngine.execute(run.id, e => emitted.push(e))

    const saved = await prisma.run.findUniqueOrThrow({
      where: { id: run.id },
      include: { steps: { orderBy: { seq: 'asc' } } },
    })
    expect(saved.status).toBe('done')
    expect((saved.result as { answer: string }).answer).toBe('the answer')
    expect(saved.steps.map(s => s.kind)).toEqual(['tool_call', 'tool_result', 'answer'])

    const statuses = emitted.filter(e => e.type === 'run_status').map(e => (e as { status: string }).status)
    expect(statuses).toEqual(['running', 'done'])

    const messages = await prisma.message.findMany({ where: { conversationId: saved.conversationId } })
    expect(messages.some(m => m.role === 'assistant' && m.content === 'the answer')).toBe(true)
  })

  it('proposes a plan and pauses in awaiting_approval', async () => {
    const run = await newRun('research then write')
    const runner = new AgentRunner(makeToolRegistryWith())
    const provider = new FakeChatProvider([{ text: '1. Research\n2. Write it up', finishReason: 'stop' }])
    const runEngine = engine(runner, resolverWith(provider))

    const emitted: SseEvent[] = []
    await runEngine.plan(run.id, e => emitted.push(e))

    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { plan: true } })
    expect(saved.status).toBe('awaiting_approval')
    expect((saved.plan?.steps as { description: string }[]).map(s => s.description)).toEqual([
      'Research',
      'Write it up',
    ])
    expect(emitted.some(e => e.type === 'plan_proposed')).toBe(true)
  })

  it('executes an approved plan to completion', async () => {
    const run = await newRun('do the approved work')
    await prisma.plan.create({
      data: { runId: run.id, steps: [{ index: 0, description: 'step one' }], approvedAt: new Date() },
    })
    const runner = new AgentRunner(makeToolRegistryWith())
    const provider = new FakeChatProvider([{ text: 'plan executed', finishReason: 'stop' }])
    const runEngine = engine(runner, resolverWith(provider))

    await runEngine.execute(run.id)

    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('done')
    expect((saved.result as { answer: string }).answer).toBe('plan executed')
  })

  it('resumes from the persisted transcript on a re-run', async () => {
    const run = await newRun('resume me')
    // Simulate a prior crashed attempt that left partial progress persisted.
    await prisma.message.create({
      data: { conversationId: run.conversationId, role: 'assistant', content: 'partial progress from earlier' },
    })
    const runner = new AgentRunner(makeToolRegistryWith())
    const provider = new FakeChatProvider([{ text: 'finished', finishReason: 'stop' }])
    const runEngine = engine(runner, resolverWith(provider))

    await runEngine.execute(run.id)

    // The prior progress was fed to the model as history (resume) ...
    expect(JSON.stringify(provider.calls[0]!.messages)).toMatch(/partial progress from earlier/)
    // ... and the run completed.
    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('done')
  })

  it('stops at a checkpoint and fails when interrupted', async () => {
    const run = await newRun('long running task')
    await prisma.run.update({ where: { id: run.id }, data: { interruptRequested: true } })
    const echo = makeFakeTool({ name: 'echo', result: { ok: true } })
    const runner = new AgentRunner(makeToolRegistryWith(echo))
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'echo', args: {} }], finishReason: 'tool_calls' },
      { text: 'should not be reached', finishReason: 'stop' },
    ])
    const runEngine = engine(runner, resolverWith(provider))

    await runEngine.execute(run.id)

    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('failed')
    expect(saved.error).toMatch(/interrupt/i)
    // The second turn was never consumed — execution stopped after the checkpoint.
    expect(provider.calls.length).toBe(1)
  })

  it('pauses at an approval checkpoint, then completes once approved', async () => {
    const run = await newRun('delete some stuff')
    const danger = makeFakeTool({ name: 'delete_all', requiresApproval: true, result: { ok: true } })
    const runner = new AgentRunner(makeToolRegistryWith(danger))
    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'delete_all', args: { x: 1 } }], finishReason: 'tool_calls' },
      { toolCalls: [{ id: 'c2', name: 'delete_all', args: { x: 1 } }], finishReason: 'tool_calls' },
      { text: 'deleted', finishReason: 'stop' },
    ])
    const runEngine = engine(runner, resolverWith(provider))

    // First pass pauses for approval — the tool has not run.
    const emitted: SseEvent[] = []
    await runEngine.execute(run.id, e => emitted.push(e))
    let saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('paused')
    expect(saved.pendingCheckpoint).toMatchObject({ name: 'delete_all' })
    expect(emitted.some(e => e.type === 'checkpoint_hit')).toBe(true)

    // Approve (record approval + resume) and re-run — now it executes to done.
    await prisma.run.update({ where: { id: run.id }, data: { checkpointsApproved: 1, status: 'running' } })
    await runEngine.execute(run.id)
    saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('done')
    expect((saved.result as { answer: string }).answer).toBe('deleted')
  })

  it('marks a Run failed when execution throws', async () => {
    const run = await newRun('this will fail')
    const runner = new AgentRunner(makeToolRegistryWith())
    const resolver: ProviderResolver = {
      resolve: () => {
        throw new Error('no provider configured')
      },
    }
    const runEngine = engine(runner, resolver)

    const emitted: SseEvent[] = []
    await runEngine.execute(run.id, e => emitted.push(e))

    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('failed')
    expect(saved.error).toMatch(/no provider configured/)
    expect(emitted.some(e => e.type === 'run_status' && e.status === 'failed')).toBe(true)
  })
})
