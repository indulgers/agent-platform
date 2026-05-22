import { z } from 'zod'
import { ToolDefinition, zodObjectToJsonSchema } from './tool.interface'

/**
 * Stub: read-only SQL access — disabled by default. Wire up an allowlisted schema, a
 * read-only connection, and statement-timeouts before enabling.
 */
const inputSchema = z.object({
  sql: z.string().min(1).max(2000).describe('Read-only SQL statement (SELECT only)'),
})
type Input = z.infer<typeof inputSchema>

export const sqlQueryTool: ToolDefinition<Input, { rows: unknown[] }> = {
  name: 'sql_query',
  description: 'Run a read-only SQL query against an allowlisted schema. Disabled by default.',
  schema: inputSchema,
  parameters: zodObjectToJsonSchema(inputSchema),
  async execute() {
    throw new Error('sql_query tool is disabled — enable behind a feature flag with a read-only role')
  },
}
