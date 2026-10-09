import { createInstance } from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vite-plus/test'

import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import SecurityIntroduction from './SecurityIntroduction.js'

describe('security introduction', () => {
  it.each(['zh-CN', 'en', 'de'])('explains scope and action boundaries in %s', async (lng) => {
    const i18n = createInstance()
    await i18n.init({
      lng,
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        'zh-CN': { translation: zh },
      },
    })
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(SecurityIntroduction)),
    )
    expect(html).toContain('data-testid="security-introduction"')
    expect(html).toContain('<details')
    expect(html).toContain(i18n.t('security.introduction_body'))
    expect(html).toContain(i18n.t('security.introduction_actions').replace(/'/g, '&#x27;'))
    expect(html).not.toContain('security.introduction_')
    expect(html).toContain(lng === 'zh-CN' ? '不会上传会话' : 'upload conversations')
  })
})
