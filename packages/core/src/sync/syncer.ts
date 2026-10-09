import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'

import type Database from 'better-sqlite3'

import {
  deleteSessionByFilePath,
  getSourceId,
  getOrCreateProject,
  getSessionMtime,
  getAllSessionMtimes,
  upsertSession,
  refreshSessionSearchFromMessages,
  insertMessages,
  getMessageSnapshot,
  recomputeMessageCount,
  type UpsertSessionMode,
} from '../db/queries.js'
import { loadClaudeSession, decodeProjectSlug } from '../parsers/claude.js'
import { loadCodexSession, CODEX_INDEX_VERSION } from '../parsers/codex.js'
import { CURSOR_INDEX_VERSION, cursorStateMtime, loadCursorSession } from '../parsers/cursor.js'
import { loadDshSession, DSH_INDEX_VERSION, dshArchiveMtime } from '../parsers/dsh.js'
import { loadGeminiSession } from '../parsers/gemini.js'
import {
  isLocalAgentDatabase,
  listLocalAgentSessions,
  loadLocalAgentSession,
  localAgentMtime,
  localAgentDatabasePath,
  LOCAL_AGENT_INDEX_VERSION,
} from '../parsers/local-agents.js'
import {
  getOpenCodeSessionIndexedMtime,
  isOpenCodeDatabaseFile,
  listOpenCodeSessionFilePaths,
  loadOpenCodeSession,
  OPENCODE_INDEX_VERSION,
  parseOpenCodeSessionFilePath,
} from '../parsers/opencode.js'
import { decodePiSessionDirSlug, loadPiSession, PI_INDEX_VERSION } from '../parsers/pi.js'
import {
  loadWorkBuddySession,
  WORKBUDDY_INDEX_VERSION,
  workBuddyArchiveMtime,
} from '../parsers/workbuddy.js'
import { realFs } from '../projects/fs.js'
import { computeIdentity } from '../projects/identity.js'
import type { SessionSource } from '../types.js'
import type { ParsedMessage, SyncResult } from '../types.js'
import { loadCodexThreadCatalog, type CodexThreadCatalog } from './codex-threads.js'
import { getSessionRoots, isSessionFileForSource } from './source-paths.js'

export interface SyncProgressEvent {
  phase: 'scanning' | 'syncing' | 'indexing' | 'done'
  count: number
  total: number
}

export type SyncEventCallback = (event: SyncProgressEvent) => void

/** Fired after `syncFile` commits a session's messages. Consumers
 *  (the scan worker hookup in main process) invalidate the session's
 *  scan_profile and re-enqueue it — necessary because offsets in
 *  the findings table point into the now-mutated `messages.content_text`.
 *  Receives the sessions.id, NOT the session_uuid. */
export type SessionChangedCallback = (sessionId: number) => void

/** Per-call overrides for {@link Syncer.syncFile}. The watcher and
 *  `syncAll` never pass these — they go through the standard
 *  mtime-skip + classifySync path. The "Refresh from source" user
 *  action sets `forceMode: 'rewrite'` to bypass both gates so a
 *  session that looks identical at the uuid/length surface gets
 *  rebuilt from the source jsonl anyway. */
export interface SyncFileOptions {
  /** Bypass classifySync and mtime-skip. Used by the explicit
   *  "Refresh from source" IPC action; not set by the watcher or
   *  syncAll. */
  forceMode?: 'rewrite'
}

export class Syncer {
  private db: Database.Database
  private onProgress: SyncEventCallback | undefined
  private onSessionChanged: SessionChangedCallback | undefined
  private codexTitleIndex: Map<string, string> = new Map()
  private codexCatalog: CodexThreadCatalog | null = null
  /** Catalog-listed threads already tried by applyCodexCatalog; file changes re-sync them anyway. */
  private codexCatalogAttempted = new Set<string>()
  private codexSessionFiles: string[] = []

  constructor(
    db: Database.Database,
    onProgress?: SyncEventCallback,
    onSessionChanged?: SessionChangedCallback,
  ) {
    this.db = db
    this.onProgress = onProgress
    this.onSessionChanged = onSessionChanged
  }

  syncAll(): SyncResult {
    const seenPaths = new Set<string>()
    const files: Array<{ path: string; source: SessionSource }> = []
    let discoveryErrors = 0

    for (const source of [
      'claude',
      'codex',
      'gemini',
      'opencode',
      'pi',
      'hermes',
      'openclaw',
      'workbuddy',
      'dsh',
      'cursor',
    ] as const) {
      for (const dir of getSessionRoots(source)) {
        try {
          addUniqueFiles(files, seenPaths, collectSessionFiles(dir, source))
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ENOENT' && code !== 'ENOTDIR') {
            discoveryErrors++
            console.warn('[sync] source discovery failed:', source, code ?? 'invalid source data')
          }
        }
      }
    }

