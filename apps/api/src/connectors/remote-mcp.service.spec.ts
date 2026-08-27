import { describe, expect, it, vi } from 'vitest'
import type { ConnectorsService } from './connectors.service'
import { RemoteMcpService, type RemoteMcpClientFactory } from './remote-mcp.service'

function harness(
  active: boolean,
  callTool = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Created https://notion.so/page-1' }],
  }),
) {
  const connectors = {
    isActive: vi.fn().mockResolvedValue(active),
    accessToken: vi.fn().mockResolvedValue('access-token'),
  } as unknown as ConnectorsService
  const client = { callTool, close: vi.fn().mockResolvedValue(undefined) }
  const factory = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as RemoteMcpClientFactory
  return { connectors, client, factory, service: new RemoteMcpService(connectors, factory) }
}

describe('RemoteMcpService', () => {
  it('offers no remote tools and opens no client when Notion is disconnected', async () => {
    const { connectors, factory, service } = harness(false)

    const names = await service.withUserTools('user-1', async tools => tools.map(tool => tool.name))

    expect(names).toEqual([])
    expect(connectors.accessToken).not.toHaveBeenCalled()
    expect(factory.connect).not.toHaveBeenCalled()
  })

  it('maps notion_create_page and closes its client after success', async () => {
    const { client, factory, service } = harness(true)
    const controller = new AbortController()

    const result = await service.withUserTools('user-1', async tools => {
      expect(tools.map(tool => tool.name)).toEqual(['notion_create_page'])
      return tools[0]!.execute(
        { title: 'Title', content: '# Body', icon: '📝' },
        { userId: 'user-1', conversationId: 'conversation-1', signal: controller.signal },
      )
    })

    expect(factory.connect).toHaveBeenCalledWith('https://mcp.notion.com/mcp', 'access-token')
    expect(client.callTool).toHaveBeenCalledWith(
      'notion-create-pages',
      {
        pages: [{ properties: { title: 'Title' }, content: '# Body', icon: '📝' }],
      },
      controller.signal,
    )
    expect(result).toMatchObject({ url: 'https://notion.so/page-1' })
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('closes its client when the remote tool fails', async () => {
    const { client, service } = harness(true, vi.fn().mockRejectedValue(new Error('remote failed')))

    await expect(
      service.withUserTools('user-1', tools =>
        tools[0]!.execute(
          { title: 'Title', content: 'Body' },
          { userId: 'user-1', conversationId: 'conversation-1' },
        ),
      ),
    ).rejects.toThrow('remote failed')
    expect(client.close).toHaveBeenCalledOnce()
  })
})
