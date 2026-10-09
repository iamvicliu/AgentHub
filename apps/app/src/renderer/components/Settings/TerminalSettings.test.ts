import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import TerminalSettings from './TerminalSettings.js'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
describe('terminal settings controls', () => {
  it('exposes discovery, custom addition and testing, preserving a custom preference', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalSettings, {
        config: {
          terminal: 'custom:test',
          customTerminals: [
            {
              id: 'custom:test',
              name: 'My terminal',
              executable: '/tmp/test',
              args: ['{command}'],
            },
          ],
        },
        onSave: async () => {},
      }),
    )
    expect(html).toContain('settings.terminal_add')
    expect(html).toContain('settings.terminal_test')
    expect(html).toContain('settings.terminal_refresh')
    expect(html).toContain('value="custom:test" selected=""')
  })
})
