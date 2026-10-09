import { describe, expect, it } from 'vite-plus/test'

import { syncAgeKey } from './syncAge.js'

describe('sync age', () => {
  it.each(['2026-10-05 17:00:00', '2026-10-05T17:00:00Z', '2026-10-06T01:00:00+08:00'])(
    'handles SQLite UTC and explicit time zones: %s',
    (timestamp) => {
      expect(syncAgeKey(timestamp, Date.parse('2026-10-05T17:13:00Z'))).toEqual({
        key: 'status.minutesAgo',
        count: 13,
      })
    },
  )
  it('reports now for future clock skew and rejects invalid timestamps', () => {
    expect(syncAgeKey('2026-10-05T18:00:00Z', Date.parse('2026-10-05T17:00:00Z')).key).toBe(
      'status.now',
    )
    expect(() => syncAgeKey('invalid')).toThrow('Invalid sync timestamp')
  })
})
