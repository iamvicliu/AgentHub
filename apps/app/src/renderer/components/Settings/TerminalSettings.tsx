import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentsConfig } from '../../../preload/index.js'
import { validateCustomTerminal } from '../../../shared/customTerminal.js'
import { settingsLabelClass, settingsDescriptionClass } from '../SettingsSection.js'

export default function TerminalSettings({
  config,
  onSave,
}: {
  config: AgentsConfig
  onSave: (next: AgentsConfig) => Promise<void>
}) {
  const { t } = useTranslation()
  const [found, setFound] = useState<{ name: string; installed: boolean }[]>([])
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [args, setArgs] = useState('["-e", "sh", "-c", "{command}"]')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tested, setTested] = useState(false)
  const custom = config.customTerminals ?? []
  const button =
    'border-warm-border dark:border-dark-border text-warm-text dark:text-dark-text hover:bg-warm-surface dark:hover:bg-dark-surface min-h-11 rounded-md border px-3 text-xs'
  const input =
    'border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-warm-text dark:text-dark-text min-h-11 w-full rounded-md border px-3 text-sm'
  useEffect(() => {
    void window.spool
      .discoverTerminals()
      .then(setFound)
      .catch((e) => setError(String(e)))
  }, [])

  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    setTested(false)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function choose(value: string) {
    const next = { ...config }
    if (value) next.terminal = value
    else delete next.terminal
    await onSave(next)
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="default-terminal" className={settingsLabelClass}>
            {t('settings.terminal_default')}
          </label>
          <p className={`${settingsDescriptionClass} mt-1`}>
            {t('settings.terminal_discovery_help')}
          </p>
        </div>
        <select
          id="default-terminal"
          className={`${input} max-w-56`}
          disabled={busy}
          value={config.terminal ?? ''}
          onChange={(e) => void action(() => choose(e.target.value))}
        >
          <option value="">{t('settings.terminal_auto')}</option>
          {found.map((terminal) => (
            <option
              key={terminal.name}
              value={terminal.name}
              disabled={!terminal.installed && config.terminal !== terminal.name}
            >
              {terminal.name}
              {terminal.installed ? '' : ` (${t('settings.terminal_missing')})`}
            </option>
          ))}
          {custom.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => setEditing(!editing)}>
          {t('settings.terminal_add')}
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await window.spool.testTerminal()
              setTested(true)
            })
          }
        >
          {t('settings.terminal_test')}
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() => void action(async () => setFound(await window.spool.discoverTerminals()))}
        >
          {t('settings.terminal_refresh')}
        </button>
      </div>
      {editing && (
        <form
          className="border-warm-border dark:border-dark-border space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            void action(async () => {
              const entry = {
                id: `custom:${crypto.randomUUID()}`,
                name: name.trim(),
                executable: path.trim(),
                args: JSON.parse(args),
              }
              validateCustomTerminal(entry)
              await onSave({ ...config, terminal: entry.id, customTerminals: [...custom, entry] })
              setEditing(false)
            })
          }}
        >
          <label className="block space-y-1">
            <span className={settingsLabelClass}>{t('settings.terminal_name')}</span>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block space-y-1">
            <span className={settingsLabelClass}>{t('settings.terminal_path')}</span>
            <input
              className={input}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              required
            />
          </label>
          <button
            type="button"
            className={button}
            onClick={() =>
              void action(async () => {
                const selected = await window.spool.pickTerminal()
                if (selected) setPath(selected)
              })
            }
          >
            {t('settings.terminal_browse')}
          </button>
          <label className="block space-y-1">
            <span className={settingsLabelClass}>{t('settings.terminal_args')}</span>
            <textarea
              className={`${input} py-2 font-mono`}
              rows={3}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <p className={settingsDescriptionClass}>{t('settings.terminal_args_help')}</p>
          <button type="submit" className={button} disabled={busy}>
            {t('settings.terminal_save')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-accent dark:text-accent-dark text-xs">
          {error}
        </p>
      )}
      {tested && (
        <p role="status" className={settingsDescriptionClass}>
          {t('settings.terminal_test_sent')}
        </p>
      )}
    </div>
  )
}
