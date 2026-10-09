import { watch as fsWatch, statSync, type FSWatcher } from 'node:fs'
import { resolve as resolvePath, basename } from 'node:path'

import { normalizeLocalAgentWatchPath } from '../parsers/local-agents.js'
import { normalizeOpenCodeWatchPath } from '../parsers/opencode.js'
import type { SessionSource } from '../types.js'
import { codexHomes, isCodexCatalogFile } from './codex-threads.js'
import { detectSessionSource, getSessionRoots } from './source-paths.js'
import type { Syncer } from './syncer.js'

export type WatcherEvent = 'new-sessions' | 'error'

export interface WatcherEventDataMap {
  'new-sessions': { count: number }
  error: { error: Error; root?: string }
}

export type WatcherEventData = WatcherEventDataMap[WatcherEvent]

export type WatcherEventCallback<E extends WatcherEvent = WatcherEvent> = (
  event: E,
  data: WatcherEventDataMap[E],
) => void

export interface SpoolWatcherOptions {
  /** Milliseconds of inactivity before considering a file's writes finished. */
  stabilityMs?: number
  /** Poll interval while waiting for size/mtime to settle. */
  pollMs?: number
  /** Window over which new-session events coalesce into a single emission. */
  flushMs?: number
  /** Dependency injection for tests — defaults to node:fs watch. */
  watchFn?: typeof fsWatch
}

interface PendingEntry {
  timer: ReturnType<typeof setTimeout>
  lastSize: number
  lastMtimeMs: number
}

const DEFAULT_STABILITY_MS = 2000
const DEFAULT_POLL_MS = 200
const DEFAULT_FLUSH_MS = 500

export class SpoolWatcher {
  private watchers: FSWatcher[] = []
  private listeners: Map<WatcherEvent, WatcherEventCallback[]> = new Map()
  private pending: Map<string, PendingEntry> = new Map()
  private pendingNew = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private deletionTimer: ReturnType<typeof setTimeout> | null = null
  private codexCatalogTimer: ReturnType<typeof setTimeout> | null = null
  private archiveTimer: ReturnType<typeof setTimeout> | null = null
  private sourceRoots: Record<SessionSource, string[]> = {
    claude: [],
    codex: [],
    gemini: [],
    opencode: [],
    pi: [],
    hermes: [],
    openclaw: [],
    workbuddy: [],
    dsh: [],
    cursor: [],
  }
  private stopped = false
  private readonly stabilityMs: number
  private readonly pollMs: number
  private readonly flushMs: number
  private readonly watchFn: typeof fsWatch

  constructor(
    private syncer: Syncer,
    opts: SpoolWatcherOptions = {},
  ) {
    this.stabilityMs = opts.stabilityMs ?? DEFAULT_STABILITY_MS
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS
    this.watchFn = opts.watchFn ?? fsWatch
  }

  start(): void {
    this.stopped = false
    this.sourceRoots = {
      claude: getSessionRoots('claude'),
      codex: getSessionRoots('codex'),
      gemini: getSessionRoots('gemini'),
      opencode: getSessionRoots('opencode'),
      pi: getSessionRoots('pi'),
      hermes: getSessionRoots('hermes'),
      openclaw: getSessionRoots('openclaw'),
      workbuddy: getSessionRoots('workbuddy'),
      dsh: getSessionRoots('dsh'),
      cursor: getSessionRoots('cursor'),
    }
    const roots = [
      ...this.sourceRoots.claude,
      ...this.sourceRoots.codex,
      ...this.sourceRoots.gemini,
      ...this.sourceRoots.opencode,
      ...this.sourceRoots.pi,
      ...this.sourceRoots.hermes,
      ...this.sourceRoots.openclaw,
      ...this.sourceRoots.workbuddy,
      ...this.sourceRoots.dsh,
      ...this.sourceRoots.cursor,
    ]
    for (const root of roots) this.watchRoot(root)
    for (const home of codexHomes()) this.watchCodexHome(home)
    // WorkBuddy and dsh record archiving outside their session folders; without
    // watching those stores, archiving a session would not be noticed until the
    // next full scan.
    for (const root of this.sourceRoots.workbuddy) {
      this.watchArchiveStore(resolvePath(root, '..'), 'workbuddy.db')
      // WorkBuddy lists only the signed-in account's conversations, so signing
      // in as another account changes which sessions are visible.
      this.watchArchiveStore(
        resolvePath(root, '..', 'storage', 'skeleton'),
        'account-snapshot.json',
      )
    }
    for (const root of this.sourceRoots.dsh) {
      this.watchArchiveStore(resolvePath(root, '..', 'storages'), 'workspace.json')
    }
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
    this.watchers = []
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingNew = 0
    if (this.deletionTimer) clearTimeout(this.deletionTimer)
    this.deletionTimer = null
    if (this.codexCatalogTimer) clearTimeout(this.codexCatalogTimer)
    this.codexCatalogTimer = null
    if (this.archiveTimer) clearTimeout(this.archiveTimer)
    this.archiveTimer = null
  }

