import { expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  setContextMenu: vi.fn(),
  setToolTip: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
}))
vi.mock('electron', () => ({
  Tray: class {
    setContextMenu = mocks.setContextMenu
    setToolTip = mocks.setToolTip
    on = mocks.on
  },
  Menu: { buildFromTemplate: (items: unknown) => items },
  nativeImage: { createFromPath: () => ({}), createEmpty: () => ({}) },
  app: { getLocale: () => 'en-US', quit: mocks.quit },
}))

import { setupTray, updateTrayMenu } from './tray.js'

it('keeps click behavior, adds settings and refreshes labels when language changes', () => {
  const show = vi.fn(),
    sync = vi.fn(),
    settings = vi.fn()
  let language: 'zh-CN' | 'en' = 'zh-CN'
  setupTray(show, sync, settings, () => language)
  const menu = mocks.setContextMenu.mock.lastCall![0]
  expect(menu.map((item: { label?: string }) => item.label).filter(Boolean)).toEqual([
    '打开 AgentHub',
    '设置…',
    '立即同步',
    '退出 AgentHub',
  ])
  menu[1].click()
  expect(settings).toHaveBeenCalledOnce()
  expect(mocks.on).toHaveBeenCalledWith('click', show)
  expect(mocks.on).not.toHaveBeenCalledWith('right-click', expect.anything())
  language = 'en'
  updateTrayMenu()
  expect(mocks.setContextMenu.mock.lastCall![0][0].label).toBe('Open AgentHub')
  expect(mocks.setToolTip.mock.lastCall![0]).not.toContain('Spool')
})
