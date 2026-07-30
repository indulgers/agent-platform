import { z } from 'zod'
import { ToolRegistry } from '../tools'
import type { ToolContext, ToolDefinition } from '../tools/tool.interface'
import type { MemoryService } from '../../memory/memory.service'

export interface FakeToolOptions {
  name: string
  description?: string
  /** Value returned by execute() when the tool is called. */
  result?: unknown
  /** When set, execute() rejects with this message — for reflection/retry tests. */
  fail?: string
  /** Invoked with the parsed input each time the tool runs. */
  onCall?: (input: unknown, ctx: ToolContext) => void
}

/**
 * A permissive, scriptable ToolDefinition for tests. Accepts any object args
 * and returns a canned result (or throws), recording each invocation via
 * `onCall`. Used to drive tool-calling paths through the AgentRunner.
 */
export function makeFakeTool(opts: FakeToolOptions): ToolDefinition {
  return {
    name: opts.name,
    description: opts.description ?? `fake tool: ${opts.name}`,
    schema: z.object({}).passthrough(),
    parameters: { type: 'object', properties: {}, additionalProperties: true },
    async execute(input: unknown, ctx: ToolContext): Promise<unknown> {
      opts.onCall?.(input, ctx)
      if (opts.fail !== undefined) throw new Error(opts.fail)
      return opts.result ?? { ok: true }
    },
  }
}

/**
 * Build a real ToolRegistry for tests, seeded with the given fake tools. The
 * registry's constructor also registers the built-in tools (http_fetch,
 * vector_search); a Proxy stub stands in for MemoryService so construction
 * never touches the network. The built-ins are inert unless a scripted turn
 * actually calls them.
 */
export function makeToolRegistryWith(...tools: ToolDefinition[]): ToolRegistry {
  const stubMemory = new Proxy(
    {},
    { get: () => () => undefined },
  ) as unknown as MemoryService
  const registry = new ToolRegistry(stubMemory)
  for (const tool of tools) registry.register(tool)
  return registry
}