    cleanupStaleOpenCodeSessions(this.db, files)
    this.cleanupMissingSessions()
    this.cleanupLocalAgentSessions()

    const knownMtimes = getAllSessionMtimes(this.db)
    this.codexSessionFiles = files
      .filter((file) => file.source === 'codex')
      .map((file) => file.path)
    this.codexTitleIndex = loadCodexSessionIndex()
    this.codexCatalog = loadCodexThreadCatalog()
    this.codexCatalogAttempted.clear()

    const pendingFiles = files.flatMap((f) => {
      const existing = knownMtimes.get(f.path)
      try {
        const indexedMtime = getIndexedMtime(f.path, f.source)
        if (existing === indexedMtime) return []
        return [{ ...f, indexedMtime }]
      } catch {
        return []
      }
    })
    pendingFiles.sort((a, b) => b.indexedMtime.localeCompare(a.indexedMtime))

    this.onProgress?.({ phase: 'scanning', count: 0, total: files.length })
    if (pendingFiles.length > 0) {
      this.onProgress?.({ phase: 'syncing', count: 0, total: pendingFiles.length })
    }

    const isBulk = pendingFiles.length > 100

    // For bulk syncs (e.g. first launch), drop FTS triggers and rebuild at the end.
    // FTS5 segment merges on per-row triggers cause significant write amplification;
    // a single rebuild after all inserts is ~3x faster.
    if (isBulk) {
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_insert')
      this.db.exec('DROP TRIGGER IF EXISTS messages_fts_delete')
    }

    let added = 0
    let updated = 0
    let errors = discoveryErrors

    try {
      const BATCH = 20
      for (let i = 0; i < pendingFiles.length; i += BATCH) {
        const batch = pendingFiles.slice(i, i + BATCH)
        for (const file of batch) {
          const result = this.syncFile(file.path, file.source, knownMtimes, file.indexedMtime)
          if (result === 'added') added++
          else if (result === 'updated') updated++
          else if (result === 'error') errors++
        }
        this.onProgress?.({
          phase: 'syncing',
          count: Math.min(i + BATCH, pendingFiles.length),
          total: pendingFiles.length,
        })
      }

      this.applyCodexCatalog(false)
    } finally {
      if (isBulk) {
        this.onProgress?.({ phase: 'indexing', count: 0, total: 0 })
        this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
        this.db.exec("INSERT INTO messages_fts_trigram(messages_fts_trigram) VALUES('rebuild')")
        this.db.exec(`
          CREATE TRIGGER messages_fts_insert
          AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content_text) VALUES(NEW.id, NEW.content_text);
            INSERT INTO messages_fts_trigram(rowid, content_text) VALUES(NEW.id, NEW.content_text);
          END
        `)
        this.db.exec(`
          CREATE TRIGGER messages_fts_delete
          AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content_text)
              VALUES('delete', OLD.id, OLD.content_text);
            INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content_text)
              VALUES('delete', OLD.id, OLD.content_text);
          END
        `)
      }
    }

