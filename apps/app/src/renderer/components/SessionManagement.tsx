import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useFocusTrap } from '../hooks/useFocusTrap.js'
import { useHotkeys } from '../hooks/useHotkeys.js'

type Request = { uuid: string; source?: string; title: string; action: 'rename' | 'delete' }
const EVENT = 'spool:manage-session'

export function requestSessionManagement(request: Request) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: request }))
}

export default function SessionManagement({
  onChanged,
}: {
  onChanged: (uuid: string, title: string | null) => void
}) {
  const { t } = useTranslation()
  const [request, setRequest] = useState<Request | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const trapRef = useFocusTrap<HTMLDivElement>(request !== null, inputRef)
  useHotkeys(
    {
      Escape: () => {
        if (!locked.current) setRequest(null)
      },
    },
    {
      active: request !== null,
      modal: true,
    },
  )

  useEffect(() => {
    function receive(event: Event) {
      if (locked.current) return
      const next = (event as CustomEvent<Request>).detail
      setError(null)
      if (next.action === 'rename') {
        setTitle(next.title)
        setRequest(next)
      } else {
        locked.current = true
        setBusy(true)
        void window.spool
          .deleteSession(next.uuid)
          .then((result) => {
            if (result.deleted) {
              onChanged(next.uuid, null)
              toast.success(t('session.deleted'))
            }
          })
          .catch((reason) => toast.error(String(reason)))
          .finally(() => {
            locked.current = false
            setBusy(false)
          })
      }
    }
    window.addEventListener(EVENT, receive)
    return () => window.removeEventListener(EVENT, receive)
  }, [onChanged, t])

  async function save() {
    if (!request || locked.current || !title.trim()) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await window.spool.renameSession(request.uuid, title.trim())
      if (!result.ok) {
        setError(result.error)
        return
      }
      onChanged(request.uuid, result.title)
      setRequest(null)
      toast.success(t('session.renamed'))
    } catch (reason) {
      setError(String(reason))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  if (!request) return null
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-5"
      onClick={() => {
        if (!busy) setRequest(null)
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-session-title"
        className="bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border w-full max-w-md rounded-xl border p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <h2
            id="rename-session-title"
            className="text-warm-text dark:text-dark-text text-lg font-semibold"
          >
            {t('session.rename')}
          </h2>
          <p className="text-warm-muted dark:text-dark-muted mt-2 text-sm">
            {t(
              request.source === 'hermes'
                ? 'session.renameScopeHermes'
                : request.source === 'codex'
                  ? 'session.renameScopeCodex'
                  : 'session.renameScope',
            )}
          </p>
          <label
            htmlFor="session-name"
            className="text-warm-muted dark:text-dark-muted mt-5 block text-xs"
          >
            {t('session.name')}
          </label>
          <input
            id="session-name"
            ref={inputRef}
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            className="border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface focus:border-accent dark:focus:border-accent-dark mt-2 min-h-11 w-full rounded-md border px-3 text-sm outline-none"
          />
          {error && (
            <p role="alert" className="text-accent dark:text-accent-dark mt-3 text-sm break-words">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setRequest(null)}
              className="border-warm-border dark:border-dark-border hover:bg-warm-surface dark:hover:bg-dark-surface min-h-11 rounded-md border px-4 text-sm disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="bg-accent dark:bg-accent-dark min-h-11 rounded-md px-4 text-sm text-white disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
