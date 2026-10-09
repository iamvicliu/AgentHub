import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  applicationMenuTemplate,
  nativeDialogText,
  normalizeSystemLocale,
  trayMenuLabels,
} from './nativeMenu.js'

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ])
}

describe('native application menu', () => {
  it('localizes tray actions using the app preference or system locale', () => {
    expect(trayMenuLabels('zh-CN', 'en-US')).toMatchObject({
      openApp: '打开 AgentHub',
      syncNow: '立即同步',
      settings: '设置…',
      quit: '退出 AgentHub',
    })
    expect(trayMenuLabels('system', 'zh-TW').openApp).toBe('開啟 AgentHub')
    expect(trayMenuLabels('en', 'zh-CN').openApp).toBe('Open AgentHub')
  })
  it.each([
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hans-HK', 'zh-CN'],
    ['zh-Hant-CN', 'zh-TW'],
    ['zh_TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
    ['de-DE', 'de'],
    ['fr-CA', 'fr'],
    ['es-ES', 'en'],
  ])('normalizes %s to %s', (tag, locale) => expect(normalizeSystemLocale(tag)).toBe(locale))

  it.each(['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr'] as const)(
    'labels every item in %s and preserves native roles',
    (locale) => {
      const menu = applicationMenuTemplate(locale, 'en-US', true, () => {})
      const items = flatten(menu)
      expect(
        items.filter((item) => item.type !== 'separator').every((item) => Boolean(item.label)),
      ).toBe(true)
      expect(items.filter((item) => item.role).map((item) => item.role)).toContain(
        'pasteAndMatchStyle',
      )
      expect(items.find((item) => item.accelerator === 'CmdOrCtrl+,')).toBeDefined()
      expect(menu.map((item) => item.label)).toHaveLength(4)
    },
  )

  it('uses the selected app language, not the OS language, and handles system preference', () => {
    expect(applicationMenuTemplate('zh-CN', 'en-US', true, () => {})[1]?.label).toBe('编辑')
    expect(applicationMenuTemplate('en', 'zh-CN', true, () => {})[1]?.label).toBe('Edit')
    expect(applicationMenuTemplate('system', 'zh-Hant-HK', true, () => {})[1]?.label).toBe('編輯')
    expect(applicationMenuTemplate(undefined, 'de-DE', true, () => {})[1]?.label).toBe('Bearbeiten')
  })

  it('opens Settings through the same callback and omits Mac-only roles elsewhere', () => {
    const open = vi.fn()
    const items = flatten(applicationMenuTemplate('zh-CN', 'en-US', false, open))
    const settings = items.find((item) => item.label === '设置…')!
    const click = settings.click as () => void
    click()
    expect(open).toHaveBeenCalledOnce()
    expect(items.map((item) => item.role)).not.toContain('hideOthers')
  })
})

describe('native dialog text', () => {
  it('follows the app language and fills placeholders', () => {
    expect(nativeDialogText('zh-CN', 'en-US')('running', { pid: 42 })).toContain('PID 42')
    expect(nativeDialogText('system', 'ja-JP')('blockedTitle')).toBe(
      'このセッションは削除できません',
    )
    expect(nativeDialogText(undefined, 'fr-FR')('deleteTitle', { title: 'X' })).toBe(
      'Supprimer la session « X » ?',
    )
    expect(nativeDialogText('en', 'en')('partial')).toContain('{{moved}}')
  })

  it('has every dialog string in every language', () => {
    for (const language of ['en', 'de', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const) {
      const text = nativeDialogText(language, 'en')
      expect(text('unsupported', { source: 'Hermes' })).toContain('Hermes')
      expect(text('running', { pid: 7 })).toContain('7')
    }
  })
})
