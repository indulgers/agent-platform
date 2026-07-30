import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentRunner } from '../agents/runner/agent-runner'
import type { ProviderResolver } from '../agents/provider-resolver'
import { FakeChatProvider, type FakeTurn } from '../agents/testing/fake-chat-provider'
import { makeFakeTool, makeToolRegistryWith } from '../agents/testing/fake-tool'
import { RunEngine } from './run-engine'

/**
 * Integration test at the RunEngine seam (queue + persistence boundary): a real
 * Postgres, the real AgentRunner, and a fake model provider. Proves a Run
 * executes to completion, persists its step log + transcript, and records the
 * terminal status/result — no network, no BullMQ worker.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip

/** A ProviderResolver that always returns a scripted FakeChatProvider. */
function fakeResolver(turns: FakeTurn[]): ProviderResolver {
  return { resolve: () => ({ provider: new FakeChatProvider(turns), model: 'fake-model' }) }
}

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

  it('runs a goal to completion, persisting steps, transcript and result', async () => {
    const run = await newRun('use the tool then answer')
    const echo = makeFakeTool({ name: 'echo', result: { ok: true } })
    const runner = new AgentRunner(makeToolRegistryWith(echo))
    const resolver = fakeResolver([
      { toolCalls: [{ id: 'c1', name: 'echo', args: { v: 1 } }], finishReason: 'tool_calls' },
      { text: 'the answer', finishReason: 'stop' },
    ])
    const engine = new RunEngine(prisma, runner, resolver)

    const emitted: SseEvent[] = []
    await engine.execute(run.id, e => emitted.push(e))

    const saved = await prisma.run.findUniqueOrThrow({
      where: { id: run.id },
      include: { steps: { orderBy: { seq: 'asc' } } },
    })
    expect(saved.status).toBe('done')
    expect((saved.result as { answer: string }).answer).toBe('the answer')
    // A tool_call + tool_result + a final answer step were persisted, in order.
    expect(saved.steps.map(s => s.kind)).toEqual(['tool_call', 'tool_result', 'answer'])

    // run_status streamed running -> done.
    const statuses = emitted.filter(e => e.type === 'run_status').map(e => (e as { status: string }).status)
    expect(statuses).toEqual(['running', 'done'])

    // The assistant answer landed in the conversation transcript.
    const messages = await prisma.message.findMany({ where: { conversationId: saved.conversationId } })
    expect(messages.some(m => m.role === 'assistant' && m.content === 'the answer')).toBe(true)
  })

  it('marks a Run failed when execution throws', async () => {
    const run = await newRun('this will fail')
    const runner = new AgentRunner(makeToolRegistryWith())
    const resolver: ProviderResolver = {
      resolve: () => {
        throw new Error('no provider configured')
      },
    }
    const engine = new RunEngine(prisma, runner, resolver)

    const emitted: SseEvent[] = []
    await engine.execute(run.id, e => emitted.push(e))

    const saved = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('failed')
    expect(saved.error).toMatch(/no provider configured/)
    expect(emitted.some(e => e.type === 'run_status' && e.status === 'failed')).toBe(true)
  })
})