    this.onProgress?.({ phase: 'done', count: pendingFiles.length, total: pendingFiles.length })
    return { added, updated, errors }
  }

  /** Reconcile only confirmed missing local transcripts, never an unavailable root. */
  private cleanupLocalAgentSessions(): void {
    for (const source of ['hermes', 'openclaw'] as const) {
      const rows = this.db
        .prepare(
          'SELECT s.file_path AS path, s.session_uuid AS uuid FROM sessions s JOIN sources src ON src.id = s.source_id WHERE src.name = ?',
        )
        .all(source) as { path: string; uuid: string }[]
      const roots = getSessionRoots(source)
      for (const path of new Set(
        rows
          .filter((row) => row.path.includes('#local-session='))
          .map((row) => localAgentDatabasePath(row.path)),
      )) {
        if (!roots.some((root) => isSessionFileForSource(source, path, root))) continue
        let live: Set<string>
        try {
          live = new Set(listLocalAgentSessions(path, source))
        } catch {
          continue
        }
        this.db.transaction(() => {
          for (const row of rows)
            if (localAgentDatabasePath(row.path) === path && !live.has(row.path)) {
              deleteSessionByFilePath(this.db, row.path)
              this.db.prepare('DELETE FROM pins WHERE session_uuid = ?').run(row.uuid)
            }
        })()
      }
    }
  }

  /** Reconcile only confirmed missing local transcripts, never an unavailable root. */
  cleanupMissingSessions(): number {
    let removed = 0
    for (const source of [
      'claude',
      'codex',
      'pi',
      'hermes',
      'openclaw',
      'workbuddy',
      'dsh',
      'cursor',
    ] as const) {
      const readableRoots = getSessionRoots(source).filter((root) => {
        try {
          readdirSync(root)
          return true
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ENOENT' && code !== 'ENOTDIR')
            console.warn('[sync] cannot read source root:', root, code)
          return false
        }
      })
      const rows = this.db
        .prepare(`
        SELECT s.file_path AS path, s.session_uuid AS uuid
        FROM sessions s JOIN sources so ON so.id = s.source_id WHERE so.name = ?
      `)
        .all(source) as Array<{ path: string; uuid: string }>
      const missing = rows.filter((row) => {
        if (row.path.includes('#local-session=')) return false
        if (!readableRoots.some((root) => isSessionFileForSource(source, row.path, root)))
          return false
        try {
          statSync(row.path)
          return false
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ENOENT') return true
          console.warn('[sync] cannot check transcript:', row.path, code)
          return false
        }
      })
      this.db.transaction(() => {
        for (const row of missing) {
          // Recheck after scanning in case a rename/recreation finished meanwhile.
          try {
            statSync(row.path)
            continue
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue
          }
          if (deleteSessionByFilePath(this.db, row.path)) {
            this.db.prepare('DELETE FROM pins WHERE session_uuid = ?').run(row.uuid)
            removed++
          }
        }
      })()
    }
    return removed
  }

  /** Decide whether a re-sync of `sessionUuid` against `parsed` is a
   *  pure append (existing rows untouched, new uuids inserted) or
   *  needs the safer DELETE+INSERT rewrite path.
   *
   *  Rewrite signals (any of):
   *    - Session row doesn't exist yet → trivially a first-sync,
   *      collapsed into `rewrite` because the code paths are
   *      identical when there's nothing to preserve.
   *    - Session row exists but has no msg_uuid-bearing message rows
   *      (orphan / corrupt state) → safest to repopulate from scratch.
   *    - Parser returned no messages but DB has some — almost certainly
   *      a parse failure mid-flight; rewrite would wipe data the
   *      source no longer has, which is the user's intent.
   *    - Parser returned fewer messages than DB has — source was
   *      truncated or rewritten from its head; uuids beyond the new
   *      tail are stale and must be re-derived.
   *    - The first stored uuid no longer matches the parser's first
   *      uuid → leading prefix shifted; preserved tail uuids could
   *      now point at semantically-different records.
   *
   *  Anything else is `append`.
   *
   *  Note: we deliberately do NOT auto-detect in-place edits of an
   *  existing message uuid (same uuid, different content_text on the
   *  source side). Two reasons:
   *
   *    1. Source files for every supported provider (claude / codex /
   *       gemini / opencode) are append-only event logs at the tool
   *       contract level. Real in-place edits only happen when a user
   *       manually edits the jsonl on disk — rare, deliberate, and
   *       best handled by an explicit "Refresh from source" action.
   *    2. After a Security Scan purge, `messages.content_text` is the
   *       mask but the source still has the raw value. A naive
   *       content-compare would see the difference and trigger
   *       rewrite, which would cascade-delete the finding and let the
   *       raw value re-enter the DB — exactly the regression that
   *       motivated this work. The purge protection requires that we
   *       NOT chase content drift on uuid-matched messages. */
  private classifySync(
    sessionUuid: string,
    parsed: ParsedMessage[],
    source: SessionSource,
  ): UpsertSessionMode {
    // One join'd query — covers "session row missing", "session row
    // exists with no messages", and the leading-uuid / total-row
    // signals all at once. See getMessageSnapshot for the rationale.
    const snapshot = getMessageSnapshot(this.db, sessionUuid)
    if (snapshot.total === 0) return 'rewrite'
    if (parsed.length === 0) return 'rewrite'
    if (parsed.length < snapshot.total) return 'rewrite'
    if (parsed[0]!.uuid !== snapshot.firstUuid) return 'rewrite'
    // Gemini's JSONL replay can drop mid-stream messages ($rewindTo) while
    // new turns keep parsed.length >= total, so head+count alone misclassifies
    // a rewound session as append and strands the dropped rows (with colliding
    // seq values). Pure append requires the parsed message at the stored tail
    // position to still be the stored tail. Gemini-only: claude parses emit
    // duplicate uuids (tool-use shadow records) that the DB dedupes, so
    // parsed[total-1] doesn't align with stored rows there.
    if (source === 'gemini' && parsed[snapshot.total - 1]!.uuid !== snapshot.lastUuid) {
      return 'rewrite'
    }
    return 'append'
  }

  /** True if the title we'd write differs from what's currently stored
   *  for this session. Lets the syncer skip the session_search rebuild
   *  on no-op mtime touches without losing title-only updates (e.g.
   *  codex's auto-titling pass via applyCodexCatalog, or a claude
   *  custom-title record landing while everything else stays the
   *  same). */
  private titleDiffersFromStored(sessionId: number, nextTitle: string): boolean {
    const row = this.db.prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId) as
      | { title: string | null }
      | undefined
    return (row?.title ?? '') !== nextTitle
  }

  private dropIndexedSession(uuid: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM pins WHERE session_uuid = ?').run(uuid)
      return this.db.prepare('DELETE FROM sessions WHERE session_uuid = ?').run(uuid).changes > 0
    })()
  }

  /**
   * Re-read Codex's thread catalog and title index and reconcile the index with them: drop
   * threads the Codex app no longer lists, index threads it lists again (e.g. unarchived), and
   * take Codex's title. Codex titles always follow Codex, since AgentHub renames write through.
   * Returns how many sessions changed.
   */
  applyCodexCatalog(reload = true): number {
    if (reload) {
      this.codexTitleIndex = loadCodexSessionIndex()
      this.codexCatalog = loadCodexThreadCatalog()
    }
    const catalog = this.codexCatalog
    const rows = this.db
      .prepare(
        "SELECT s.id, s.session_uuid AS uuid, s.title, s.title_source AS titleSource FROM sessions s JOIN sources so ON so.id = s.source_id WHERE so.name = 'codex'",
      )
      .all() as { id: number; uuid: string; title: string | null; titleSource: string }[]
    let changed = 0
    const indexed = new Set<string>()
    const retitle = this.db.prepare(
      "UPDATE sessions SET title = ?, title_source = 'derived' WHERE id = ?",
    )
    this.db.transaction(() => {
      for (const row of rows) {
        indexed.add(row.uuid)
        const thread = catalog?.get(row.uuid)
        if (thread && !thread.visible) {
          if (this.dropIndexedSession(row.uuid)) changed++
          continue
        }
        const title = thread?.name ?? this.codexTitleIndex.get(row.uuid)
        if (!title) continue
        if (row.title === title && row.titleSource === 'derived') continue
        retitle.run(title, row.id)
        refreshSessionSearchFromMessages(this.db, row.id)
        if (row.title !== title) changed++
      }
    })()
    if (catalog && reload) {
      const missing = [...catalog]
        .filter(
          ([id, thread]) =>
            thread.visible && !indexed.has(id) && !this.codexCatalogAttempted.has(id),
        )
        .map(([id]) => id)
      for (const id of missing) {
        this.codexCatalogAttempted.add(id)
        const file = this.codexSessionFiles.find((path) => path.includes(id))
        if (!file) continue
        // An empty mtime map makes it a fresh add that still merges the thread's segment files.
        const result = this.syncFile(file, 'codex', new Map())
        if (result === 'added' || result === 'updated') changed++
      }
    }
    return changed
  }

  syncFile(
    filePath: string,
    source: SessionSource,
    knownMtimes?: Map<string, string>,
    precomputedMtime?: string,
    options?: SyncFileOptions,
  ): 'added' | 'updated' | 'skipped' | 'error' {
    const force = options?.forceMode
    try {
      // Watcher/refresh calls do not pass through syncAll's title-index load.
      if (source === 'codex' && !knownMtimes) {
        this.codexTitleIndex = loadCodexSessionIndex()
        this.codexCatalog = loadCodexThreadCatalog()
      }
      if (source === 'opencode' && isOpenCodeDatabaseFile(filePath)) {
        return this.syncOpenCodeDatabase(filePath, knownMtimes, options)
      }
      if (
        (source === 'hermes' || source === 'openclaw') &&
        isLocalAgentDatabase(filePath) &&
        !filePath.includes('#local-session=')
      ) {
        const results = listLocalAgentSessions(filePath, source).map((path) =>
          this.syncFile(path, source, knownMtimes, undefined, options),
        )
        if (!results.includes('error')) this.cleanupLocalAgentSessions()
        return results.includes('error')
          ? 'error'
          : results.includes('added')
            ? 'added'
            : results.includes('updated')
              ? 'updated'
              : 'skipped'
      }

      const mtime = precomputedMtime ?? getIndexedMtime(filePath, source)
      const existingMtime = knownMtimes
        ? (knownMtimes.get(filePath) ?? null)
        : getSessionMtime(this.db, filePath)
      // mtime-skip is the watcher's hot-path optimization. The
      // explicit "Refresh from source" action bypasses it on
      // purpose — the user is asking for a re-sync precisely
      // because they suspect the DB drifted from the source even
      // though the mtime didn't move (e.g. manual jsonl edit, or
      // the in-place updates some providers do without bumping
      // mtime on the spool side).
      if (!force && existingMtime === mtime) return 'skipped'

      // An index-version bump (the `::<version>` suffix in the stored mtime)
      // exists to re-derive content, but append-mode INSERT … DO NOTHING never
      // updates uuid-matched rows — a version-only mismatch must rewrite, or
      // the bump re-visits every file and changes nothing.
      const versionChanged =
        existingMtime !== null &&
        existingMtime.includes('::') &&
        !existingMtime.endsWith(`::${getIndexVersion(source)}`)

      const parseResult =
        source === 'claude'
          ? loadClaudeSession(filePath)
          : source === 'codex'
            ? loadCodexSession(filePath, knownMtimes ? this.codexSessionFiles : undefined)
            : source === 'gemini'
              ? loadGeminiSession(filePath)
              : source === 'hermes' || source === 'openclaw'
                ? loadLocalAgentSession(filePath, source)
                : source === 'pi'
                  ? loadPiSession(filePath)
                  : source === 'workbuddy'
                    ? loadWorkBuddySession(filePath)
                    : source === 'dsh'
                      ? loadDshSession(filePath)
                      : source === 'cursor'
                        ? loadCursorSession(filePath)
                        : loadOpenCodeSession(filePath)

      if (parseResult.kind !== 'parsed') {
        // The "filtered" path normally removes a session whose source
        // is no longer indexable (e.g. claude subagent jsonl that
        // moved under a /subagents/ subdir). Skip that destructive
        // step in force mode: the user pressed "Refresh from source"
        // expecting their session to come back, not to be deleted —
        // and a refresh that lands on a filtered source is almost
        // certainly something the user wants to know about rather
        // than have happen silently.
        if (parseResult.kind === 'filtered' && existingMtime !== null && !force) {
          this.db
            .prepare(`
            INSERT INTO sync_log (source_id, file_path, status, message)
            VALUES (?, ?, 'ok', ?)
          `)
            .run(getSourceId(this.db, source), filePath, 'filtered from index')
          deleteSessionByFilePath(this.db, filePath)
          return 'updated'
        }
        return 'skipped'
      }
      const parsed = parseResult.session

      if (source === 'codex') {
        const thread = this.codexCatalog?.get(parsed.sessionUuid)
        // Keep the list identical to the Codex app: hidden threads (archived, subagent, exec…)
        // are not indexed, and a row that became hidden is dropped.
        if (thread && !thread.visible)
          return this.dropIndexedSession(parsed.sessionUuid) ? 'updated' : 'skipped'
        const codexTitle = thread?.name ?? this.codexTitleIndex.get(parsed.sessionUuid)
        if (codexTitle) parsed.title = codexTitle
      }

      const sourceId = getSourceId(this.db, source)
      const {
        slug: rawSlug,
        displayPath,
        displayName,
      } = resolveProject(filePath, source, parsed.cwd)
      const identity = computeIdentity(
        parsed.cwd || null,
        realFs,
        undefined,
        undefined,
        parsed.gitRemote ?? null,
      )
      // Synthetic identities deduplicate by identity key, not by per-cwd slug,
      // so every matching session converges to a single project row instead
      // of accumulating one row per scratch dir.
      const slug = identity.kind === 'synthetic' ? identity.key : rawSlug
      const projectId = getOrCreateProject(
        this.db,
        sourceId,
        slug,
        identity.displayPath ?? displayPath,
        identity.displayName || displayName,
        { identityKind: identity.kind, identityKey: identity.key },
      )

      const isNew = existingMtime === null
      const hasToolUse = parsed.messages.some((m) => m.toolNames.length > 0)

      // Classify the sync before we touch anything. The result decides
      // whether existing message rows survive (`append`) or get
      // DELETE-cascaded by upsertSession (`rewrite`). The
      // `first-sync` case is just `rewrite` semantically — there is
      // nothing to preserve.
      // Explicit force overrides classification — the user has
      // accepted that any per-message user-side state (Security Scan
      // purge, dismiss) on this session will be rebuilt from source.
      const mode: UpsertSessionMode =
        force ??
        (versionChanged
          ? 'rewrite'
          : this.classifySync(parsed.sessionUuid, parsed.messages, source))

      let committedSessionId: number | null = null
      let insertedCount = 0
      this.db.transaction(() => {
        const sessionId = upsertSession(
          this.db,
          {
            projectId,
            sourceId,
            sessionUuid: parsed.sessionUuid,
            filePath,
            title: parsed.title,
            startedAt: parsed.startedAt,
            endedAt: parsed.endedAt,
            messageCount: parsed.messages.filter((m) => !m.isSidechain).length,
            hasToolUse,
            cwd: parsed.cwd,
            model: parsed.model,
            ...(parsed.account ? { account: parsed.account } : {}),
            rawFileMtime: mtime,
          },
          mode,
        )

        insertedCount = insertMessages(this.db, sessionId, sourceId, parsed.messages)

        // True only when something we wrote could matter to downstream
        // consumers — a rewrite always counts (DELETE invalidated
        // every finding's offsets), an append counts only when at
        // least one row landed.
        const contentChanged = mode === 'rewrite' || insertedCount > 0

        if (contentChanged) {
          // Keep `sessions.message_count` honest with the deduped DB
          // truth (claude tool-use shadow records would inflate the
          // parser-derived value back to pre-v14 levels). Gated on
          // contentChanged so no-op syncs don't pay the UPDATE.
          recomputeMessageCount(this.db, sessionId)
        }

        // Session-level search is a projection of authoritative DB state,
        // never parser output. Security purge masks both messages and a
        // derived title while the source file remains unchanged; rebuilding
        // from parsed data would leak either value back into search.
        const titleChanged = this.titleDiffersFromStored(sessionId, parsed.title)
        if (contentChanged || titleChanged) {
          refreshSessionSearchFromMessages(this.db, sessionId)
        }

        // Security Scan cascade — invalidate scan_profile so the
        // worker re-enqueues this session. Same gate as content
        // change above; idle mtime touches stay no-ops, which is the
        // load-bearing UX win that lets purge / dismiss / star
        // survive across re-sync of an unchanged source file.
        if (contentChanged) {
          this.db
            .prepare(
              `UPDATE sessions SET scan_profile = NULL, scan_completed_at = NULL WHERE id = ?`,
            )
            .run(sessionId)
        }

        this.db
          .prepare(`
          INSERT INTO sync_log (source_id, file_path, status)
          VALUES (?, ?, 'ok')
        `)
          .run(sourceId, filePath)
        committedSessionId = sessionId
      })()

      const contentChanged = mode === 'rewrite' || insertedCount > 0
      if (committedSessionId !== null && this.onSessionChanged && contentChanged) {
        try {
          this.onSessionChanged(committedSessionId)
        } catch {
          /* swallow callback errors */
        }
      }
      return isNew ? 'added' : 'updated'
    } catch (err) {
      try {
        const sourceRow = this.db.prepare('SELECT id FROM sources WHERE name = ?').get(source) as
          | { id: number }
          | undefined
        if (sourceRow) {
          this.db
            .prepare(`
            INSERT INTO sync_log (source_id, file_path, status, message)
            VALUES (?, ?, 'error', ?)
          `)
            .run(sourceRow.id, filePath, String(err))
        }
      } catch {
        /* ignore log errors */
      }
      return 'error'
    }
  }

  private syncOpenCodeDatabase(
    dbPath: string,
    knownMtimes?: Map<string, string>,
    options?: SyncFileOptions,
  ): 'added' | 'updated' | 'skipped' | 'error' {
    let changed = false
    let hadError = false

    let sessionPaths: string[]
    try {
      sessionPaths = listOpenCodeSessionFilePaths(dbPath)
    } catch (err) {
      try {
        const sourceRow = this.db
          .prepare('SELECT id FROM sources WHERE name = ?')
          .get('opencode') as { id: number } | undefined
        if (sourceRow) {
          this.db
            .prepare(`
            INSERT INTO sync_log (source_id, file_path, status, message)
            VALUES (?, ?, 'error', ?)
          `)
            .run(sourceRow.id, dbPath, String(err))
        }
      } catch {
        /* ignore log errors */
      }
      return 'error'
    }

    for (const sessionPath of sessionPaths) {
      const result = this.syncFile(sessionPath, 'opencode', knownMtimes, undefined, options)
      if (result === 'added' || result === 'updated') changed = true
      else if (result === 'error') hadError = true
    }

    const activePaths = new Set(sessionPaths)
    const stalePaths = listIndexedOpenCodeSessionPaths(this.db)
      .filter((path) => parseOpenCodeSessionFilePath(path)?.dbPath === dbPath)
      .filter((path) => !activePaths.has(path))
    for (const stalePath of stalePaths) {
      if (deleteSessionByFilePath(this.db, stalePath)) changed = true
    }

    if (changed) return 'updated'
    if (hadError) return 'error'
    return 'skipped'
  }
}

