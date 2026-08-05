import type { SseEvent } from '@agent-platform/shared'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Read an SSE body stream, parsing `data: …\n\n` framing by hand and invoking
 * `onEvent` per frame. Shared by the POST (chat) and GET (run event stream)
 * consumers below.
 */
async function pump(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      sep = buffer.indexOf('\n\n')

      const dataLines = frame
        .split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trim())
      if (dataLines.length === 0) continue
      const payload = dataLines.join('\n')
      try {
        onEvent(JSON.parse(payload) as SseEvent)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to parse SSE frame', payload, err)
      }
    }
  }
}

function authHeaders(extra?: Record<string, string>): Headers {
  const token = useAuthStore.getState().token
  const headers = new Headers({ Accept: 'text/event-stream', ...extra })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

/** Guard an SSE fetch response, then drain it. Shared by the POST and GET consumers. */
async function drain(res: Response, onEvent: (event: SseEvent) => void): Promise<void> {
  if (!res.ok || !res.body) {
    if (res.status === 401) useAuthStore.getState().clear()
    throw new Error(`SSE request failed: ${res.status} ${res.statusText}`)
  }
  await pump(res.body, onEvent)
}

/**
 * Consume an SSE stream from a POST endpoint. `EventSource` cannot do POST, so we use
 * fetch + ReadableStream and parse `data: …\n\n` framing by hand.
 */
export async function consumeSse(
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  })
  await drain(res, onEvent)
}

/**
 * Consume an SSE stream from a GET endpoint (the run event stream). `EventSource`
 * can't send the `Authorization` header, so we use fetch here too.
 */
export async function consumeSseGet(
  path: string,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'GET',
    headers: authHeaders(),
    signal,
  })
  await drain(res, onEvent)
}
