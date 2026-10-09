import type { SessionSource } from '@spool-lab/core'
import { useTranslation } from 'react-i18next'

import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'

type Props = {
  sources: SessionSource[]
  selected: SessionSource | null
  onSelect: (source: SessionSource | null) => void
  counts?: Partial<Record<SessionSource | 'all', number>> | undefined
}

export default function AgentSourceFilter({ sources, selected, onSelect, counts }: Props) {
  const { t } = useTranslation()
  return (
    <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Agent">
      {[
        null,
        ...Array.from(new Set(sources))
          .filter((source) => counts?.[source] !== 0)
          .sort((a, b) => getSessionSourceLabel(a).localeCompare(getSessionSourceLabel(b), 'en')),
      ].map((source) => {
        const active = selected === source
        return (
          <button
            key={source ?? 'all'}
            type="button"
            data-testid="source-filter-pill"
            data-source={source ?? 'all'}
            aria-pressed={active}
            onClick={() => onSelect(source)}
            className={`flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text font-medium'
                : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
            }`}
          >
            {source && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 flex-none rounded-full"
                style={{ background: getSessionSourceColor(source) }}
              />
            )}
            <span>{source ? getSessionSourceLabel(source) : t('common.all')}</span>
            {counts?.[source ?? 'all'] !== undefined && (
              <span className="text-warm-muted dark:text-dark-muted font-mono text-xs tabular-nums">
                {counts[source ?? 'all']}
              </span>
            )}
          </button>
        )
      })}
    </span>
  )
}
