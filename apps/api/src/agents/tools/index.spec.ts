import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import { MemoryService } from '../../memory/memory.service'
import { makeFakeTool } from '../testing/fake-tool'
import { ToolRegistry } from './index'

describe('ToolRegistry', () => {
  it('creates an independent scoped registry with existing and additional tools', async () => {
    const memory = new Proxy({}, { get: () => () => undefined }) as MemoryService
    const module = await Test.createTestingModule({
      providers: [ToolRegistry, { provide: MemoryService, useValue: memory }],
    }).compile()
    const registry = module.get(ToolRegistry)
    const existing = makeFakeTool({ name: 'existing' })
    const additional = makeFakeTool({ name: 'additional' })
    registry.register(existing)

    const scoped = registry.scoped([additional])

    expect(scoped).not.toBe(registry)
    expect(scoped.list().map(tool => tool.name)).toEqual(
      expect.arrayContaining(['http_fetch', 'vector_search', 'existing', 'additional']),
    )
    expect(registry.get('additional')).toBeUndefined()
    expect(registry.list().map(tool => tool.name)).toEqual(
      expect.arrayContaining(['http_fetch', 'vector_search', 'existing']),
    )
  })
})
