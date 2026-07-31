import { describe, it, expect } from 'vitest'
import { OpenAIProvider } from './openai.provider'
import type { ChatStreamOptions, ProviderEvent } from './llm.interface'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Drives the real OpenAIProvider.stream() with a fake OpenAI client that yields
 * scripted streaming chunks — proving tool-call arguments are assembled from the
 * stream correctly (the DeepSeek default inherits this adapter verbatim).
 */
class TestOpenAIProvider extends OpenAIProvider {
  chunks: any[] = []
  protected override createClient(): any {
    return {
      chat: {
        completions: {
          create: async () => {
            const chunks = this.chunks
            return (async function* () {
              for (const c of chunks) yield c
            })()
          },
        },
      },
    }
  }
}

function chunk(delta: any, finish: string | null = null) {
  return { choices: [{ index: 0, delta, finish_reason: finish }] }
}

async function drain(opts: ChatStreamOptions, provider: TestOpenAIProvider) {
  const { events, done } = provider.stream(opts)
  const seen: ProviderEvent[] = []
  for await (const e of events) seen.push(e)
  return { assembled: await done, events: seen }
}

const baseOpts: ChatStreamOptions = {
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'go' }],
  tools: [],
  maxTokens: 128,
}

describe('OpenAIProvider.stream — tool-call argument assembly', () => {
  it('correlates two PARALLEL tool calls by index, not by id', async () => {
    const provider = new TestOpenAIProvider()
    // OpenAI streaming: id/name only on the first chunk of each call; later
    // chunks carry index + a slice of arguments. Interleave the two calls.
    provider.chunks = [
      chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'http_fetch', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"url":"https://a' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'http_fetch', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: '{"url":"https://b.com"}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '.com"}' } }] }),
      chunk({}, 'tool_calls'),
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]

    const { assembled } = await drain(baseOpts, provider)

    expect(assembled.finishReason).toBe('tool_calls')
    expect(assembled.toolCalls).toHaveLength(2)
    const byId = Object.fromEntries(assembled.toolCalls.map(t => [t.id, t.args]))
    expect(byId['call_a']).toEqual({ url: 'https://a.com' })
    expect(byId['call_b']).toEqual({ url: 'https://b.com' })
    // No _raw poisoning anywhere.
    expect(JSON.stringify(assembled.toolCalls)).not.toContain('_raw')
  })

  it('falls back to {} (never _raw) when the argument buffer is not valid JSON', async () => {
    const provider = new TestOpenAIProvider()
    provider.chunks = [
      chunk({ tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'http_fetch', arguments: '{"url":"https://truncat' } }] }),
      chunk({}, 'tool_calls'),
    ]

    const { assembled } = await drain(baseOpts, provider)

    expect(assembled.toolCalls).toHaveLength(1)
    expect(assembled.toolCalls[0]!.args).toEqual({})
    expect(JSON.stringify(assembled.toolCalls)).not.toContain('_raw')
  })
})
