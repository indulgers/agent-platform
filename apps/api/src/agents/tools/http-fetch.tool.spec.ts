import { describe, it, expect, afterEach, vi } from 'vitest'
import { httpFetchTool } from './http-fetch.tool'
import type { ToolContext } from './tool.interface'

const ctx: ToolContext = { userId: 'u1', conversationId: 'c1' }

/** Fake fetch Response exposing only the bits http_fetch.execute uses. */
function fakeResponse(body: string, contentType: string, status = 200) {
  const bytes = new TextEncoder().encode(body)
  let sent = false
  return {
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      getReader: () => ({
        read: async () =>
          sent ? { value: undefined, done: true } : ((sent = true), { value: bytes, done: false }),
        cancel: async () => {},
      }),
    },
  }
}

function stubFetch(res: ReturnType<typeof fakeResponse>) {
  vi.stubGlobal('fetch', vi.fn(async () => res))
}

afterEach(() => vi.unstubAllGlobals())

const HTML = '<html><head><style>.a{}</style></head><body><script>track()</script><h1>Title</h1><p>Hello world</p></body></html>'

describe('http_fetch.execute', () => {
  it('extracts readable text from HTML and flags extracted', async () => {
    stubFetch(fakeResponse(HTML, 'text/html; charset=utf-8'))
    const out = await httpFetchTool.execute({ url: 'https://x.test' }, ctx)
    expect(out.extracted).toBe(true)
    expect(out.body).toContain('Title')
    expect(out.body).toContain('Hello world')
    expect(out.body).not.toContain('track()')
    expect(out.body).not.toContain('<h1>')
  })

  it('passes non-HTML bodies through unchanged', async () => {
    const json = '{"a":1,"b":"two"}'
    stubFetch(fakeResponse(json, 'application/json'))
    const out = await httpFetchTool.execute({ url: 'https://x.test/api' }, ctx)
    expect(out.extracted).toBe(false)
    expect(out.body).toBe(json)
  })

  it('bypasses extraction when raw:true', async () => {
    stubFetch(fakeResponse(HTML, 'text/html'))
    const out = await httpFetchTool.execute({ url: 'https://x.test', raw: true }, ctx)
    expect(out.extracted).toBe(false)
    expect(out.body).toBe(HTML)
  })

  it('truncates to maxChars and marks truncated', async () => {
    stubFetch(fakeResponse('abcdefghijklmnop', 'application/json'))
    const out = await httpFetchTool.execute({ url: 'https://x.test', maxChars: 10 }, ctx)
    expect(out.body).toBe('abcdefghij')
    expect(out.truncated).toBe(true)
  })
})