function cleanupStaleOpenCodeSessions(
  db: Database.Database,
  files: Array<{ path: string; source: SessionSource }>,
): void {
  const activePathsByDb = new Map<string, Set<string>>()
  for (const file of files) {
    if (file.source !== 'opencode') continue
    const parsed = parseOpenCodeSessionFilePath(file.path)
    if (!parsed) continue
    const paths = activePathsByDb.get(parsed.dbPath) ?? new Set<string>()
    paths.add(file.path)
    activePathsByDb.set(parsed.dbPath, paths)
  }
  if (activePathsByDb.size === 0) return

  for (const indexedPath of listIndexedOpenCodeSessionPaths(db)) {
    const parsed = parseOpenCodeSessionFilePath(indexedPath)
    if (!parsed) continue
    const activePaths = activePathsByDb.get(parsed.dbPath)
    if (!activePaths || activePaths.has(indexedPath)) continue
    deleteSessionByFilePath(db, indexedPath)
  }
}

function listIndexedOpenCodeSessionPaths(db: Database.Database): string[] {
  const rows = db
    .prepare(`
    SELECT s.file_path AS filePath
    FROM sessions s
    JOIN sources src ON src.id = s.source_id
    WHERE src.name = 'opencode'
  `)
    .all() as Array<{ filePath: string }>
  return rows.map((row) => row.filePath)
}

