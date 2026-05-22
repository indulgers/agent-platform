import { Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import type {
  AssembledResponse,
  AssistantToolCall,
  ChatMessage,
  ChatProvider,
  ChatStreamOptions,
  ProviderEvent,
} from './llm.interface'

@Injectable()
export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic' as const
  private readonly logger = new Logger(AnthropicProvider.name)
  private readonly client: Anthropic | null

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null
  }

  stream(opts: ChatStreamOptions) {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY not configured')

    const queue: ProviderEvent[] = []
    const waiter: { resolve: (() => void) | null } = { resolve: null }
    let endReached = false
    let endResolve!: (r: AssembledResponse) => void
    let endReject!: (err: unknown) => void
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
      const systemMessages = opts.messages.filter(m => m.role === 'system').map(m => m.content)
      const dialogue = opts.messages.filter(m => m.role !== 'system')

      const stream = this.client!.messages.stream({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: systemMessages.join('\n\n') || undefined,
        tools: opts.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as { type: 'object'; properties?: unknown; [k: string]: unknown },
        })),
        messages: dialogue.map(m => this.toAnthropicMessage(m)),
      })

      const text: string[] = []
      const toolBuffers = new Map<number, { id: string; name: string; args: string }>()
      let finishReason: AssembledResponse['finishReason'] = 'stop'

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block
            if (block.type === 'tool_use') {
              toolBuffers.set(event.index, { id: block.id, name: block.name, args: '' })
              push({ kind: 'tool_call_start', id: block.id, name: block.name })
            }
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta
            if (delta.type === 'text_delta') {
              text.push(delta.text)
              push({ kind: 'text_delta', delta: delta.text })
            } else if (delta.type === 'input_json_delta') {
              const buf = toolBuffers.get(event.index)
              if (buf) {
                buf.args += delta.partial_json
                push({ kind: 'tool_call_args_delta', id: buf.id, argsDelta: delta.partial_json })
              }
            }
          } else if (event.type === 'content_block_stop') {
            const buf = toolBuffers.get(event.index)
            if (buf) push({ kind: 'tool_call_end', id: buf.id })
          } else if (event.type === 'message_delta') {
            const reason = event.delta.stop_reason
            if (reason === 'tool_use') finishReason = 'tool_calls'
            else if (reason === 'end_turn') finishReason = 'stop'
            else if (reason === 'max_tokens') finishReason = 'length'
            else if (reason) finishReason = 'error'
          }
        }

        const assembled: AssistantToolCall[] = []
        for (const buf of toolBuffers.values()) {
          let args: unknown = {}
          try {
            args = buf.args ? JSON.parse(buf.args) : {}
          } catch (err) {
            this.logger.warn(`Failed to parse tool args for ${buf.name}: ${err}`)
            args = { _raw: buf.args }
          }
          assembled.push({ id: buf.id, name: buf.name, args })
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

  private toAnthropicMessage(m: ChatMessage): Anthropic.MessageParam {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId!, content: m.content }],
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: (tc.args ?? {}) as Record<string, unknown>,
        })
      }
      return { role: 'assistant', content: blocks }
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }
  }
}
