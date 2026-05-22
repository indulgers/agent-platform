import { z } from 'zod'
import { ToolDefinition, zodObjectToJsonSchema } from './tool.interface'
import type { MemoryService } from '../../memory/memory.service'

const inputSchema = z.object({
  query: z.string().min(1).max(2000).describe('Natural-language query to search the conversation memory store'),
  k: z.number().int().min(1).max(20).optional().describe('Number of nearest neighbours to return; default 5'),
})

type Input = z.infer<typeof inputSchema>

export function createVectorSearchTool(memory: MemoryService): ToolDefinition<Input, Array<{ content: string; score: number }>> {
  return {
    name: 'vector_search',
    description:
      'Search the user’s long-term memory (notes, prior chats, ingested docs). Returns the most semantically similar chunks with cosine-similarity scores.',
    schema: inputSchema,
    parameters: zodObjectToJsonSchema(inputSchema),
    async execute(input, ctx) {
      return memory.search({ userId: ctx.userId, query: input.query, k: input.k ?? 5 })
    },
  }
}
