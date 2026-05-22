import { z } from 'zod'

export interface ToolContext {
  userId: string
  conversationId: string
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  schema: z.ZodType<TInput>
  /** JSON Schema (object) — derived from the zod schema. */
  parameters: Record<string, unknown>
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>
}

/** Lightweight zod → JSON Schema (object) converter for the simple shapes we need. */
export function zodObjectToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const shape = schema.shape
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = describe(value)
    if (!value.isOptional()) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function describe(node: z.ZodTypeAny): Record<string, unknown> {
  if (node instanceof z.ZodOptional) return describe(node._def.innerType)
  if (node instanceof z.ZodString) return { type: 'string', description: node.description }
  if (node instanceof z.ZodNumber) return { type: 'number', description: node.description }
  if (node instanceof z.ZodBoolean) return { type: 'boolean', description: node.description }
  if (node instanceof z.ZodEnum) return { type: 'string', enum: node.options, description: node.description }
  if (node instanceof z.ZodArray) return { type: 'array', items: describe(node._def.type), description: node.description }
  if (node instanceof z.ZodObject) return zodObjectToJsonSchema(node)
  return { description: node.description }
}