function addUniqueFiles(
  files: Array<{ path: string; source: SessionSource }>,
  seenPaths: Set<string>,
  candidates: Array<{ path: string; source: SessionSource }>,
): void {
  for (const candidate of candidates) {
    if (seenPaths.has(candidate.path)) continue
    seenPaths.add(candidate.path)
    files.push(candidate)
  }
}

function getMtime(filePath: string): string {
  return statSync(filePath).mtime.toISOString()
}

function getIndexedMtime(filePath: string, source: SessionSource): string {
  if (source === 'hermes' || source === 'openclaw')
    return `${localAgentMtime(filePath)}::${LOCAL_AGENT_INDEX_VERSION}`
  if (source === 'opencode') return getOpenCodeSessionIndexedMtime(filePath)
  // WorkBuddy and dsh record archiving outside the transcript, so the file's own
  // mtime cannot signal that a hidden session became visible (or the reverse).
  // Folding the archive store's revision into the indexed mtime makes any
  // archive or unarchive re-index the source on the next scan.
  if (source === 'workbuddy')
    return `${getMtime(filePath)}::${workBuddyArchiveMtime(filePath)}::${WORKBUDDY_INDEX_VERSION}`
  if (source === 'dsh')
    return `${getMtime(filePath)}::${dshArchiveMtime(filePath)}::${DSH_INDEX_VERSION}`
  // Cursor keeps titles and archiving in its own state store, beside the editor.
  if (source === 'cursor')
    return `${getMtime(filePath)}::${cursorStateMtime()}::${CURSOR_INDEX_VERSION}`
  return `${getMtime(filePath)}::${getIndexVersion(source)}`
}

