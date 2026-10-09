import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import SessionsApp from './SessionsApp.js'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./components/SessionDetail.js', () => ({ default: () => null }))
vi.mock('./components/SettingsPanel.js', () => ({ default: () => null }))
vi.mock('./components/SecurityPage.js', () => ({ default: () => null }))
vi.mock('./components/VirtualSessionList.js', () => ({ default: () => null }))
vi.mock('./components/FragmentResults.js', () => ({ default: () => null }))
vi.mock('./components/AppToaster.js', () => ({ default: () => null }))
vi.mock('./i18n/useLanguageBootstrap.js', () => ({ useLanguageBootstrap: () => {} }))

describe('SessionsApp', () => {
  it('renders a single library with all agents selected by default and no sidebar', () => {
    const html = renderToStaticMarkup(createElement(SessionsApp))
    expect(html).toContain('data-testid="sessions-app"')
    expect(html).toContain('data-source="all" aria-pressed="true"')
    expect(html).toContain('search.placeholder_home')
    expect(html).toContain('data-testid="status-text"')
    expect(html).toContain('data-testid="open-security"')
    expect(html).toContain('Hermes')
    expect(html).toContain('OpenClaw')
    expect(html).toContain('Pi')
    expect(html).not.toContain('data-testid="sidebar"')
    expect(html).not.toContain('Loose')
    expect(html).not.toContain('Shares')
    expect(html).not.toContain('Projects')
  })
})
