import { describe, expect, it } from 'vitest'
import { notionProvider } from './notion.provider'

describe('notion provider', () => {
  it('only exposes the safe create-page tool and maps markdown to a workspace page', () => {
    expect(notionProvider.agentTools.map(tool => tool.remoteToolName)).toEqual([
      'notion-create-pages',
    ])
    expect(
      notionProvider.agentTools[0]!.toRemoteArguments({
        title: 'Weekly summary',
        content: '# Highlights',
        icon: '📝',
      }),
    ).toEqual({
      pages: [{ properties: { title: 'Weekly summary' }, content: '# Highlights', icon: '📝' }],
    })
  })
})