function getIndexVersion(source: SessionSource): string {
  if (source === 'codex') return CODEX_INDEX_VERSION
  // v2: <session_context> stripping + JSONL support — force re-derivation of
  // contentText/titles for sessions indexed before the format change.
  if (source === 'gemini') return 'gemini-v2-session-search-fts'
  if (source === 'opencode') return OPENCODE_INDEX_VERSION
  if (source === 'pi') return PI_INDEX_VERSION
  if (source === 'hermes' || source === 'openclaw') return LOCAL_AGENT_INDEX_VERSION
  if (source === 'workbuddy') return WORKBUDDY_INDEX_VERSION
  if (source === 'dsh') return DSH_INDEX_VERSION
  if (source === 'cursor') return CURSOR_INDEX_VERSION
  return 'claude-v3-session-search-fts'
}

function collectSessionFiles(
  dir: string,
  source: SessionSource,
): Array<{ path: string; source: SessionSource }> {
  if (source === 'opencode') {
    const dbPath = join(dir, 'opencode.db')
    if (!existsSync(dbPath)) return []
    return listOpenCodeSessionFilePaths(dbPath).map((path) => ({ path, source }))
  }

  const results: Array<{ path: string; source: SessionSource }> = []
  walkDir(dir, dir, results, source)
  if (source === 'hermes' || source === 'openclaw')
    return results.flatMap((file) =>
      isLocalAgentDatabase(file.path)
        ? listLocalAgentSessions(file.path, source).map((path) => ({ path, source }))
        : [file],
    )
  return results
}

