import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverOAuthMetadata } from './oauth-metadata'

afterEach(() => vi.unstubAllGlobals())

describe('discoverOAuthMetadata', () => {
  it('inserts protected-resource discovery before a resource path', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_servers: ['https://mcp.notion.com'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issuer: 'https://mcp.notion.com', authorization_endpoint: 'https://mcp.notion.com/authorize', token_endpoint: 'https://mcp.notion.com/token' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(discoverOAuthMetadata('https://mcp.notion.com/mcp')).resolves.toMatchObject({ authorization_endpoint: 'https://mcp.notion.com/authorize' })
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://mcp.notion.com/.well-known/oauth-protected-resource/mcp')
  })

  it('requires an issuer from authorization-server metadata', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_servers: ['https://mcp.notion.com'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authorization_endpoint: 'https://mcp.notion.com/authorize', token_endpoint: 'https://mcp.notion.com/token' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(discoverOAuthMetadata('https://mcp.notion.com/mcp')).rejects.toThrow('OAuth metadata is missing required endpoints or issuer')
  })
})
