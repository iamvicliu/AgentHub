export const READING_PREFERENCES_KEY = 'spool:reading-preferences:v1'
export const DIRECTORY_MIN_WIDTH = 220
export const DIRECTORY_MAX_WIDTH = 520
export const DEFAULT_READING_PREFERENCES = {
  onlyUser: false,
  directoryOpen: false,
  directoryWidth: 280,
  showInternal: false,
}
export type ReadingPreferences = typeof DEFAULT_READING_PREFERENCES

export function clampDirectoryWidth(width: number): number {
  return Math.round(Math.min(DIRECTORY_MAX_WIDTH, Math.max(DIRECTORY_MIN_WIDTH, width)))
}

export function readReadingPreferences(storage: Pick<Storage, 'getItem'>): ReadingPreferences {
  const raw = storage.getItem(READING_PREFERENCES_KEY)
  if (raw === null) return { ...DEFAULT_READING_PREFERENCES }
  const value = JSON.parse(raw)
  if (!value || typeof value.onlyUser !== 'boolean' || typeof value.directoryOpen !== 'boolean')
    throw new Error('Invalid reading preferences')
  if (value.showInternal !== undefined && typeof value.showInternal !== 'boolean')
    throw new Error('Invalid internal record preference')
  if (value.directoryWidth !== undefined && !Number.isFinite(value.directoryWidth))
    throw new Error('Invalid directory width')
  return {
    onlyUser: value.onlyUser,
    directoryOpen: value.directoryOpen,
    showInternal: value.showInternal ?? false,
    directoryWidth: clampDirectoryWidth(value.directoryWidth ?? 280),
  }
}

export function saveReadingPreferences(
  storage: Pick<Storage, 'setItem'>,
  prefs: ReadingPreferences,
) {
  storage.setItem(READING_PREFERENCES_KEY, JSON.stringify(prefs))
}
