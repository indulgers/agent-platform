import { Injectable } from '@nestjs/common'
import type { ToolDefinition } from './tool.interface'
import { httpFetchTool } from './http-fetch.tool'
import { createVectorSearchTool } from './vector-search.tool'
import { MemoryService } from '../../memory/memory.service'

@Injectable()
export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition>

  constructor(private readonly memory: MemoryService) {
    this.tools = new Map()
    this.register(httpFetchTool)
    this.register(createVectorSearchTool(this.memory))
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
}
