import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentsConfig, LanguagePreference } from '../../preload/index.js'
import {
  DEFAULT_SEARCH_SORT_ORDER,
  SEARCH_SORT_OPTIONS,
  type SearchSortOrder,
} from '../../shared/searchSort.js'
import {
  getSessionSourceColor,
  getSessionSourceLabel,
  SORTED_SESSION_SOURCES,
} from '../../shared/sessionSources.js'
import { useHotkeys } from '../hooks/useHotkeys.js'
import type { ThemeEditorStateV1 } from '../theme/editorTypes.js'
import Menu from './Menu.js'
import SecurityPane from './Settings/SecurityPane.js'
import TerminalSettings from './Settings/TerminalSettings.js'
import Section, { settingsLabelClass, settingsDescriptionClass } from './SettingsSection.js'
import ShortcutsTab from './ShortcutsTab.js'
import ThemeEditorSection from './ThemeEditorSection.js'
import Toggle from './Toggle.js'
import { useReadingPreferences } from './useReadingPreferences.js'

// ── Types ──────────────────────────────────────────────────────────────────

type SettingsTab =
  | 'general'
  | 'appearance'
  | 'shortcuts'
  | 'sources'
  | 'agent'
  | 'account'
  | 'security'

interface Props {
  onClose: () => void
  initialTab?: SettingsTab
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  opencodeCount: number | null
  additionalSourceCounts?: Partial<
    Record<'pi' | 'hermes' | 'openclaw' | 'workbuddy' | 'dsh' | 'cursor', number | null>
  >
  themeEditor: ThemeEditorStateV1
  onThemeEditorChange: (next: ThemeEditorStateV1) => void
  language: LanguagePreference
  onLanguageChange: (next: LanguagePreference) => void
}

type Theme = 'system' | 'light' | 'dark'

// ── Sidebar tabs ───────────────────────────────────────────────────────────

// labelKey covers the existing locale entries; tabs whose i18n key has
// not been authored yet pass `fallbackLabel` and the renderer prefers
// it. This keeps the Account tab buildable without forcing a
// cross-locale change in this PR.
const TAB_DEFS: {
  id: SettingsTab
  labelKey: string
  fallbackLabel?: string
  icon: ReactNode
}[] = [
  {
    id: 'general',
    labelKey: 'settings.tab_general',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    labelKey: 'settings.tab_appearance',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v2.5M12 18.5V21M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M3 12h2.5M18.5 12H21M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
        <circle cx="12" cy="12" r="4.25" />
      </svg>
    ),
  },
  {
    id: 'shortcuts',
    labelKey: 'settings.tab_shortcuts',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="6" width="20" height="12" rx="2" ry="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
      </svg>
    ),
  },
  {
    id: 'sources',
    labelKey: 'settings.tab_sources',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    id: 'security',
    labelKey: 'settings.tab_security',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2l8 4v6c0 5-4 9-8 10-4-1-8-5-8-10V6l8-4z" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    ),
  },
]

// ── Main component ─────────────────────────────────────────────────────────

