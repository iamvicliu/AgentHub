import { describe, expect, it } from 'vite-plus/test'

import { formatComboParts, SHORTCUT_GROUPS, splitAlternatives } from './shortcuts.js'

describe('current shortcut catalog', () => {
  it('renders the native Settings shortcut without splitting the comma key', () => {
    expect(splitAlternatives('mod+,')).toEqual(['mod+,'])
    expect(formatComboParts('mod+,', true)).toEqual(['⌘', ','])
    expect(splitAlternatives('mod+arrowleft,mod+arrowright')).toHaveLength(2)
  })
  it('removes shortcuts for retired navigation and sharing surfaces', () => {
    expect(SHORTCUT_GROUPS.map((group) => group.id)).toEqual(['global', 'search', 'session'])
    expect(SHORTCUT_GROUPS.find((group) => group.id === 'search')?.shortcuts).toEqual([
      { id: 'close', combo: 'escape' },
    ])
  })
  it('documents standard match navigation and a quick back action', () => {
    const shortcuts = SHORTCUT_GROUPS.find((group) => group.id === 'session')!.shortcuts
    expect(shortcuts.find((s) => s.id === 'prevNextMatch')?.combo).toBe('mod+shift+g,mod+g')
    expect(shortcuts.find((s) => s.id === 'back')?.combo).toBe('mod+[,alt+arrowleft')
  })
})