  on<E extends WatcherEvent>(event: E, cb: WatcherEventCallback<E>): void {
    const list = this.listeners.get(event) ?? []
    list.push(cb as WatcherEventCallback)
    this.listeners.set(event, list)
  }

  private watchRoot(root: string): void {
    let w: FSWatcher
    try {
      w = this.watchFn(root, { persistent: true, recursive: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      // Missing root is expected (e.g. user hasn't used Gemini CLI) — silently skip.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        this.emit('error', { error: err as Error, root })
      }
      return
    }

    w.on('change', (eventType, filename) => {
      if (this.stopped || !filename) return
      if (eventType === 'rename') this.scheduleDeletionCleanup()
      // OpenCode commits land in opencode.db-wal; map sidecar writes to the main
      // DB so they aren't filtered out and trigger a re-index. Stability polling
      // then debounces on the (static) main file, settling once writes pause.
      const abs = normalizeLocalAgentWatchPath(
        normalizeOpenCodeWatchPath(resolvePath(root, filename.toString())),
      )
      this.schedulePoll(abs)
    })

    w.on('error', (err) => {
      this.emit('error', { error: err as Error, root })
    })

    this.watchers.push(w)
  }

  /** Codex renames and archive/delete land in its thread catalog, not in session files. */
  private watchCodexHome(home: string): void {
    let w: FSWatcher
    try {
      w = this.watchFn(home, { persistent: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT' && code !== 'ENOTDIR')
        this.emit('error', { error: err as Error, root: home })
      return
    }
    w.on('change', (_eventType, filename) => {
      if (this.stopped || !filename || !isCodexCatalogFile(filename.toString())) return
      this.scheduleCodexCatalog()
    })
    w.on('error', (err) => this.emit('error', { error: err as Error, root: home }))
    this.watchers.push(w)
  }

  private scheduleCodexCatalog(): void {
    if (this.codexCatalogTimer) clearTimeout(this.codexCatalogTimer)
    this.codexCatalogTimer = setTimeout(() => {
      this.codexCatalogTimer = null
      if (this.stopped) return
      try {
        const count = this.syncer.applyCodexCatalog()
        if (count > 0) this.emit('new-sessions', { count })
      } catch (error) {
        this.emit('error', { error: error as Error })
      }
    }, this.stabilityMs)
  }

  private schedulePoll(filePath: string): void {
    // Only process files whose final path matches a configured source.
    // Prefilter here avoids noisy stat() on unrelated dir events.
    if (!detectSessionSource(filePath, this.sourceRoots)) {
      // Could still be a future session file in a new subdir — but detectSessionSource
      // already matches by suffix + root containment, so unrelated hits are rejected here.
      return
    }

    const existing = this.pending.get(filePath)
    if (existing) clearTimeout(existing.timer)

    const entry: PendingEntry = {
      lastSize: existing?.lastSize ?? -1,
      lastMtimeMs: existing?.lastMtimeMs ?? -1,
      timer: setTimeout(() => this.pollStability(filePath), this.stabilityMs),
    }
    this.pending.set(filePath, entry)
  }

  /** Watches a source's archive store (a directory plus the file inside it that
   *  carries the archive state). Archive changes do not touch any transcript, so
   *  they need their own trigger. */
  private watchArchiveStore(dir: string, fileName: string): void {
    let w: FSWatcher
    try {
      w = this.watchFn(dir, { persistent: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        this.emit('error', { error: err as Error, root: dir })
      }
      return
    }
    w.on('change', (_eventType, filename) => {
      if (this.stopped || !filename) return
      // Match the store and its SQLite sidecars (-wal / -shm / -journal).
      if (!basename(filename.toString()).startsWith(fileName)) return
      this.scheduleArchiveResync()
    })
    w.on('error', (err) => this.emit('error', { error: err as Error, root: dir }))
    this.watchers.push(w)
  }

  private scheduleArchiveResync(): void {
    if (this.archiveTimer) clearTimeout(this.archiveTimer)
    this.archiveTimer = setTimeout(() => {
      this.archiveTimer = null
      if (this.stopped) return
      try {
        const result = this.syncer.syncAll()
        // A scan that hid a session reports no additions, so always signal:
        // the renderer refetches on this event regardless of the count.
        this.emit('new-sessions', { count: result.added })
      } catch (error) {
        this.emit('error', { error: error as Error })
      }
    }, this.stabilityMs)
  }

  private scheduleDeletionCleanup(): void {
    if (this.deletionTimer) clearTimeout(this.deletionTimer)
    this.deletionTimer = setTimeout(() => {
      this.deletionTimer = null
      if (this.stopped) return
      try {
        const count = this.syncer.cleanupMissingSessions()
        if (count > 0) this.emit('new-sessions', { count })
      } catch (error) {
        this.emit('error', { error: error as Error })
      }
    }, this.stabilityMs)
  }

  private pollStability(filePath: string): void {
    if (this.stopped) return
    const entry = this.pending.get(filePath)
    if (!entry) return

    let size: number
    let mtimeMs: number
    try {
      const s = statSync(filePath)
      if (!s.isFile()) {
        this.pending.delete(filePath)
        return
      }
      size = s.size
      mtimeMs = s.mtimeMs
    } catch {
      // File gone or transient error — drop.
      this.pending.delete(filePath)
      return
    }

    if (size === entry.lastSize && mtimeMs === entry.lastMtimeMs) {
      this.pending.delete(filePath)
      this.runSync(filePath)
      return
    }
    entry.lastSize = size
    entry.lastMtimeMs = mtimeMs
    entry.timer = setTimeout(() => this.pollStability(filePath), this.pollMs)
  }

  private runSync(filePath: string): void {
    // Decouple the sync call from the watcher event path so a slow or throwing
    // syncFile cannot stall event delivery or create unhandled rejections.
    queueMicrotask(() => {
      if (this.stopped) return
      const source = detectSessionSource(filePath, this.sourceRoots)
      if (!source) return
      let result: ReturnType<Syncer['syncFile']>
      try {
        result = this.syncer.syncFile(filePath, source)
      } catch (err) {
        this.emit('error', { error: err as Error })
        return
      }
      if (result === 'added' || result === 'updated') {
        this.pendingNew++
        if (this.flushTimer) clearTimeout(this.flushTimer)
        this.flushTimer = setTimeout(() => this.flushNew(), this.flushMs)
      }
    })
  }

  private flushNew(): void {
    this.flushTimer = null
    const count = this.pendingNew
    this.pendingNew = 0
    if (count > 0) this.emit('new-sessions', { count })
  }

  private emit<E extends WatcherEvent>(event: E, data: WatcherEventDataMap[E]): void {
    const list = this.listeners.get(event)
    if (!list) return
    for (const cb of list) {
      try {
        ;(cb as WatcherEventCallback<E>)(event, data)
      } catch {
        /* listener errors shouldn't break the watcher */
      }
    }
  }
}