export default function SettingsPanel({
  onClose,
  initialTab = 'general',
  additionalSourceCounts,
  claudeCount,
  codexCount,
  geminiCount,
  opencodeCount,
  themeEditor,
  onThemeEditorChange,
  language,
  onLanguageChange,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const { t } = useTranslation()
  const visibleTabs = TAB_DEFS.filter((def) => {
    if (def.id === 'account' || def.id === 'agent') return false
    return true
  })
  // If the Account tab was active when the flag flipped off, fall back
  // to General so the panel doesn't render against a hidden tab.
  const activeTab: SettingsTab = tab === 'account' || tab === 'agent' ? 'general' : tab

  useHotkeys({ Escape: onClose }, { modal: true })

  return (
    <div
      data-testid="settings-panel"
      className="bg-warm-text/30 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-[2px] dark:bg-black/45"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border flex h-[680px] max-h-[calc(100vh-48px)] w-[960px] max-w-[calc(100vw-48px)] overflow-hidden rounded-[10px] border shadow-xl">
        {/* Sidebar — width + paddings tuned to match the desktop handoff
            (220px rail, 22px vertical padding, 14px horizontal). */}
        <div
          data-testid="settings-sidebar"
          className="bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border flex w-[160px] flex-none flex-col border-r pt-[22px] pb-3 lg:w-[220px]"
        >
          <div className="mb-[18px] px-[14px]">
            <h2 className="text-warm-text dark:text-dark-text text-[22px] leading-none font-bold">
              {t('settings.title')}
            </h2>
          </div>
          <div className="space-y-[2px] px-2">
            {visibleTabs.map((def) => (
              <button
                key={def.id}
                type="button"
                data-testid={`settings-tab-${def.id}`}
                aria-pressed={activeTab === def.id}
                onClick={() => setTab(def.id)}
                className={`focus-visible:ring-accent flex min-h-11 w-full items-center gap-[11px] rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:outline-none ${
                  activeTab === def.id
                    ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'text-warm-text dark:text-dark-text hover:bg-warm-bg dark:hover:bg-dark-bg'
                }`}
              >
                <span
                  className={
                    activeTab === def.id
                      ? 'text-accent dark:text-accent-dark'
                      : 'text-warm-muted dark:text-dark-muted'
                  }
                >
                  {def.icon}
                </span>
                {tabLabel(t, def.labelKey, def.fallbackLabel)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-6 pt-8 pb-2 lg:px-16">
            <h3 className="text-warm-text dark:text-dark-text text-xl font-semibold">
              {(() => {
                const def = TAB_DEFS.find((d) => d.id === activeTab) ?? TAB_DEFS[0]!
                return tabLabel(t, def.labelKey, def.fallbackLabel)
              })()}
            </h3>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface focus-visible:ring-accent flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:outline-none"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pt-4 pb-8 lg:px-16">
            {activeTab === 'general' && (
              <GeneralTab language={language} onLanguageChange={onLanguageChange} />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab themeEditor={themeEditor} onThemeEditorChange={onThemeEditorChange} />
            )}
            {activeTab === 'shortcuts' && <ShortcutsTab />}
            {activeTab === 'sources' && (
              <SourcesTab
                additionalSourceCounts={additionalSourceCounts}
                claudeCount={claudeCount}
                codexCount={codexCount}
                geminiCount={geminiCount}
                opencodeCount={opencodeCount}
              />
            )}
            {activeTab === 'security' && <SecurityPane />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── General Tab ────────────────────────────────────────────────────────────

function GeneralTab({
  language,
  onLanguageChange,
}: {
  language: LanguagePreference
  onLanguageChange: (next: LanguagePreference) => void
}) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AgentsConfig | null>(null)
  const { prefs: readingPrefs, update: updateReadingPrefs } = useReadingPreferences()

  useEffect(() => {
    if (!window.spool) return
    window.spool.getAgentsConfig().then(setConfig).catch(console.error)
  }, [])

  if (config === null) return null

  const updateConfig = async (patch: Partial<AgentsConfig>) => {
    const next: AgentsConfig = { ...config, ...patch }
    setConfig(next)
    try {
      await window.spool.setAgentsConfig(next)
    } catch {}
  }

  const searchSortLabel = (value: SearchSortOrder): string => {
    switch (value) {
      case 'relevance':
        return t('fragment.sort_relevance')
      case 'newest':
        return t('fragment.sort_newest')
      case 'oldest':
        return t('fragment.sort_oldest')
    }
  }
  const searchSortOptions = SEARCH_SORT_OPTIONS.map((o) => ({
    value: o.value,
    label: searchSortLabel(o.value),
  }))

  return (
    <div className="space-y-6">
      {/* Language */}
      <Section title={t('settings.language_label')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 pt-1">
            <span className={settingsLabelClass}>{t('common.language')}</span>
            <p className={`${settingsDescriptionClass} mt-1`}>{t('settings.language_help')}</p>
          </div>
          <SmallSelect
            value={language}
            onChange={(v) => onLanguageChange(v as LanguagePreference)}
            options={[
              { value: 'system', label: t('settings.language_system') },
              { value: 'en', label: t('settings.language_en') },
              { value: 'zh-CN', label: t('settings.language_zh_CN') },
              { value: 'zh-TW', label: t('settings.language_zh_TW') },
              { value: 'ja', label: t('settings.language_ja') },
              { value: 'ko', label: t('settings.language_ko') },
              { value: 'de', label: t('settings.language_de') },
              { value: 'fr', label: t('settings.language_fr') },
            ]}
          />
        </div>
      </Section>

      {/* Search */}
      <Section title={t('settings.search_section')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={settingsLabelClass}>{t('settings.defaultSearchSort_label')}</span>
            <p className={`${settingsDescriptionClass} mt-1`}>
              {t('settings.defaultSearchSort_help')}
            </p>
          </div>
          <SmallSelect
            value={config.defaultSearchSort ?? DEFAULT_SEARCH_SORT_ORDER}
            onChange={(v) => updateConfig({ defaultSearchSort: v as SearchSortOrder })}
            options={searchSortOptions}
          />
        </div>
      </Section>

      {/* Terminal */}
      <Section title={t('settings.reading_section')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className={settingsLabelClass}>{t('settings.showInternal_label')}</span>
            <p className={`${settingsDescriptionClass} mt-1`}>{t('settings.showInternal_help')}</p>
          </div>
          <Toggle
            checked={readingPrefs.showInternal}
            onChange={(showInternal) => updateReadingPrefs({ showInternal })}
            ariaLabel={t('settings.showInternal_label')}
          />
        </div>
      </Section>

      {/* Terminal */}
      <Section title={t('settings.terminal_label')}>
        <TerminalSettings
          config={config}
          onSave={async (next) => {
            await window.spool.setAgentsConfig(next)
            setConfig(next)
          }}
        />
      </Section>

      {/* Data */}
      <Section title={t('settings.data_section')}>
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <span className={settingsLabelClass}>{t('settings.data_database')}</span>
            <p className={`${settingsDescriptionClass} mt-1`}>{t('settings.data_database_help')}</p>
          </div>
          <span className="text-warm-faint dark:text-dark-muted font-mono text-[11px]">
            ~/.agenthub/agenthub.db
          </span>
        </div>
      </Section>

      {/* About */}
      <Section title={t('settings.about_section')}>
        <p className="text-warm-text dark:text-dark-text text-sm leading-relaxed">
          {t('settings.about_tagline')}
        </p>
        <p className={`${settingsDescriptionClass} mt-2 font-mono`} data-testid="about-version">
          {t('settings.about_version', { version: __AGENTHUB_VERSION__ })}
        </p>
        <p className={`${settingsDescriptionClass} mt-2`}>{t('settings.about_fork')}</p>
      </Section>
    </div>
  )
}

function AppearanceTab({
  themeEditor,
  onThemeEditorChange,
}: {
  themeEditor: ThemeEditorStateV1
  onThemeEditorChange: (next: ThemeEditorStateV1) => void
}) {
  const [themeSource, setThemeSource] = useState<Theme>('system')

  useEffect(() => {
    if (!window.spool) return
    window.spool
      .getTheme()
      .then((t) => {
        if (t) setThemeSource(t)
      })
      .catch(console.error)
  }, [])

  const setThemeMode = async (t: Theme) => {
    setThemeSource(t)
    try {
      await window.spool?.setTheme(t)
    } catch (err) {
      console.error('Failed to set theme:', err)
    }
  }

  return (
    <div>
      <ThemeEditorSection
        state={themeEditor}
        onChange={onThemeEditorChange}
        themeSource={themeSource}
        onThemeMode={setThemeMode}
      />
    </div>
  )
}

// ── Sources Tab ────────────────────────────────────────────────────────────

function SourcesTab({
  additionalSourceCounts,
  claudeCount,
  codexCount,
  geminiCount,
  opencodeCount,
}: {
  additionalSourceCounts: Props['additionalSourceCounts']
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  opencodeCount: number | null
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <Section title={t('settings.sources_title')}>
        <p className={`${settingsDescriptionClass} mb-3`}>{t('settings.sources_help')}</p>
        {SORTED_SESSION_SOURCES.map((source) => (
          <BuiltInSource
            key={source}
            name={getSessionSourceLabel(source)}
            color={getSessionSourceColor(source)}
            count={
              {
                claude: claudeCount,
                codex: codexCount,
                gemini: geminiCount,
                opencode: opencodeCount,
                hermes: additionalSourceCounts?.hermes ?? 0,
                openclaw: additionalSourceCounts?.openclaw ?? 0,
                pi: additionalSourceCounts?.pi ?? 0,
                workbuddy: additionalSourceCounts?.workbuddy ?? 0,
                dsh: additionalSourceCounts?.dsh ?? 0,
                cursor: additionalSourceCounts?.cursor ?? 0,
              }[source]
            }
          />
        ))}
      </Section>
    </div>
  )
}

// ── Shared components ──────────────────────────────────────────────────────

// react-i18next's `t()` returns the raw key when a translation is
// missing. For tabs whose key isn't authored yet we want the
// human-readable fallbackLabel instead of `settings.tab_account`
// leaking into the UI.
function tabLabel(t: (key: string) => string, key: string, fallback?: string): string {
  const translated = t(key)
  return translated === key && fallback ? fallback : translated
}

function BuiltInSource({
  name,
  color,
  count,
}: {
  name: string
  color: string
  count: number | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />
      <span className={`${settingsLabelClass} flex-1`}>{name}</span>
      <span className="text-warm-faint dark:text-dark-muted font-mono text-[11px] tabular-nums">
        {count === null ? '…' : t('sidebar.sessionCount_other', { count })}
      </span>
      <span className="text-warm-faint dark:text-dark-muted flex items-center gap-1.5 text-[10px] font-medium tracking-[0.06em] uppercase">
        {t('settings.sources_auto')}
      </span>
    </div>
  )
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 ${
        selected
          ? 'border-accent dark:border-accent-dark'
          : 'border-warm-border2 dark:border-dark-border2'
      }`}
    >
      {selected && <span className="bg-accent dark:bg-accent-dark h-2 w-2 rounded-full" />}
    </span>
  )
}

function SmallSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <Menu
      align="right"
      items={options.map((o) => ({
        label: o.label,
        active: o.value === value,
        onSelect: () => onChange(o.value),
      }))}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
          className={`bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text focus-visible:ring-accent inline-flex min-h-11 min-w-[140px] items-center gap-2 rounded-md border pr-2 pl-3 text-sm transition-colors outline-none focus-visible:ring-1 focus-visible:ring-offset-0 ${
            open
              ? 'border-accent dark:border-accent-dark'
              : 'border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
          }`}
        >
          <span className="flex-1 truncate text-left">{current?.label ?? value}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`text-warm-muted dark:text-dark-muted h-3 w-3 flex-none transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
          >
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    />
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span className={settingsLabelClass}>{label}</span>
        {description && <p className={`${settingsDescriptionClass} mt-1`}>{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  )
}
