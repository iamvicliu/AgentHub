import { describe, expect, it } from 'vite-plus/test'

import { sessionFindKeyAction } from './sessionFindKeys.js'

const key = (name: string, overrides = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
})

describe('session find keys', () => {
  it('supports standard next and previous match keys on macOS', () => {
    expect(sessionFindKeyAction(key('g', { metaKey: true }), true)).toBe('next')
    expect(sessionFindKeyAction(key('G', { metaKey: true, shiftKey: true }), true)).toBe('previous')
  })
  it('keeps legacy arrows and input Enter navigation', () => {
    expect(sessionFindKeyAction(key('ArrowRight', { metaKey: true }), true)).toBe('next')
    expect(sessionFindKeyAction(key('ArrowLeft', { metaKey: true }), true)).toBe('previous')
    expect(sessionFindKeyAction(key('Enter'), true)).toBe('next')
    expect(sessionFindKeyAction(key('Enter', { shiftKey: true }), true)).toBe('previous')
    expect(sessionFindKeyAction(key('Escape'), true)).toBe('close')
  })
  it('uses Ctrl on other platforms without hijacking plain caret movement or IME', () => {
    expect(sessionFindKeyAction(key('g', { ctrlKey: true }), false)).toBe('next')
    expect(sessionFindKeyAction(key('ArrowLeft'), true)).toBeNull()
    expect(sessionFindKeyAction(key('g'), true)).toBeNull()
    expect(sessionFindKeyAction(key('Enter', { isComposing: true }), true)).toBeNull()
  })
})
