import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import PinIcon from './PinIcon.js'

type Props = {
  sessionUuid: string
  pinned: boolean
  onChange?: (pinned: boolean) => void
  size?: 'sm' | 'md'
  showLabel?: boolean
}

export default function PinButton({
  sessionUuid,
  pinned,
  onChange,
  size = 'sm',
  showLabel = false,
}: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  async function toggle(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation()
    if (busy) return
    setBusy(true)
    const next = !pinned
    onChange?.(next)
    try {
      if (next) await window.spool.pinSession(sessionUuid)
      else await window.spool.unpinSession(sessionUuid)
      window.dispatchEvent(
        new CustomEvent('spool:pin-change', { detail: { sessionUuid, pinned: next } }),
      )
    } catch {
      onChange?.(pinned)
    } finally {
      setBusy(false)
    }
  }

  const dim = showLabel ? 'min-h-11 gap-2 px-3 text-sm' : size === 'md' ? 'w-11 h-11' : 'w-10 h-10'
  const icon = size === 'md' ? 16 : 13

  return (
    <button
      type="button"
      data-testid="pin-button"
      data-pinned={pinned ? '1' : '0'}
      onClick={(event) => {
        void toggle(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') void toggle(event)
      }}
      title={`${pinned ? t('sidebar.unpin') : t('sidebar.pin')} — ${t('session.pin_help')}`}
      aria-label={pinned ? t('sidebar.unpin') : t('sidebar.pin')}
      aria-pressed={pinned}
      className={`inline-flex items-center justify-center ${dim} rounded transition-colors ${
        pinned
          ? 'text-accent dark:text-accent-dark hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
          : 'text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      } disabled:cursor-not-allowed`}
      disabled={busy}
    >
      <PinIcon size={icon} filled={pinned} />
      {showLabel && <span>{pinned ? t('sidebar.unpin') : t('sidebar.pin')}</span>}
    </button>
  )
}
