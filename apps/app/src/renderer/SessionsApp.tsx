import type {
  ProjectSessionSortOrder,
  SearchResult,
  Session,
  SessionSource,
  SessionsCursor,
  StatusInfo,
} from '@spool-lab/core'
import { Search, Settings, RefreshCw, X, ShieldCheck, ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { LanguagePreference } from '../preload/index.js'
import type { SearchSortOrder } from '../shared/searchSort.js'
import { SORTED_SESSION_SOURCES } from '../shared/sessionSources.js'
import { syncAgeKey } from '../shared/syncAge.js'
import { securityApi } from './api/security.js'
import { primeSecurityPrefsCache } from './api/securityPrefsCache.js'
import AgentSourceFilter from './components/AgentSourceFilter.js'
import AppToaster from './components/AppToaster.js'
import FragmentResults from './components/FragmentResults.js'
import SecurityPage from './components/SecurityPage.js'
import SessionDetail from './components/SessionDetail.js'
import SessionManagement from './components/SessionManagement.js'
import SettingsPanel from './components/SettingsPanel.js'
import VirtualSessionList, { type SessionListRow } from './components/VirtualSessionList.js'
import { useHotkeys } from './hooks/useHotkeys.js'
import { useLanguageBootstrap } from './i18n/useLanguageBootstrap.js'
import { applyEditorTheme } from './theme/applyEditorTheme.js'
import { defaultThemeEditorState, type ThemeEditorStateV1 } from './theme/editorTypes.js'
import { loadThemeEditorState, saveThemeEditorState } from './theme/persist.js'

const PAGE_SIZE = 50
// One list for every surface: the filter bar and the settings page both read
// SORTED_SESSION_SOURCES, so adding a source can no longer update one and miss
// the other.
const SOURCES: SessionSource[] = [...SORTED_SESSION_SOURCES]
const controlClass =
  'min-h-11 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3 text-sm'

export default function SessionsApp() {
  const { t } = useTranslation()
  const [source, setSource] = useState<SessionSource | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSessionSortOrder>('recent')
  const [searchSort, setSearchSort] = useState<SearchSortOrder>('relevance')
  const [sessions, setSessions] = useState<Session[]>([])
  const [pinned, setPinned] = useState<Session[]>([])
  const [cursor, setCursor] = useState<SessionsCursor | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{
    uuid: string
    messageId?: number | undefined
    linkNonce?: number
  } | null>(null)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [syncing, setSyncing] = useState(false)
  // A background refresh (the file watcher saw an agent write) keeps the list
  // on screen and only reports itself in the footer.
  const [updating, setUpdating] = useState(false)
  const listKey = useRef<string | null>(null)
  const loadedCount = useRef(0)
  const updatingSince = useRef(0)
  const updatingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'security'>('general')
  const [language, setLanguage] = useState<LanguagePreference>()
  const [theme, setTheme] = useState<ThemeEditorStateV1>(defaultThemeEditorState)
  const searchRef = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const paging = useRef(false)
  const linkRequest = useRef(0)
  useLanguageBootstrap(language)
  useHotkeys({
    'mod+k': () => {
      setSelected(null)
      searchRef.current?.focus()
    },
  })

  useHotkeys(
    {
      'mod+[': () => setSecurityOpen(false),
      'alt+arrowleft': () => setSecurityOpen(false),
      Escape: () => setSecurityOpen(false),
    },
    { active: securityOpen && !selected, skipInEditable: true },
  )

  function reportError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason)
    setError(message)
  }

  useEffect(() => {
    void primeSecurityPrefsCache()
    void window.spool
      .getAgentsConfig()
      .then((config) => {
        setLanguage(config.language ?? 'system')
        setSearchSort(config.defaultSearchSort ?? 'relevance')
      })
      .catch(reportError)
    void loadThemeEditorState().then(setTheme).catch(reportError)
    const updateStatus = () => {
      void window.spool.getStatus().then(setStatus).catch(reportError)
      setRefresh((value) => value + 1)
    }
    updateStatus()
    const offNew = window.spool.onNewSessions(updateStatus)
    const offSettings = window.spool.onOpenSettings(() => {
      setSettingsTab('general')
      setSettingsOpen(true)
    })
    const offSecurity = securityApi.onChange(updateStatus)
    const offProgress = window.spool.onSyncProgress((event) => {
      setSyncing(event.phase !== 'done' && event.phase !== 'error')
      if (event.phase === 'done') updateStatus()
    })
    window.addEventListener('spool:pin-change', updateStatus)
    return () => {
      offNew()
      offSettings()
      offSecurity()
      offProgress()
      window.removeEventListener('spool:pin-change', updateStatus)
    }
  }, [])

  useEffect(() => {
    const off = window.spool.onOpenSessionLink((raw) => {
      const request = ++linkRequest.current
      void window.spool
        .resolveSessionLink(raw)
        .then((result) => {
          if (request !== linkRequest.current) return
          if (!result.ok) {
            toast.error(result.error, { duration: 8000 })
            return
          }
          setSettingsOpen(false)
          setSecurityOpen(false)
          setSelected({ uuid: result.sessionUuid, messageId: result.messageId, linkNonce: request })
        })
        .catch((reason) => toast.error(String(reason)))
    })
    void window.spool.sessionLinksReady().catch(reportError)
    return () => {
      off()
      ++linkRequest.current
    }
  }, [])

  useEffect(() => {
    applyEditorTheme(theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyEditorTheme(theme)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])

  useEffect(() => {
    loadedCount.current = sessions.length
  }, [sessions])

  useEffect(() => {
    const token = ++generation.current
    // Same filter, sort and query as what is on screen: this is a refresh from a
    // watcher event. Swap the data in place instead of blanking the list to
    // "Loading…" — agents write every few seconds, and that blink was constant.
    const key = `${source ?? ''}|${sort}|${query.trim()}`
    const background = listKey.current === key
    listKey.current = key
    if (background) {
      if (updatingTimer.current) clearTimeout(updatingTimer.current)
      updatingSince.current = Date.now()
      setUpdating(true)
      setError(null)
    } else {
      setLoading(true)
      setError(null)
      setLoadingMore(false)
      paging.current = false
    }
    const timer = setTimeout(
      async () => {
        try {
          if (query.trim()) {
            const found = await window.spool.search(query.trim(), 200, source ?? undefined)
            if (generation.current !== token) return
            setResults(found)
          } else {
            const [pins, page] = await Promise.all([
              window.spool.listPinnedSessions(),
              window.spool.listSessions({
                // Keep every page already scrolled into view.
                limit: background ? Math.max(PAGE_SIZE, loadedCount.current) : PAGE_SIZE,
                sortOrder: sort,
                ...(source ? { sources: [source] } : {}),
                excludePinned: true,
              }),
            ])
            if (generation.current !== token) return
            setPinned(pins.filter((session) => source === null || session.source === source))
            setSessions(page.sessions)
            setCursor(page.nextCursor)
          }
        } catch (reason) {
          if (generation.current === token) reportError(reason)
        } finally {
          if (generation.current === token) {
            setLoading(false)
            // A refresh takes milliseconds; hold the footer note long enough
            // to read instead of flashing it.
            const left = 800 - (Date.now() - updatingSince.current)
            updatingTimer.current = setTimeout(() => setUpdating(false), Math.max(0, left))
          }
        }
      },
      query.trim() ? 200 : 0,
    )
    return () => {
      clearTimeout(timer)
      ++generation.current
    }
  }, [source, sort, query, refresh])

  async function loadMore() {
    if (loading || paging.current || !cursor || query.trim()) return
    const token = generation.current
    paging.current = true
    setLoadingMore(true)
    try {
      const page = await window.spool.listSessions({
        limit: PAGE_SIZE,
        cursor,
        sortOrder: sort,
        ...(source ? { sources: [source] } : {}),
        excludePinned: true,
      })
      if (generation.current !== token) return
      setSessions((previous) => {
        const known = new Set(previous.map((session) => session.sessionUuid))
        return [...previous, ...page.sessions.filter((session) => !known.has(session.sessionUuid))]
      })
      setCursor(page.nextCursor)
    } catch (reason) {
      if (generation.current === token) reportError(reason)
    } finally {
      if (generation.current === token) {
        paging.current = false
        setLoadingMore(false)
      }
    }
  }

  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    try {
      await window.spool.syncNow()
      setStatus(await window.spool.getStatus())
      setRefresh((value) => value + 1)
    } catch (reason) {
      toast.error(t('status.syncFailed'), { description: String(reason) })
    } finally {
      setSyncing(false)
    }
  }

  const rows: SessionListRow[] = []
  if (pinned.length) {
    rows.push({
      kind: 'header',
      id: 'pinned',
      label: t('library.section_pinned', { count: pinned.length }),
    })
    for (const session of pinned)
      rows.push({
        kind: 'session',
        id: session.sessionUuid,
        session,
        pinned: true,
        showProject: true,
        headerId: 'pinned',
      })
  }
  for (const session of sessions)
    rows.push({
      kind: 'session',
      id: session.sessionUuid,
      session,
      showProject: true,
      headerId: null,
    })
  rows.push({
    kind: 'footer',
    id: 'footer',
    loading: loadingMore,
    exhausted: cursor === null,
    total: pinned.length + sessions.length,
  })
  const availableSources = SOURCES
  useEffect(() => {
    if (source && status?.[`${source}Sessions`] === 0) setSource(null)
  }, [source, status])
  const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties
  const syncAge = status?.lastSyncedAt ? syncAgeKey(status.lastSyncedAt) : null

  return (
    <div
      className="bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text flex h-screen flex-col"
      data-testid="sessions-app"
    >
      <div
        className="flex h-10 flex-none items-center justify-center text-sm font-semibold"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        AgentHub
      </div>
      <div className={selected || securityOpen ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        <header className="border-warm-border dark:border-dark-border flex-none border-b px-6 pt-2 pb-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className={`${controlClass} flex min-w-48 flex-1 items-center gap-2`}>
              <Search size={18} aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setQuery('')
                }}
                placeholder={t('search.placeholder_home')}
                aria-label={t('search.placeholder_home')}
                className="min-w-0 flex-1 bg-transparent py-2 outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label={t('search.clearSearch')}
                  title={t('search.clearSearch')}
                  className="hover:bg-warm-surface2 dark:hover:bg-dark-surface2 flex h-11 w-11 flex-none items-center justify-center rounded-md"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  <X size={19} />
                </button>
              )}
            </label>
            <select
              value={query.trim() ? searchSort : sort}
              onChange={(event) =>
                query.trim()
                  ? setSearchSort(event.target.value as SearchSortOrder)
                  : setSort(event.target.value as ProjectSessionSortOrder)
              }
              aria-label={t('fragment.sortAriaLabel')}
              className={controlClass}
            >
              {query.trim() ? (
                <>
                  <option value="relevance">{t('fragment.sort_relevance')}</option>
                  <option value="newest">{t('fragment.sort_newest')}</option>
                  <option value="oldest">{t('fragment.sort_oldest')}</option>
                </>
              ) : (
                <>
                  <option value="recent">{t('project.sort_recent')}</option>
                  <option value="oldest">{t('project.sort_oldest')}</option>
                  <option value="most_messages">{t('project.sort_most_messages')}</option>
                  <option value="title">{t('project.sort_title')}</option>
                </>
              )}
            </select>
            <button
              className={`${controlClass} flex w-11 items-center justify-center px-0`}
              data-testid="open-security"
              onClick={() => setSecurityOpen(true)}
              aria-label={t('sidebar.security', { defaultValue: '安全检查' })}
              title={t('sidebar.security', { defaultValue: '安全检查' })}
            >
              <ShieldCheck size={19} />
            </button>
            <button
              className={`${controlClass} flex w-11 items-center justify-center px-0`}
              onClick={() => {
                setSettingsTab('general')
                setSettingsOpen(true)
              }}
              aria-label={t('sidebar.settings')}
            >
              <Settings size={19} />
            </button>
          </div>
          <AgentSourceFilter
            sources={availableSources}
            selected={source}
            onSelect={setSource}
            counts={
              status
                ? {
                    all: status.totalSessions,
                    claude: status.claudeSessions,
                    codex: status.codexSessions,
                    gemini: status.geminiSessions,
                    opencode: status.opencodeSessions,
                    hermes: status.hermesSessions,
                    openclaw: status.openclawSessions,
                    pi: status.piSessions,
                    workbuddy: status.workbuddySessions,
                    dsh: status.dshSessions,
                    cursor: status.cursorSessions,
                  }
                : undefined
            }
          />
        </header>
        <main className="min-h-0 flex-1">
          {error ? (
            <div role="alert" className="p-6">
              <p>{error}</p>
              <button
                className={`${controlClass} mt-3`}
                onClick={() => setRefresh((value) => value + 1)}
              >
                {t('session.refreshFromSource')}
              </button>
            </div>
          ) : loading ? (
            <p className="p-6 text-sm">{t('common.loading')}</p>
          ) : query.trim() ? (
            <FragmentResults
              results={results}
              query={query}
              showSourceFilter={false}
              showSortControl={false}
              defaultSortOrder={searchSort}
              onOpenSession={(uuid, messageId) => setSelected({ uuid, messageId })}
              onCopySessionId={() => toast.success(t('common.copied'))}
            />
          ) : (
            <VirtualSessionList
              rows={rows}
              onEndReached={() => void loadMore()}
              onOpenSession={(uuid) => setSelected({ uuid })}
              onCopySessionId={() => toast.success(t('common.copied'))}
              collapsibleSections={false}
              testId="sessions-scroll"
            />
          )}
        </main>
      </div>
      {securityOpen && !selected && (
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="border-warm-border dark:border-dark-border flex min-h-14 items-center gap-3 border-b px-5">
            <button
              className="hover:bg-warm-surface dark:hover:bg-dark-surface flex h-11 w-11 items-center justify-center rounded-md"
              onClick={() => setSecurityOpen(false)}
              aria-label={t('common.back', { defaultValue: '返回' })}
              title={`${t('common.back')} (⌘[ / Alt+←)`}
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-semibold">
              {t('sidebar.security', { defaultValue: '安全检查' })}
            </h1>
          </header>
          <SecurityPage
            onOpenSession={(uuid) => setSelected({ uuid })}
            onOpenSettings={() => {
              setSettingsTab('security')
              setSettingsOpen(true)
            }}
          />
        </div>
      )}
      {selected && (
        <div className="min-h-0 flex-1">
          <SessionDetail
            key={`${selected.uuid}:${selected.messageId ?? 'latest'}:${selected.linkNonce ?? 0}`}
            sessionUuid={selected.uuid}
            targetMessageId={selected.messageId ?? null}
            persistTargetHighlight={selected.linkNonce !== undefined}
            onBack={() => setSelected(null)}
            onCopySessionId={() => toast.success(t('common.copied'))}
          />
        </div>
      )}
      <footer className="border-warm-border dark:border-dark-border flex min-h-11 flex-none items-center gap-3 border-t px-5 text-xs">
        <button
          onClick={() => void syncNow()}
          disabled={syncing}
          title={t('status.autoSync_help')}
          className="flex min-h-11 items-center gap-2 px-2 disabled:opacity-60"
          data-testid="status-text"
        >
          <RefreshCw size={15} className={syncing || updating ? 'animate-spin' : ''} />
          {syncing
            ? t('status.scanning')
            : updating
              ? t('status.updating')
              : status?.lastSyncedAt
                ? t('status.syncedAgo', {
                    ago: syncAge ? t(syncAge.key, { count: syncAge.count }) : t('status.never'),
                  })
                : t('status.syncNow')}
        </button>
        {selected && (
          <button
            style={noDrag}
            className="ml-auto flex min-h-11 w-11 items-center justify-center"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('sidebar.settings')}
          >
            <Settings size={19} />
          </button>
        )}
      </footer>
      {settingsOpen && (
        <SettingsPanel
          key={settingsTab}
          initialTab={settingsTab}
          additionalSourceCounts={{
            pi: status?.piSessions ?? null,
            hermes: status?.hermesSessions ?? null,
            openclaw: status?.openclawSessions ?? null,
            workbuddy: status?.workbuddySessions ?? null,
            dsh: status?.dshSessions ?? null,
            cursor: status?.cursorSessions ?? null,
          }}
          onClose={() => {
            setSettingsOpen(false)
            void window.spool
              .getAgentsConfig()
              .then((config) => setSearchSort(config.defaultSearchSort ?? 'relevance'))
              .catch(reportError)
          }}
          claudeCount={status?.claudeSessions ?? null}
          codexCount={status?.codexSessions ?? null}
          geminiCount={status?.geminiSessions ?? null}
          opencodeCount={status?.opencodeSessions ?? null}
          themeEditor={theme}
          onThemeEditorChange={(next) => {
            setTheme(next)
            void saveThemeEditorState(next).catch(reportError)
          }}
          language={language ?? 'system'}
          onLanguageChange={(next) => {
            setLanguage(next)
            void window.spool
              .getAgentsConfig()
              .then((config) => window.spool.setAgentsConfig({ ...config, language: next }))
              .catch(reportError)
          }}
        />
      )}
      <AppToaster />
      <SessionManagement
        onChanged={(uuid, title) => {
          if (title === null && selected?.uuid === uuid) setSelected(null)
          if (title !== null)
            window.dispatchEvent(
              new CustomEvent('spool:session-renamed', { detail: { uuid, title } }),
            )
          setRefresh((value) => value + 1)
        }}
      />
    </div>
  )
}
