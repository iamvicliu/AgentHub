import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import SettingsSection, {
  SettingsSectionHeading,
  settingsLabelClass,
  settingsDescriptionClass,
} from './SettingsSection.js'

describe('settings typography', () => {
  it('renders a prominent heading above the section content', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSection, { title: 'Language', children: 'Select a language' }),
    )
    expect(html).toContain('border-t')
    expect(html).toContain('first:border-t-0')
    expect(html).toContain('class="mb-2"')
    expect(html).not.toContain('border-b')
    expect(html).toContain('text-base leading-6 font-semibold')
    expect(html.indexOf('Language</h4>')).toBeLessThan(html.indexOf('Select a language'))
  })

  it('uses distinct label and description hierarchy in both themes', () => {
    expect(settingsLabelClass).toContain('text-sm font-medium')
    expect(settingsLabelClass).toContain('dark:text-dark-text')
    expect(settingsDescriptionClass).toContain('text-xs leading-relaxed')
    expect(settingsDescriptionClass).toContain('dark:text-dark-muted')
  })

  it('supports the same heading style in the appearance toolbar', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSectionHeading, { children: 'Appearance' }),
    )
    expect(html).toContain('text-base leading-6 font-semibold')
    expect(html).toContain('dark:text-dark-text')
    expect(html).not.toContain('uppercase')
  })
})
