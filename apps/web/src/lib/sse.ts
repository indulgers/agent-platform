import type { SseEvent } from '@agent-platform/shared'
import { useAuthStore } from '@/stores/auth-store'

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
  const token = useAuthStore.getState().token
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  })
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    if (res.status === 401) useAuthStore.getState().clear()
    throw new Error(`SSE request failed: ${res.status} ${res.statusText}`)
  }

  const reader = res.body.getReader()
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
