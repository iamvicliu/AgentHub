import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import { SessionReadingTools, SessionMessageDirectory } from './SessionReadingTools.js'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    initialTopMostItemIndex,
  }: {
    initialTopMostItemIndex: { index: number; align: string }
  }) =>
    createElement('div', {
      'data-initial-index': initialTopMostItemIndex.index,
      'data-initial-align': initialTopMostItemIndex.align,
    }),
}))

describe('reading controls', () => {
  it('opens the directory at its newest entry and exposes accessible resizing', () => {
    const html = renderToStaticMarkup(
      createElement(SessionMessageDirectory, {
        entries: [
          { id: 1, number: 1, preview: 'Earlier' },
          { id: 2, number: 2, preview: 'Latest' },
        ],
        selectedId: null,
        width: 360,
        onWidthChange: () => {},
        onJump: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain('data-initial-index="1"')
    expect(html).toContain('data-initial-align="end"')
    expect(html).toContain('width:360px')
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-valuenow="360"')
  })
  it('uses consistent active styles without an internal toggle in the toolbar', () => {
    const html = renderToStaticMarkup(
      createElement(SessionReadingTools, {
        onlyUser: true,
        directoryOpen: true,
        userCount: 3,
        onOnlyUser: () => {},
        onDirectory: () => {},
      }),
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('session.internal')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="session-message-directory"')
    expect(html.match(/dark:text-dark-text font-medium/g)).toHaveLength(2)
  })
  it('does not render a directory as active while closed', () => {
    const props = {
      onlyUser: false,
      directoryOpen: false,
      userCount: 0,
      onOnlyUser: () => {},
      onDirectory: () => {},
    }
    const html = renderToStaticMarkup(createElement(SessionReadingTools, props))
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('dark:text-dark-text font-medium')
  })
})
