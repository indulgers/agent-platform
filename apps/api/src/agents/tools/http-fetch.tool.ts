import { z } from 'zod'
import { ToolDefinition, zodObjectToJsonSchema } from './tool.interface'
import { htmlToText } from './html-to-text'

/** Default cap on the returned (post-extraction) text, in characters. */
const DEFAULT_MAX_CHARS = 40_000

const inputSchema = z.object({
  url: z.string().url().describe('Absolute URL to fetch (http/https only)'),
  method: z.enum(['GET', 'HEAD']).optional().describe('HTTP method; defaults to GET'),
  maxBytes: z.number().int().positive().max(1_000_000).optional().describe('Cap on bytes read from the response; defaults to 200000'),
  maxChars: z.number().int().positive().max(200_000).optional().describe('Cap on returned text length; defaults to 40000'),
  raw: z.boolean().optional().describe('Return the unprocessed body instead of text extracted from HTML'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  status: number
  contentType: string
  body: string
  truncated: boolean
  /** True when HTML markup was stripped to readable text before returning. */
  extracted: boolean
}

export const httpFetchTool: ToolDefinition<Input, Output> = {
  name: 'http_fetch',
  description:
    'Fetch a public web URL. For HTML pages it returns readable text extracted from the page ' +
    '(scripts, styles and markup stripped) to keep responses compact; JSON/markdown/plain text ' +
    'are returned as-is. Pass raw:true to get the unprocessed body. Not for authenticated endpoints.',
  schema: inputSchema,
  parameters: zodObjectToJsonSchema(inputSchema),
  async execute(input) {
    const cap = input.maxBytes ?? 200_000
    const res = await fetch(input.url, { method: input.method ?? 'GET', redirect: 'follow' })
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const reader = res.body?.getReader()
    if (!reader) return { status: res.status, contentType, body: '', truncated: false, extracted: false }

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
    const rawBody = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8')

    const isHtml = /html/i.test(contentType)
    const extracted = isHtml && !input.raw
    let body = extracted ? htmlToText(rawBody) : rawBody

    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS
    if (body.length > maxChars) {
      body = body.slice(0, maxChars)
      truncated = true
    }

    return { status: res.status, contentType, body, truncated, extracted }
  },
}
