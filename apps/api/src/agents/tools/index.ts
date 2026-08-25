import { Injectable } from '@nestjs/common'
import type { ToolDefinition } from './tool.interface'
import { httpFetchTool } from './http-fetch.tool'
import { createVectorSearchTool } from './vector-search.tool'
import { MemoryService } from '../../memory/memory.service'

@Injectable()
export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition>

  constructor(private readonly memory: MemoryService, initial?: ToolDefinition[]) {
    this.tools = new Map()
    for (const tool of initial ?? [httpFetchTool, createVectorSearchTool(this.memory)]) this.register(tool)
    // sql_query is intentionally not registered by default.
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /** A per-run registry that never mutates the shared built-in registry. */
  scoped(additional: ToolDefinition[]): ToolRegistry {
    return new ToolRegistry(this.memory, [...this.list(), ...additional])
  }
}
