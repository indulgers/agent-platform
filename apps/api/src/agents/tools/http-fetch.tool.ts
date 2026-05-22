import { z } from 'zod'
import { ToolDefinition, zodObjectToJsonSchema } from './tool.interface'

const inputSchema = z.object({
  url: z.string().url().describe('Absolute URL to fetch (http/https only)'),
  method: z.enum(['GET', 'HEAD']).optional().describe('HTTP method; defaults to GET'),
  maxBytes: z.number().int().positive().max(1_000_000).optional().describe('Cap on response size; defaults to 200000'),
})

type Input = z.infer<typeof inputSchema>

export const httpFetchTool: ToolDefinition<Input, { status: number; contentType: string; body: string; truncated: boolean }> = {
  name: 'http_fetch',
  description: 'Fetch a public web URL and return its body as text. Use for reading docs, RSS, etc. Not for authenticated endpoints.',
  schema: inputSchema,
  parameters: zodObjectToJsonSchema(inputSchema),
  async execute(input) {
    const cap = input.maxBytes ?? 200_000
    const res = await fetch(input.url, { method: input.method ?? 'GET', redirect: 'follow' })
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const reader = res.body?.getReader()
    if (!reader) return { status: res.status, contentType, body: '', truncated: false }

    const chunks: Uint8Array[] = []
    let received = 0
    let truncated = false
    while (received < cap) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      if (received >= cap) {
        truncated = true
        await reader.cancel()
        break
      }
    }
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
    return { status: res.status, contentType, body: buf.toString('utf8'), truncated }
  },
}
