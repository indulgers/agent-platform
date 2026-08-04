import { describe, it, expect } from 'vitest'
import type { Run } from '@agent-platform/shared'
import { prependRunRow, type RunListRow } from './runs'

const run = (id: string): Run => ({
  id,
  conversationId: `c-${id}`,
  goal: `goal ${id}`,
  status: 'planning',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
})

const row = (id: string): RunListRow => ({
  id,
  conversationId: `c-${id}`,
  goal: `goal ${id}`,
  status: 'done',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
})

describe('prependRunRow (rail list handling)', () => {
  it('adds a new run to the head, newest first', () => {
    const next = prependRunRow([row('a'), row('b')], run('c'))
    expect(next.map(r => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('seeds the list when empty', () => {
    expect(prependRunRow(undefined, run('a')).map(r => r.id)).toEqual(['a'])
  })

  it('de-dupes so a re-inserted run does not appear twice', () => {
    const next = prependRunRow([row('a'), row('b')], run('a'))
    expect(next.map(r => r.id)).toEqual(['a', 'b'])
    expect(next).toHaveLength(2)
  })
})
