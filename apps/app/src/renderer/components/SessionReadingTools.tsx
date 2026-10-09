import { List, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'

import {
  clampDirectoryWidth,
  DIRECTORY_MIN_WIDTH,
  DIRECTORY_MAX_WIDTH,
} from './readingPreferences.js'
import type { userMessageDirectory } from './sessionReading.js'

type Props = {
  onlyUser: boolean
  directoryOpen: boolean
  userCount: number
  onOnlyUser: () => void
  onDirectory: () => void
}

const buttonClass =
  'min-h-11 rounded-md px-3 text-sm transition-colors hover:bg-warm-surface2 dark:hover:bg-dark-surface2'

function readingButtonClass(active: boolean) {
  return `${buttonClass} ${active ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text font-medium' : 'text-warm-muted dark:text-dark-muted'}`
}

export function SessionReadingTools(props: Props) {
  const { t } = useTranslation()
  return (
    <div className="border-warm-border dark:border-dark-border flex flex-none flex-wrap items-center gap-1 border-b px-6 py-1">
      <button
        type="button"
        aria-pressed={props.onlyUser}
        onClick={props.onOnlyUser}
        className={readingButtonClass(props.onlyUser)}
      >
        {t('session.onlyUser')}
      </button>
      <button
        type="button"
        aria-expanded={props.directoryOpen}
        aria-controls="session-message-directory"
        onClick={props.onDirectory}
        className={`${readingButtonClass(props.directoryOpen)} ml-auto inline-flex items-center gap-2`}
      >
        <List size={16} aria-hidden />
        {t('session.messageDirectory', { count: props.userCount })}
      </button>
    </div>
  )
}

export function SessionMessageDirectory({
  entries,
  selectedId,
  onJump,
  onClose,
  width,
  onWidthChange,
}: {
  entries: ReturnType<typeof userMessageDirectory>
  selectedId: number | null | undefined
  onJump: (id: number) => void
  onClose: () => void
  width: number
  onWidthChange: (width: number) => void
}) {
  const { t } = useTranslation()
  const drag = useRef<{ x: number; width: number; current: number } | null>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const displayedWidth = dragWidth ?? width
  return (
    <aside
      id="session-message-directory"
      aria-label={t('session.directoryTitle')}
      style={{ width: displayedWidth }}
      className="border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg absolute inset-y-0 right-0 z-10 flex max-w-full flex-col border-l md:relative md:max-w-[50%] md:flex-none"
    >
      <div
        role="separator"
        aria-label={t('session.resizeDirectory')}
        aria-orientation="vertical"
        aria-valuemin={DIRECTORY_MIN_WIDTH}
        aria-valuemax={DIRECTORY_MAX_WIDTH}
        aria-valuenow={displayedWidth}
        tabIndex={0}
        title={t('session.resizeDirectoryHelp')}
        className="hover:bg-accent/15 focus-visible:bg-accent/15 absolute inset-y-0 -left-2 z-20 w-4 cursor-col-resize touch-none focus-visible:outline-none"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, width: displayedWidth, current: displayedWidth }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          const next = clampDirectoryWidth(drag.current.width + drag.current.x - event.clientX)
          drag.current.current = next
          setDragWidth(next)
        }}
        onPointerUp={(event) => {
          if (!drag.current) return
          const next = drag.current.current
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          onWidthChange(next)
          setDragWidth(null)
        }}
        onLostPointerCapture={() => {
          drag.current = null
          setDragWidth(null)
        }}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowLeft'
              ? width + 20
              : event.key === 'ArrowRight'
                ? width - 20
                : event.key === 'Home'
                  ? DIRECTORY_MIN_WIDTH
                  : event.key === 'End'
                    ? DIRECTORY_MAX_WIDTH
                    : null
          if (next === null) return
          event.preventDefault()
          onWidthChange(clampDirectoryWidth(next))
        }}
      />
      <div className="flex items-center justify-between px-3 py-1">
        <h3 className="text-warm-text dark:text-dark-text text-sm font-semibold">
          {t('session.directoryTitle')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('session.closeDirectory')}
          className="text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 flex h-11 w-11 items-center justify-center rounded-md"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-warm-muted dark:text-dark-muted px-4 text-sm">
          {t('session.noUserMessages')}
        </p>
      ) : (
        <Virtuoso
          className="min-h-0 flex-1"
          data={entries}
          initialTopMostItemIndex={{ index: entries.length - 1, align: 'end' }}
          computeItemKey={(_index, entry) => entry.id}
          itemContent={(_index, entry) => (
            <button
              type="button"
              onClick={() => onJump(entry.id)}
              aria-current={selectedId === entry.id ? 'true' : undefined}
              className={`hover:bg-warm-surface2 dark:hover:bg-dark-surface2 flex min-h-11 w-full items-start gap-2 px-4 py-3 text-left text-xs ${selectedId === entry.id ? 'bg-warm-surface2 dark:bg-dark-surface2 text-accent dark:text-accent-dark' : 'text-warm-muted dark:text-dark-muted'}`}
            >
              <span className="flex-none font-mono tabular-nums">{entry.number}.</span>
              <span className="line-clamp-3 font-mono break-words">
                {entry.preview || t('session.nonTextMessage')}
              </span>
            </button>
          )}
        />
      )}
    </aside>
  )
}
