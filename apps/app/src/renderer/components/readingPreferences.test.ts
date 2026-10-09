import { describe, expect, it } from 'vite-plus/test'

import {
  readReadingPreferences,
  saveReadingPreferences,
  DEFAULT_READING_PREFERENCES,
  clampDirectoryWidth,
} from './readingPreferences.js'

describe('global reading preferences', () => {
  it('restores both switches on a new session or app instance', () => {
    let value: string | null = null
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next
      },
    }
    expect(readReadingPreferences(storage)).toEqual(DEFAULT_READING_PREFERENCES)
    saveReadingPreferences(storage, {
      ...DEFAULT_READING_PREFERENCES,
      onlyUser: true,
      directoryOpen: true,
      directoryWidth: 360,
    })
    expect(readReadingPreferences(storage)).toEqual({
      ...DEFAULT_READING_PREFERENCES,
      onlyUser: true,
      directoryOpen: true,
      directoryWidth: 360,
    })
    saveReadingPreferences(storage, {
      ...DEFAULT_READING_PREFERENCES,
      onlyUser: true,
      directoryOpen: false,
    })
    expect(readReadingPreferences(storage)).toEqual({
      ...DEFAULT_READING_PREFERENCES,
      onlyUser: true,
      directoryOpen: false,
    })
  })
  it('reports corrupt or unavailable storage', () => {
    expect(() => readReadingPreferences({ getItem: () => '{' })).toThrow()
    expect(() => readReadingPreferences({ getItem: () => '{"onlyUser":"yes"}' })).toThrow()
    expect(() =>
      saveReadingPreferences(
        {
          setItem: () => {
            throw new Error('quota')
          },
        },
        { ...DEFAULT_READING_PREFERENCES, onlyUser: true, directoryOpen: false },
      ),
    ).toThrow('quota')
  })
  it('migrates existing settings with internal records hidden and a default width', () => {
    expect(
      readReadingPreferences({ getItem: () => '{"onlyUser":true,"directoryOpen":true}' }),
    ).toEqual({ ...DEFAULT_READING_PREFERENCES, onlyUser: true, directoryOpen: true })
    expect(clampDirectoryWidth(10)).toBe(220)
    expect(clampDirectoryWidth(999)).toBe(520)
    expect(() =>
      readReadingPreferences({
        getItem: () => '{"onlyUser":true,"directoryOpen":true,"directoryWidth":"300"}',
      }),
    ).toThrow()
  })
})