function walkDir(
  dir: string,
  root: string,
  results: Array<{ path: string; source: SessionSource }>,
  source: SessionSource,
): void {
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (source === 'hermes' && (dir !== root || entry.name !== 'sessions')) continue
      if (source === 'openclaw' && dir !== root && !['agent', 'sessions'].includes(entry.name))
        continue
      if (source === 'gemini' && !shouldTraverseGeminiDir(dir, fullPath, entry.name)) continue
      // For claude and pi, session files only live at <root>/<slug>/<uuid>.jsonl.
      // Anything deeper is subagent / future-nested scratch data that hijacks the
      // parent sessionId — see isSessionFileForSource for the matching read-side check.
      if ((source === 'claude' || source === 'pi') && dirname(fullPath) !== root) continue
      // Cursor: only <root>/<slug>/agent-transcripts/<id>/ holds transcripts;
      // its other folders (assets, canvases, mcps, …) are not worth walking.
      if (source === 'cursor') {
        const depth = relative(root, fullPath).split(sep).length
        if (depth > 3 || (depth === 2 && entry.name !== 'agent-transcripts')) continue
      }
      walkDir(fullPath, root, results, source)
    } else if (entry.isFile() && isSessionFileForSource(source, fullPath, root)) {
      results.push({ path: fullPath, source })
    }
  }
}

