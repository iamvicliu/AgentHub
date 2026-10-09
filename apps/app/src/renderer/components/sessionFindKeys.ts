import { eventToCombos, normalizeCombo } from '../hooks/useHotkeys.js'

type FindKey = Parameters<typeof eventToCombos>[0] & { isComposing?: boolean }

export function sessionFindKeyAction(event: FindKey, isMac: boolean) {
  if (event.isComposing) return null
  const combos = eventToCombos(event)
  if (combos.includes('escape')) return 'close'
  const previous = ['shift+enter', 'mod+shift+g', 'mod+arrowleft']
  const next = ['enter', 'mod+g', 'mod+arrowright']
  if (previous.some((key) => combos.includes(normalizeCombo(key, isMac)))) return 'previous'
  if (next.some((key) => combos.includes(normalizeCombo(key, isMac)))) return 'next'
  return null
}
