import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Queue } from 'bullmq'
import { PrismaService } from '../prisma/prisma.service'
import { ConversationsService } from '../conversations/conversations.service'
import { RunsService } from './runs.service'
import type { RunEventsService } from './run-events'
import type { RunJobPayload } from './run-queue'
import { RunLifecycle } from './run-lifecycle'

/** No-op queue — these tests exercise persistence/ownership, not job execution. */
const stubQueue = { add: async () => undefined } as unknown as Queue<RunJobPayload>
/** No-op event bridge — no Redis in these tests. */
const stubEvents = { publish: async () => undefined } as unknown as RunEventsService

/**
 * Integration test at the persistence seam: RunsService against a real Postgres
 * (the pre-agreed seam for the durable-run boundary). Skipped when no DATABASE_URL
 * is configured so unit-only environments stay green.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip

describeDb('RunsService (integration — real Postgres)', () => {
  const prisma = new PrismaService()
  const conversations = new ConversationsService(prisma)
  const lifecycle = new RunLifecycle(prisma, stubQueue, stubEvents)
  const runs = new RunsService(prisma, conversations, lifecycle)
  let userA = ''
  let userB = ''

  beforeAll(async () => {
    await prisma.$connect()
    const a = await prisma.user.create({ data: { email: `a-${Date.now()}@test.local`, passwordHash: 'x' } })
    const b = await prisma.user.create({ data: { email: `b-${Date.now()}@test.local`, passwordHash: 'x' } })
    userA = a.id
    userB = b.id
  })

  afterAll(async () => {
    // Cascades delete the users' conversations, runs, plans and steps.
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } })
    await prisma.$disconnect()
  })

  it('creates a Run in planning with a fresh conversation and an empty step log', async () => {
    const run = await runs.create(userA, { goal: 'Research pgvector and summarise it' })

    expect(run.status).toBe('planning')
    expect(run.conversationId).toBeTruthy()
    expect(run.steps).toEqual([])
    expect(run.plan).toBeNull()

    const fetched = await runs.get(userA, run.id)
    expect(fetched.id).toBe(run.id)
    expect(fetched.goal).toBe('Research pgvector and summarise it')
  })

  it('reuses an existing conversation when one is supplied', async () => {
    const convo = await conversations.create(userA, 'existing')
    const run = await runs.create(userA, { goal: 'continue here', conversationId: convo.id })
    expect(run.conversationId).toBe(convo.id)
  })

  it('only exposes a Run to its owner', async () => {
    const run = await runs.create(userA, { goal: 'private goal' })

    await expect(runs.get(userB, run.id)).rejects.toThrow(/not your run/i)
    const listB = await runs.list(userB)
    expect(listB.find(r => r.id === run.id)).toBeUndefined()

    const listA = await runs.list(userA)
    expect(listA.find(r => r.id === run.id)).toBeDefined()
  })

  it('rejects creating a Run against a conversation the user does not own', async () => {
    const convoA = await conversations.create(userA, 'a-owned')
    await expect(runs.create(userB, { goal: 'sneaky', conversationId: convoA.id })).rejects.toThrow()
  })

  it('fails a not-yet-executing Run directly when stopped (no job to observe the flag)', async () => {
    const run = await runs.create(userA, { goal: 'stop me before execution' })
    // Simulate the planning phase having produced a plan awaiting approval.
    await prisma.run.update({ where: { id: run.id }, data: { status: 'awaiting_approval' } })

    const stopped = await runs.interrupt(userA, run.id)
    expect(stopped.status).toBe('failed')
    expect(stopped.error).toMatch(/interrupt/i)
  })
})
