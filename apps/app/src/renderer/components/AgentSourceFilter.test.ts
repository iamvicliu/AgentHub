import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import AgentSourceFilter from './AgentSourceFilter.js'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'All' }) }))

describe('AgentSourceFilter', () => {
  it('sorts sources alphabetically without mutating input and keeps All first', () => {
    const sources = ['pi', 'openclaw', 'codex', 'hermes', 'claude', 'opencode', 'gemini'] as const
    const html = renderToStaticMarkup(
      createElement(AgentSourceFilter, {
        sources: [...sources, 'pi'],
        selected: null,
        onSelect: () => {},
      }),
    )
    expect([...html.matchAll(/data-source="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'all',
      'claude',
      'codex',
      'gemini',
      'hermes',
      'openclaw',
      'opencode',
      'pi',
    ])
    expect(sources[0]).toBe('pi')
  })
  it('hides known empty agents but keeps the full total and populated agents', () => {
    const html = renderToStaticMarkup(
      createElement(AgentSourceFilter, {
        sources: ['claude', 'codex'],
        selected: null,
        onSelect: () => {},
        counts: { all: 69, claude: 14, codex: 0 },
      }),
    )
    expect(html).toContain('>69</span>')
    expect(html).toContain('>14</span>')
    expect(html).not.toContain('data-source="codex"')
    expect(html).toContain('data-source="all"')
  })
  it.each([null, 'claude', 'codex', 'gemini'] as const)(
    'has exactly one selection: %s',
    (selected) => {
      const html = renderToStaticMarkup(
        createElement(AgentSourceFilter, {
          sources: ['claude', 'codex', 'gemini'],
          selected,
          onSelect: () => {},
        }),
      )
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
      expect(html).toContain(`data-source="${selected ?? 'all'}" aria-pressed="true"`)
    },
  )

  it('selects an agent directly, keeps repeated selection, and restores all explicitly', () => {
    const onSelect = vi.fn()
    const tree = AgentSourceFilter({ sources: ['claude', 'codex'], selected: 'claude', onSelect })
    const buttons = tree.props.children as Array<{ props: { onClick: () => void } }>
    buttons[1]!.props.onClick()
    buttons[2]!.props.onClick()
    buttons[0]!.props.onClick()
    expect(onSelect.mock.calls).toEqual([['claude'], ['codex'], [null]])
  })
})
