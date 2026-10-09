import { describe, expect, it } from 'vite-plus/test'

import { parseSessionLink } from '../shared/sessionLink.js'
import { messageFingerprint, resolveSessionMessage } from './sessionLink.js'

const message = {
  id: 1,
  msgUuid: 'claude:中文 +?#',
  seq: 4,
  role: 'user' as const,
  timestamp: '2026-10-06T00:00:00Z',
  contentText: 'fixture',
}
const hash = messageFingerprint(message)
const link = `agenthub://session/s?message=${encodeURIComponent(message.msgUuid)}&fingerprint=${hash}`

describe('local session links', () => {
  it('decodes encoded message identifiers and session identifiers', () => {
    expect(parseSessionLink(link).messageUuid).toBe(message.msgUuid)
    expect(parseSessionLink('agenthub://session/%E4%B8%AD%E6%96%87%20%2B').sessionUuid).toBe(
      '中文 +',
    )
  })
  it('opens a session without a message', () => {
    expect(resolveSessionMessage('agenthub://session/s', [])).toBeUndefined()
  })
  it('survives row ID changes on an index rebuild', () => {
    expect(resolveSessionMessage(link, [{ ...message, id: 990 }])).toBe(990)
  })
  it('requires an exact fingerprint for seq fallback', () => {
    const fallback = `agenthub://session/s?seq=4&fingerprint=${hash}`
    expect(resolveSessionMessage(fallback, [{ ...message, msgUuid: null }])).toBe(1)
    expect(() => resolveSessionMessage(fallback, [{ ...message, contentText: 'changed' }])).toThrow(
      '变化',
    )
  })
  it('rejects moved synthetic IDs rather than highlighting the wrong message', () => {
    expect(() => resolveSessionMessage(link, [{ ...message, contentText: 'other' }])).toThrow(
      '变化',
    )
  })
  it('reports absent or ambiguous messages', () => {
    expect(() => resolveSessionMessage(link, [])).toThrow('找不到')
    expect(() => resolveSessionMessage(link, [message, message])).toThrow('不唯一')
  })
  it.each([
    'https://session/s',
    'agenthub://auth/callback',
    'agenthub://session/',
    'agenthub://session/s/extra',
    'agenthub://session/%2Ftmp',
    'agenthub://session/%00',
    'agenthub://session/%ZZ',
    'agenthub://user@session/s',
    'agenthub://session:42/s',
    'agenthub://session/s#fragment',
    'agenthub://session/s?message=',
    'agenthub://session/s?message=a&message=b',
    'agenthub://session/s?path=/tmp',
    'agenthub://session/s?seq=1',
    'agenthub://session/s?seq=-1',
    `agenthub://session/s?seq=01&fingerprint=${hash}`,
    `agenthub://session/s?seq=9007199254740992&fingerprint=${hash}`,
    `agenthub://session/s?message=a&seq=1&fingerprint=${hash}`,
    'agenthub://session/s?fingerprint=no',
  ])('rejects malformed or unsafe links: %s', (raw) => {
    expect(() => parseSessionLink(raw)).toThrow()
  })
})