function shouldTraverseGeminiDir(parentDir: string, fullPath: string, entryName: string): boolean {
  if (entryName === 'chats') return true
  if (basename(parentDir) === 'tmp') return true
  if (/(?:^|\/)chats(?:\/|$)/.test(parentDir)) return true
  return existsSync(join(fullPath, 'chats'))
}

function loadCodexSessionIndex(): Map<string, string> {
  const titles = new Map<string, string>()
  for (const root of getSessionRoots('codex')) {
    const path = join(dirname(root), 'session_index.jsonl')
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn(
          '[sync] cannot read Codex title index:',
          path,
          (error as NodeJS.ErrnoException).code,
        )
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as { id?: string; thread_name?: string }
        if (rec.id && rec.thread_name) titles.set(rec.id, rec.thread_name)
      } catch {
        /* skip malformed lines */
      }
    }
  }
  return titles
}

function resolveProject(
  filePath: string,
  source: SessionSource,
  cwd: string,
): { slug: string; displayPath: string; displayName: string } {
  const home = homedir()

  if (source === 'claude') {
    // ~/.claude/projects/{slug}/{uuid}.jsonl
    const slug = basename(dirname(filePath))
    const displayPath = cwd || decodeProjectSlug(slug)
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? slug
    return { slug, displayPath, displayName }
  } else if (source === 'codex') {
    // ~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-...jsonl
    // Group by cwd (project working dir)
    const displayPath = cwd || home
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? 'codex'
    const slug = displayPath.replace(/^\//, '').replace(/\//g, '-') || 'default'
    return { slug, displayPath, displayName }
  } else if (source === 'opencode') {
    const displayPath = cwd || home
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? 'opencode'
    const slug = displayPath.replace(/^\//, '').replace(/\//g, '-') || 'default'
    return { slug, displayPath, displayName }
  } else if (source === 'pi') {
    // ~/.pi/agent/sessions/{cwd-slug}/{timestamp}_{uuid}.jsonl — the header cwd
    // is authoritative; the directory slug is a lossy fallback.
    const displayPath = cwd || decodePiSessionDirSlug(basename(dirname(filePath)))
    const parts = displayPath.split('/').filter(Boolean)
    const displayName = parts[parts.length - 1] ?? 'pi'
    const slug = displayPath.replace(/^\//, '').replace(/\//g, '-') || 'default'
    return { slug, displayPath, displayName }
  }

  if (source === 'cursor' && !cwd) {
    // <root>/<workspace-slug>/agent-transcripts/<id>/<id>.jsonl (or the older
    // <id>.jsonl beside it). With no folder open Cursor names the workspace
    // "empty-window"; that slug is still the best grouping available.
    const parts = filePath.split('/')
    const at = parts.lastIndexOf('agent-transcripts')
    const slug = (at > 0 ? parts[at - 1] : undefined) || 'cursor'
    return { slug, displayPath: slug, displayName: slug }
  }

  const projectIdentifier = dirname(filePath).split('/').at(-2) ?? 'gemini'
  const displayPath = cwd || projectIdentifier
  const parts = displayPath.split('/').filter(Boolean)
  const displayName = parts[parts.length - 1] ?? projectIdentifier
  const slug = cwd ? displayPath.replace(/^\//, '').replace(/\//g, '-') : projectIdentifier
  return { slug: slug || projectIdentifier, displayPath, displayName }
}
