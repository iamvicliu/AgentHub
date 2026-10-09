import { join } from 'node:path'

import { Tray, Menu, nativeImage, app } from 'electron'

import { trayMenuLabels } from '../shared/nativeMenu.js'

let tray: Tray | null = null

let refreshMenu: (() => void) | undefined

export function updateTrayMenu(): void {
  refreshMenu?.()
}

export function setupTray(
  onShow: () => void,
  onSync: () => void,
  onSettings: () => void,
  getLanguage: () => Parameters<typeof trayMenuLabels>[0],
): void {
  // Template image — macOS auto-handles light/dark tint.
  // File named *Template* so Electron marks it as template automatically.
  const iconPath = join(__dirname, '../../resources/tray-iconTemplate.png')
  let icon: ReturnType<typeof nativeImage.createFromPath>
  try {
    icon = nativeImage.createFromPath(iconPath)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  refreshMenu = () => {
    const t = trayMenuLabels(getLanguage(), app.getLocale())
    tray?.setToolTip(t.trayTooltip)
    const contextMenu = Menu.buildFromTemplate([
      { label: t.openApp, click: onShow },
      { label: t.settings, click: onSettings },
      { type: 'separator' },
      { label: t.syncNow, click: onSync },
      { type: 'separator' },
      { label: t.quit, click: () => app.quit() },
    ])

    tray?.setContextMenu(contextMenu)
  }
  updateTrayMenu()
  tray.on('click', onShow)
}
