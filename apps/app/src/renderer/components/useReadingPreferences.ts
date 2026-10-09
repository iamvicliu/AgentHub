import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DEFAULT_READING_PREFERENCES,
  readReadingPreferences,
  saveReadingPreferences,
  type ReadingPreferences,
} from './readingPreferences.js'

export function useReadingPreferences() {
  const { t } = useTranslation()
  const [initial] = useState(() => {
    try {
      return { prefs: readReadingPreferences(window.localStorage), error: null }
    } catch (error) {
      return { prefs: { ...DEFAULT_READING_PREFERENCES }, error }
    }
  })
  const [prefs, setPrefs] = useState(initial.prefs)
  useEffect(() => {
    if (initial.error) {
      console.error('[reading preferences] load failed', initial.error)
      toast.error(t('session.readingPreferenceError'))
    }
  }, [initial, t])
  useEffect(() => {
    function refresh() {
      try {
        setPrefs(readReadingPreferences(window.localStorage))
      } catch (error) {
        console.error('[reading preferences] refresh failed', error)
        toast.error(t('session.readingPreferenceError'))
      }
    }
    window.addEventListener('spool:reading-preferences-changed', refresh)
    return () => window.removeEventListener('spool:reading-preferences-changed', refresh)
  }, [t])
  function update(patch: Partial<ReadingPreferences>) {
    const next = { ...prefs, ...patch }
    try {
      saveReadingPreferences(window.localStorage, next)
      setPrefs(next)
      window.dispatchEvent(new Event('spool:reading-preferences-changed'))
    } catch (error) {
      console.error('[reading preferences] save failed', error)
      toast.error(t('session.readingPreferenceError'))
    }
  }
  return { prefs, update }
}
