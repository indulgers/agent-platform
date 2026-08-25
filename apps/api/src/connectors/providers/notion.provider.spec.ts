import { describe, expect, it } from 'vitest'
import { notionProvider } from './notion.provider'

describe('notion provider', () => {
  it('only exposes the safe create-page tool and maps markdown to a workspace page', () => {
    expect(notionProvider.allowedRemoteTools).toEqual(['notion-create-pages'])
    expect(notionProvider.toAgentTool('notion-create-pages', {
      title: 'Weekly summary',
      content: '# Highlights',
      icon: '📝',
    })).toEqual({
      name: 'notion_create_page',
      arguments: {
        pages: [{ properties: { title: 'Weekly summary' }, content: '# Highlights', icon: '📝' }],
      },
    })
  })
})
