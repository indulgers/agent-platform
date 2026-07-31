import { describe, it, expect } from 'vitest'
import type { SseEvent } from '@agent-platform/shared'
import { AgentRunner } from '../runner/agent-runner'
import { FakeChatProvider } from '../testing/fake-chat-provider'
import { makeToolRegistryWith } from '../testing/fake-tool'
import { registerMcpTools, mcpToolName } from './register-mcp-tools'
import type { McpClient } from './mcp-client.interface'

/** An in-memory MCP server exposing one tool, recording calls. */
function fakeMcpClient(calls: { name: string; args: unknown }[]): McpClient {
  return {
    async listTools() {
      return [
        {
          name: 'search',
          description: 'search the web',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      ]
    },
    async callTool(name, args) {
      calls.push({ name, args })
      return { hits: ['a', 'b'] }
    },
    async close() {},
  }
}

describe('registerMcpTools', () => {
  it('registers MCP tools into the registry under a namespaced name', async () => {
    const registry = makeToolRegistryWith()
    const registered = await registerMcpTools(registry, fakeMcpClient([]), 'web')

    expect(registered).toEqual([mcpToolName('web', 'search')])
    const tool = registry.get('mcp__web__search')
    expect(tool).toBeDefined()
    // The server's JSON Schema is surfaced to the model verbatim.
    expect(tool!.parameters).toMatchObject({ properties: { q: { type: 'string' } } })
  })

  it('makes MCP tools callable by the agent exactly like built-ins', async () => {
    const calls: { name: string; args: unknown }[] = []
    const registry = makeToolRegistryWith()
    await registerMcpTools(registry, fakeMcpClient(calls), 'web')

    const provider = new FakeChatProvider([
      { toolCalls: [{ id: 'c1', name: 'mcp__web__search', args: { q: 'hello' } }], finishReason: 'tool_calls' },
      { text: 'answered from mcp', finishReason: 'stop' },
    ])
    const runner = new AgentRunner(registry)
    const emitted: SseEvent[] = []

    const result = await runner.run({
      provider,
      model: 'fake-model',
      systemPrompt: 'test',
      history: [],
      userMessage: 'go',
      ctx: { userId: 'u1', conversationId: 'c1' },
      maxIterations: 8,
      maxTokens: 128,
      emit: e => emitted.push(e),
    })

    // The MCP server received the call with the original (un-namespaced) name.
    expect(calls).toEqual([{ name: 'search', args: { q: 'hello' } }])
    const toolResult = emitted.find(e => e.type === 'tool_result')
    expect(toolResult).toMatchObject({ ok: true, result: { hits: ['a', 'b'] } })
    expect(result.finalAssistantText).toBe('answered from mcp')
  })
})
