import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import IORedis from 'ioredis'
import type { SseEvent } from '@agent-platform/shared'

/** Redis pub/sub channel carrying one Run's live SseEvents. */
const channelFor = (runId: string) => `run:${runId}`

type Listener = (event: SseEvent) => void

/**
 * Bridges Run SseEvents from the BullMQ worker to live SSE subscribers over
 * Redis pub/sub, so a run executing on any API replica can be watched from any
 * other. A single subscriber connection multiplexes every channel via an
 * in-process listener map; channels are (un)subscribed lazily with their
 * first/last listener.
 */
@Injectable()
export class RunEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(RunEventsService.name)
  private readonly pub: IORedis
  private readonly sub: IORedis
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
    // maxRetriesPerRequest: null mirrors the BullMQ connection convention and
    // keeps a subscriber connection from throwing on transient blips.
    this.pub = new IORedis(url, { maxRetriesPerRequest: null })
    this.sub = new IORedis(url, { maxRetriesPerRequest: null })
    this.sub.on('message', (channel, payload) => {
      const set = this.listeners.get(channel)
      if (!set) return
      let event: SseEvent
      try {
        event = JSON.parse(payload) as SseEvent
      } catch {
        this.logger.warn(`Dropping unparseable event on ${channel}`)
        return
      }
      for (const cb of set) cb(event)
    })
  }

  /** Publish one live event for a Run. Fire-and-forget from the worker. */
  async publish(runId: string, event: SseEvent): Promise<void> {
    await this.pub.publish(channelFor(runId), JSON.stringify(event))
  }

  /**
   * Subscribe to a Run's live events. Returns an unsubscribe fn; when the last
   * listener for a channel leaves, the Redis subscription is dropped.
   */
  async subscribe(runId: string, cb: Listener): Promise<() => void> {
    const channel = channelFor(runId)
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
      await this.sub.subscribe(channel)
    }
    set.add(cb)
    return () => {
      const current = this.listeners.get(channel)
      if (!current) return
      current.delete(cb)
      if (current.size === 0) {
        this.listeners.delete(channel)
        void this.sub.unsubscribe(channel)
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()])
  }
}
