import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'
import type {
  AssembledResponse,
  AssistantToolCall,
  ChatProvider,
  ChatProviderName,
  ChatStreamOptions,
  ProviderEvent,
} from './llm.interface'

@Injectable()
export class OpenAIProvider implements ChatProvider {
  readonly name: ChatProviderName = 'openai'
  protected readonly logger = new Logger(this.constructor.name)
  protected readonly client: OpenAI | null

  constructor() {
    this.client = this.createClient()
  }

  /** Override in subclasses to point the OpenAI SDK at a different endpoint. */
  protected createClient(): OpenAI | null {
    return process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
  }

  /** Subclasses override to surface the right env var in the error message. */
  protected get missingKeyMessage(): string {
    return 'OPENAI_API_KEY not configured'
  }

  stream(opts: ChatStreamOptions) {
    if (!this.client) throw new Error(this.missingKeyMessage)

    const queue: ProviderEvent[] = []
    const waiter: { resolve: (() => void) | null } = { resolve: null }
    let endResolve!: (r: AssembledResponse) => void
    let endReject!: (err: unknown) => void
    let endReached = false
    const done = new Promise<AssembledResponse>((res, rej) => {
      endResolve = res
      endReject = rej
    })

    const wake = () => {
      const fn = waiter.resolve
      waiter.resolve = null
      fn?.()
    }
    const push = (e: ProviderEvent) => {
      queue.push(e)
      wake()
    }

    const events: AsyncIterable<ProviderEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<ProviderEvent>> => {
          while (queue.length === 0 && !endReached) {
            await new Promise<void>(r => (waiter.resolve = r))
          }
          if (queue.length > 0) return { value: queue.shift()!, done: false }
          return { value: undefined as unknown as ProviderEvent, done: true }
        },
      }),
    }

    ;(async () => {
      const text: string[] = []
      const toolCalls = new Map<string, AssistantToolCall & { argBuffer: string }>()
      let finishReason: AssembledResponse['finishReason'] = 'stop'

      try {
        const stream = await this.client!.chat.completions.create({
          model: opts.model,
          messages: opts.messages.map(m => {
            if (m.role === 'tool') {
              return { role: 'tool', tool_call_id: m.toolCallId!, content: m.content } as const
            }
            if (m.role === 'assistant' && m.toolCalls?.length) {
              return {
                role: 'assistant',
                content: m.content || null,
                tool_calls: m.toolCalls.map(tc => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
                })),
              } as const
            }
            return { role: m.role, content: m.content } as const
          }),
          tools: opts.tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          max_tokens: opts.maxTokens,
          stream: true,
        }, { signal: opts.signal })

        for await (const chunk of stream) {
          const choice = chunk.choices[0]
          if (!choice) continue
          const delta = choice.delta
          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            text.push(delta.content)
            push({ kind: 'text_delta', delta: delta.content })
          }
          for (const tc of delta?.tool_calls ?? []) {
            const id = tc.id ?? toolCalls.keys().next().value
            if (!id) continue
            let entry = toolCalls.get(id)
            if (!entry) {
              entry = { id, name: tc.function?.name ?? '', args: undefined, argBuffer: '' }
              toolCalls.set(id, entry)
              push({ kind: 'tool_call_start', id, name: entry.name })
            }
            if (tc.function?.name && !entry.name) {
              entry.name = tc.function.name
            }
            if (tc.function?.arguments) {
              entry.argBuffer += tc.function.arguments
              push({ kind: 'tool_call_args_delta', id, argsDelta: tc.function.arguments })
            }
          }
          if (choice.finish_reason) {
            finishReason =
              choice.finish_reason === 'tool_calls'
                ? 'tool_calls'
                : choice.finish_reason === 'length'
                  ? 'length'
                  : choice.finish_reason === 'stop'
                    ? 'stop'
                    : 'error'
          }
        }

        const assembled: AssistantToolCall[] = []
        for (const entry of toolCalls.values()) {
          let args: unknown = {}
          try {
            args = entry.argBuffer ? JSON.parse(entry.argBuffer) : {}
          } catch (err) {
            this.logger.warn(`Failed to parse tool args for ${entry.name}: ${err}`)
            args = { _raw: entry.argBuffer }
          }
          push({ kind: 'tool_call_end', id: entry.id })
          assembled.push({ id: entry.id, name: entry.name, args })
        }

        push({ kind: 'message_end', finishReason })
        endResolve({ text: text.join(''), toolCalls: assembled, finishReason })
      } catch (err) {
        push({ kind: 'message_end', finishReason: 'error' })
        endReject(err)
      } finally {
        endReached = true
        wake()
      }
    })()

    return { events, done }
  }
}
