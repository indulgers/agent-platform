# 6. Live Run event bridge over Redis pub/sub

Date: 2026-08-01

## Status

Accepted

## Context

A durable Run executes in a BullMQ worker, decoupled from any HTTP request. The
run engine already produces live `SseEvent`s (`plan_proposed`, `run_status`,
`checkpoint_hit`, `token`, `tool_*`, `usage`), but the worker drove the engine
with `emit = noop`, so every live event was dropped — only the persisted
Run/Plan/RunStep rows survived. The Runs workspace (M2) needs to watch a Run as
it plans, acts, and pauses, which requires a live channel from the worker to the
browser.

This differs from the chat stream, which runs the agent *inside* the HTTP
request handler and can write SSE frames directly to that response. A Run has no
such request to write to: the client that wants to watch may connect long after
the worker started, from a different device, and — in production — to a
different API replica than the one running the worker.

Options considered:

1. **Polling** `GET /runs/:id` on an interval. No new channel, but no token
   streaming and checkpoint/plan prompts lag a poll cycle — it undercuts the
   "steer a live agent" goal.
2. **In-memory event emitter** shared between the worker and the SSE endpoint.
   Simplest, zero new infrastructure — but only correct when the worker and the
   SSE connection live in the same process. The API scales horizontally, so the
   subscriber and the worker routinely land on different replicas, where an
   in-memory emitter silently delivers nothing.
3. **Redis pub/sub.** The worker publishes each event to a per-Run channel; a
   new SSE endpoint subscribes and streams to the browser. Works across replicas
   and reuses the Redis already present for BullMQ.

## Decision

Bridge worker-produced Run events to clients over **Redis pub/sub**, one channel
per Run (`run:{runId}`):

- A `RunEventsService` wraps an `ioredis` publisher and a single shared
  subscriber connection, multiplexing all Run channels through an in-process
  listener map. Channels are subscribed lazily on their first listener and
  unsubscribed on their last.
- The BullMQ worker builds `emit = event => runEvents.publish(runId, event)` and
  passes it into the engine's existing `plan()`/`execute()`. The engine is
  otherwise unchanged — it already accepts an `Emit`.
- A new `GET /runs/:id/events` SSE endpoint performs an owner check, opens the
  stream, subscribes to the Run's channel, and unsubscribes + ends the response
  when the client disconnects.
- The SSE header/framing logic is extracted to a shared helper
  (`openSseStream`, `writeSse`) so the chat stream and the run event stream frame
  events identically.

Clients render the durable snapshot (`GET /runs/:id`) first, then apply this live
tail, deduping by SseEvent `id` — ephemeral `token`s emitted before connect are
not replayed, but the final `answer` persists, so a reopened Run still renders a
complete trail.

## Consequences

- A Run executing on any replica can be watched from any other replica.
- `ioredis` becomes a direct dependency of the API (previously transitive via
  BullMQ); the subscriber uses a connection separate from the publisher because a
  connection in subscribe mode cannot issue normal commands.
- The bridge is fire-and-forget and at-most-once: pub/sub does not persist or
  replay, so durable state remains the source of truth and the snapshot the
  reconnect mechanism. A subscriber that is not connected when an event is
  published misses it — acceptable because every replay-worthy event is also a
  persisted RunStep or Run field.
- A future per-user channel (to make every rail badge live, not just the open
  Run's) can reuse the same service; it is intentionally out of scope here.
