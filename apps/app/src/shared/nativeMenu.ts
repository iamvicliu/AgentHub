import type { MenuItemConstructorOptions } from 'electron'

import { nativeDialog as deDialog, nativeMenu as de } from '../renderer/i18n/locales/de.json'
import { nativeDialog as enDialog, nativeMenu as en } from '../renderer/i18n/locales/en.json'
import { nativeDialog as frDialog, nativeMenu as fr } from '../renderer/i18n/locales/fr.json'
import { nativeDialog as jaDialog, nativeMenu as ja } from '../renderer/i18n/locales/ja.json'
import { nativeDialog as koDialog, nativeMenu as ko } from '../renderer/i18n/locales/ko.json'
import { nativeDialog as zhCNDialog, nativeMenu as zhCN } from '../renderer/i18n/locales/zh-CN.json'
import { nativeDialog as zhTWDialog, nativeMenu as zhTW } from '../renderer/i18n/locales/zh-TW.json'

const translations = { en, de, fr, ja, ko, 'zh-CN': zhCN, 'zh-TW': zhTW }
type Locale = keyof typeof translations
const dialogTranslations = {
  en: enDialog,
  de: deDialog,
  fr: frDialog,
  ja: jaDialog,
  ko: koDialog,
  'zh-CN': zhCNDialog,
  'zh-TW': zhTWDialog,
}

type DialogKey = keyof typeof enDialog

/** Native dialog copy in the app language, with `{{name}}` placeholders filled in. */
export function nativeDialogText(preference: Locale | 'system' | undefined, systemLocale: string) {
  const locale =
    !preference || preference === 'system' ? normalizeSystemLocale(systemLocale) : preference
  const table = dialogTranslations[locale]
  return (key: DialogKey, values: Record<string, string | number> = {}) =>
    table[key].replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    )
}

export function trayMenuLabels(preference: Locale | 'system' | undefined, systemLocale: string) {
  const locale =
    !preference || preference === 'system' ? normalizeSystemLocale(systemLocale) : preference
  return translations[locale]
}

export function normalizeSystemLocale(tag: string): Locale {
  const raw = tag.toLowerCase().replaceAll('_', '-')
  if (raw.startsWith('zh')) {
    if (raw.includes('hans')) return 'zh-CN'
    if (raw.includes('hant') || /-(tw|hk|mo)(?:-|$)/.test(raw)) return 'zh-TW'
    return 'zh-CN'
  }
  const base = raw.split('-')[0]
  return base === 'ja' || base === 'ko' || base === 'de' || base === 'fr' ? base : 'en'
}

export function applicationMenuTemplate(
  preference: Locale | 'system' | undefined,
  systemLocale: string,
  isMac: boolean,
  openSettings: () => void,
): MenuItemConstructorOptions[] {
  const locale =
    !preference || preference === 'system' ? normalizeSystemLocale(systemLocale) : preference
  const t = translations[locale]
  const separator: MenuItemConstructorOptions = { type: 'separator' }
  const item = (
    role: NonNullable<MenuItemConstructorOptions['role']>,
    label: string,
  ): MenuItemConstructorOptions => ({ role, label })
  return [
    {
      label: 'AgentHub',
      submenu: [
        item('about', t.about),
        { label: t.settings, accelerator: 'CmdOrCtrl+,', click: openSettings },
        ...(isMac
          ? [
              separator,
              { role: 'services' as const, label: t.services, submenu: [] },
              separator,
              item('hide', t.hide),
              item('hideOthers', t.hideOthers),
              item('unhide', t.showAll),
            ]
          : []),
        separator,
        item('quit', t.quit),
      ],
    },
    {
      role: 'editMenu',
      label: t.edit,
      submenu: [
        item('undo', t.undo),
        item('redo', t.redo),
        separator,
        item('cut', t.cut),
        item('copy', t.copy),
        item('paste', t.paste),
        item('pasteAndMatchStyle', t.pasteMatch),
        item('delete', t.delete),
        separator,
        item('selectAll', t.selectAll),
        ...(isMac
          ? [
              separator,
              {
                label: t.speech,
                submenu: [
                  item('startSpeaking', t.startSpeaking),
                  item('stopSpeaking', t.stopSpeaking),
                ],
              },
            ]
          : []),
      ],
    },
    {
      role: 'viewMenu',
      label: t.view,
      submenu: [
        item('reload', t.reload),
        item('forceReload', t.forceReload),
        item('toggleDevTools', t.devTools),
        separator,
        item('resetZoom', t.resetZoom),
        item('zoomIn', t.zoomIn),
        item('zoomOut', t.zoomOut),
        separator,
        item('togglefullscreen', t.fullscreen),
      ],
    },
    {
      role: 'windowMenu',
      label: t.window,
      submenu: [
        item('minimize', t.minimize),
        item('zoom', t.zoom),
        item('close', t.close),
        ...(isMac ? [separator, item('front', t.front)] : []),
      ],
    },
  ]
}
