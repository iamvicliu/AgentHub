import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import FragmentResults from './FragmentResults.js'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../shared/formatDate.js', () => ({ formatRelativeDate: (iso: string) => iso }))
vi.mock('./ContinueActions.js', () => ({ default: () => null }))
vi.mock('../hooks/useIsDark.js', () => ({ useIsDark: () => false }))

describe('FragmentResults', () => {
  it('renders a result with its title above the snippet and its message timestamp', () => {
    const html = renderToStaticMarkup(
      createElement(FragmentResults, {
        results: [
          {
            kind: 'fragment',
            rank: 1,
            sessionId: 1,
            sessionUuid: 'session-test',
            sessionTitle: 'Search title',
            matchCount: 1,
            matchType: 'fts',
            source: 'codex',
            project: '/tmp/test',
            startedAt: '2026-01-01T00:00:00Z',
            messageTimestamp: '2026-10-06T12:00:00Z',
            messageId: 1,
            messageRole: 'user',
            snippet: 'Search <mark>body</mark> & <script>example</script>',
          },
        ],
        query: 'Search',
        defaultSortOrder: 'relevance',
        onOpenSession: () => {},
        onCopySessionId: () => {},
        onShareSession: () => {},
      }),
    )
    expect(html).toContain('2026-10-06T12:00:00Z')
    expect(html).not.toContain('2026-01-01T00:00:00Z')
    expect(html).toContain('<strong>Search</strong> title')
    expect(html.indexOf('<strong>Search</strong> title')).toBeLessThan(
      html.indexOf('Search <strong>body</strong>'),
    )
    expect(html).toContain('&lt;script&gt;example&lt;/script&gt;')
  })
})
