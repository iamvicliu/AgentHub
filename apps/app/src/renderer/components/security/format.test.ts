import { SENSITIVE_KIND_ORDER } from '@spool-lab/redact'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vite-plus/test'

import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import { friendlyMaskName } from './format.js'

describe('localized security categories', () => {
  it('uses the same Chinese names for all scanner kinds on pages and settings', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'zh-CN',
      resources: { 'zh-CN': { translation: zh }, en: { translation: en } },
      fallbackLng: 'en',
    })
    for (const kind of SENSITIVE_KIND_ORDER) {
      expect(friendlyMaskName(kind, i18n.t)).toMatch(/[\u4e00-\u9fff]/)
    }
    expect(friendlyMaskName('env-var', i18n.t)).toBe('环境变量中的密钥')
    expect(friendlyMaskName('bearer', i18n.t)).toBe('访问令牌')
    expect(friendlyMaskName('future-kind', i18n.t)).toBe('future-kind')
    await i18n.changeLanguage('en')
    expect(friendlyMaskName('env-var', i18n.t)).toBe('Env-var secret')
  })
})
