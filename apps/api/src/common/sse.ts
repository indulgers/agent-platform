import type { Response } from 'express'
import type { SseEvent } from '@agent-platform/shared'

/**
 * Shared Server-Sent-Events helpers. Both the synchronous chat stream
 * (agents.controller) and the durable run event stream (runs.controller) frame
 * events identically: `data: <json>\n\n`.
 */

/** Set the SSE response headers and flush them so the client starts reading. */
export function openSseStream(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
}

/**
 * Write one SSE frame. If the client already disconnected the socket, writing
 * throws — swallow it; callers unwind separately via the abort/close path.
 */
export function writeSse(res: Response, event: SseEvent): void {
  if (res.writableEnded || res.destroyed) return
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  } catch {
    /* socket gone */
  }
}
