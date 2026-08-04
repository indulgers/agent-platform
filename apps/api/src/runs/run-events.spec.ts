import { describe, it, expect, afterEach } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { RunEventsService } from './run-events'

/**
 * Integration test at the pub/sub boundary: a real Redis. Proves a published
 * Run event reaches a live subscriber and that unsubscribe stops delivery.
 */
const describeRedis = process.env.REDIS_URL ? describe : describe.skip

/** Resolve once `cb` fires or reject after `ms`. */
function nextEvent(subscribe: (cb: (e: SseEvent) => void) => void, ms = 1000): Promise<SseEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for event')), ms)
    subscribe(e => {
      clearTimeout(timer)
      resolve(e)
    })
  })
}

describeRedis('RunEventsService (integration — real Redis)', () => {
  let svc: RunEventsService

  afterEach(async () => {
    await svc?.onModuleDestroy()
  })

  it('delivers a published event to a subscriber', async () => {
    svc = new RunEventsService()
    const runId = `test-run-${Date.now()}`
    const received = nextEvent(cb => {
      void svc.subscribe(runId, cb).then(() => {
        // publish only after the subscription is registered
        void svc.publish(runId, { type: 'run_status', runId, status: 'running' })
      })
    })
    expect(await received).toEqual({ type: 'run_status', runId, status: 'running' })
  })

  it('stops delivering after unsubscribe', async () => {
    svc = new RunEventsService()
    const runId = `test-run-${Date.now()}-b`
    let calls = 0
    const unsubscribe = await svc.subscribe(runId, () => {
      calls++
    })
    unsubscribe()
    await svc.publish(runId, { type: 'run_status', runId, status: 'done' })
    // give Redis a beat to (not) deliver
    await new Promise(r => setTimeout(r, 150))
    expect(calls).toBe(0)
  })
})
