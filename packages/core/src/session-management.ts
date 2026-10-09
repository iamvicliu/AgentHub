import { realpathSync, readdirSync, readFileSync, lstatSync } from 'node:fs'
import { basename, dirname, join, relative, isAbsolute, sep } from 'node:path'

import type Database from 'better-sqlite3'

import { openDatabase } from './db/native-binding.js'
import { refreshSessionSearchFromMessages } from './db/queries.js'
import { loadClaudeSession } from './parsers/claude.js'
import { loadCodexSession } from './parsers/codex.js'
import { loadGeminiSession } from './parsers/gemini.js'
import { listLocalAgentSessions } from './parsers/local-agents.js'
import { loadPiSession } from './parsers/pi.js'
import { loadWorkBuddySession } from './parsers/workbuddy.js'
import { loadCodexThreadCatalog } from './sync/codex-threads.js'
import { getSessionRoots } from './sync/source-paths.js'
import type { SessionSource } from './types.js'

export function renameIndexedSession(db: Database.Database, uuid: string, title: string) {
  const name = title.trim()
  if (!name || name.length > 200 || /[\r\n\u0000]/.test(name))
    throw new Error('Title must contain 1–200 characters on one line')
  db.transaction(() => {
    const result = db
      .prepare("UPDATE sessions SET title = ?, title_source = 'user' WHERE session_uuid = ?")
      .run(name, uuid)
    if (!result.changes) throw new Error('Session not found')
    const session = db.prepare('SELECT id FROM sessions WHERE session_uuid = ?').get(uuid) as {
      id: number
    }
    refreshSessionSearchFromMessages(db, session.id)
  })()
}

export type SessionDeletionBlockReason =
  | 'running'
  | 'unsupported'
  | 'shared-database'
  | 'root-unavailable'
  | 'unsafe-path'
  | 'agent-unavailable'

/** A deletion refused before anything is touched; `reason` drives the localized dialog. */
export class SessionDeletionBlockedError extends Error {
  constructor(
    readonly reason: SessionDeletionBlockReason,
    message: string,
    readonly detail: { pid?: number; source?: string; output?: string } = {},
  ) {
    super(message)
    this.name = 'SessionDeletionBlockedError'
  }
}

/** Some transcripts reached the trash but the index was kept so nothing is orphaned. */
export class SessionDeletionPartialError extends Error {
  constructor(
    readonly moved: number,
    override readonly cause: unknown,
  ) {
    super(`Deletion incomplete: ${moved} file(s) moved to trash, index kept. ${String(cause)}`)
    this.name = 'SessionDeletionPartialError'
  }
}

/** Resolve every transcript fragment, but never treat a shared agent database as a file to trash. */
export function sessionDeletionFiles(db: Database.Database, uuid: string): string[] {
  const session = db
    .prepare(
      'SELECT s.file_path AS path, src.name AS source FROM sessions s JOIN sources src ON src.id = s.source_id WHERE s.session_uuid = ?',
    )
    .get(uuid) as { path: string; source: SessionSource } | undefined
  if (!session) throw new Error('Session not found')
  const source = session.source
  if (source === 'hermes')
    throw new SessionDeletionBlockedError(
      'unsupported',
      'Hermes sessions are deleted through the Hermes CLI; use deleteHermesSession',
      { source },
    )
  if (source === 'openclaw')
    throw new SessionDeletionBlockedError(
      'unsupported',
      'Hermes / OpenClaw deletion requires agent-native handling and is not supported yet',
      { source },
    )
  const loaders = {
    claude: loadClaudeSession,
    codex: loadCodexSession,
    gemini: loadGeminiSession,
    pi: loadPiSession,
    workbuddy: loadWorkBuddySession,
  }
  if (source === 'opencode')
    throw new SessionDeletionBlockedError(
      'shared-database',
      'OpenCode uses a shared database; per-session deletion is not supported yet',
      { source },
    )
  // dsh keeps a folder per session (the transcript, a lock file and any
  // sidecars), not a single file, so removing it is not the plain unlink the
  // loaders below describe. Native deletion needs its own path.
  // Cursor lists its chats from its own state store; trashing the transcript
  // would leave the chat in Cursor with nothing behind it.
  if (source === 'cursor')
    throw new SessionDeletionBlockedError(
      'unsupported',
      "Cursor sessions are listed from Cursor's own state store; native deletion is not supported yet",
      { source },
    )
  if (source === 'dsh')
    throw new SessionDeletionBlockedError(
      'unsupported',
      'DSH sessions are stored as a folder per session; native deletion is not supported yet',
      { source },
    )
  const loader = loaders[source]
  const roots: string[] = []
  for (const root of getSessionRoots(session.source)) {
    try {
      roots.push(realpathSync(root))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  function isWithinRoot(path: string) {
    return roots.some((root) => {
      const rel = relative(root, path)
      return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
    })
  }
  if (source === 'claude') assertClaudeSessionNotRunning(roots, uuid)
  const files = new Set<string>()
  const directories = new Set<string>()
  // Claude keeps per-session sidecars (subagents, tool-results, custom title) in
  // <root>/<slug>/<uuid>/; trash the folder whole instead of leaving it behind.
  function considerDirectory(path: string) {
    const resolved = realpathSync(path)
    if (!isWithinRoot(resolved))
      throw new SessionDeletionBlockedError(
        'unsafe-path',
        'Session folder is outside configured agent roots',
      )
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
      throw new SessionDeletionBlockedError(
        'unsafe-path',
        'Session folder is not a regular directory',
      )
    directories.add(resolved)
  }
  function consider(path: string) {
    const resolved = realpathSync(path)
    if (!isWithinRoot(resolved))
      throw new SessionDeletionBlockedError(
        'unsafe-path',
        'Session file is outside configured agent roots',
      )
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
      throw new SessionDeletionBlockedError(
        'unsafe-path',
        'Session file is not a regular transcript',
      )
    const parsed = loader(path)
    if (parsed.kind === 'parsed' && parsed.session.sessionUuid === uuid) files.add(resolved)
  }
  try {
    consider(session.path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  function walk(root: string) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name)
      if (
        source === 'claude' &&
        entry.isDirectory() &&
        entry.name === uuid &&
        roots.some((base) => relative(base, path).split(sep).length === 2)
      )
        considerDirectory(path)
      else if (entry.isDirectory()) walk(path)
      else if (
        entry.isFile() &&
        /\.jsonl?$/.test(entry.name) &&
        (entry.name.includes(uuid) ||
          (source === 'gemini' && entry.name.startsWith('session-')) ||
          (source === 'claude' && relative(root, path).split(sep).includes(uuid)))
      )
        consider(path)
    }
  }
  for (const root of roots) walk(root)
  if (!files.size && roots.length === 0)
    throw new SessionDeletionBlockedError(
      'root-unavailable',
      'Agent session directory is unavailable; deletion aborted',
    )
  if (!files.has(session.path) && files.size === 0) {
    try {
      lstatSync(session.path)
      throw new SessionDeletionBlockedError(
        'unsafe-path',
        'Original transcript does not match this session',
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const covered = [...files].filter(
    (file) => ![...directories].some((dir) => file.startsWith(`${dir}${sep}`)),
  )
  const extras = source === 'claude' ? claudeSessionSidecars(roots, uuid) : []
  return [...new Set([...covered, ...directories, ...extras])].sort()
}

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLAUDE_SESSION_SIDECARS = ['file-history', 'session-env', 'tasks']

/** Claude config dirs (~/.claude, profiles) that own each resolved projects root. */
function claudeConfigDirs(roots: string[]) {
  return roots.filter((root) => basename(root) === 'projects').map((root) => dirname(root))
}

/** Per-session state Claude stores outside projects/, keyed by the session id. */
function claudeSessionSidecars(roots: string[], uuid: string): string[] {
  if (!CLAUDE_SESSION_ID.test(uuid)) return []
  const found: string[] = []
  for (const base of claudeConfigDirs(roots)) {
    for (const name of CLAUDE_SESSION_SIDECARS) {
      const path = join(base, name, uuid)
      try {
        const stat = lstatSync(path)
        if (stat.isSymbolicLink())
          throw new SessionDeletionBlockedError(
            'unsafe-path',
            `Claude session data is a symlink: ${path}`,
          )
        found.push(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  return found
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Claude registers live sessions in <config>/sessions/<pid>.json; deleting one would be rewritten. */
function assertClaudeSessionNotRunning(roots: string[], uuid: string) {
  for (const base of claudeConfigDirs(roots)) {
    let entries: string[]
    try {
      entries = readdirSync(join(base, 'sessions'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      let record: { sessionId?: unknown; pid?: unknown }
      try {
        record = JSON.parse(readFileSync(join(base, 'sessions', name), 'utf8'))
      } catch {
        continue
      }
      if (record.sessionId !== uuid || typeof record.pid !== 'number') continue
      if (isProcessAlive(record.pid))
        throw new SessionDeletionBlockedError(
          'running',
          `Session is still running in Claude process ${record.pid}`,
          { pid: record.pid, source: 'claude' },
        )
    }
  }
}

export function deleteIndexedSession(db: Database.Database, uuid: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM pins WHERE session_uuid = ?').run(uuid)
    db.prepare('DELETE FROM sessions WHERE session_uuid = ?').run(uuid)
  })()
}

export async function deleteSessionWithTranscripts(
  db: Database.Database,
  uuid: string,
  paths: string[],
  trash: (path: string) => Promise<void>,
) {
  let moved = 0
  try {
    for (const path of paths) {
      await trash(path)
      moved++
    }
  } catch (error) {
    throw new SessionDeletionPartialError(moved, error)
  }
  deleteIndexedSession(db, uuid)
}

const HERMES_SEPARATOR = '#local-session='

export interface HermesSessionTarget {
  /** Hermes' own session id (the index stores it as `hermes:<id>`). */
  sessionId: string
  /** HERMES_HOME that owns state.db; the CLI must run against this home. */
  hermesHome: string
  databasePath: string
}

/** Resolve an indexed Hermes session to the state.db row the Hermes CLI will act on. */
export function hermesSessionTarget(db: Database.Database, uuid: string): HermesSessionTarget {
  const session = db
    .prepare(
      'SELECT s.file_path AS path, src.name AS source FROM sessions s JOIN sources src ON src.id = s.source_id WHERE s.session_uuid = ?',
    )
    .get(uuid) as { path: string; source: SessionSource } | undefined
  if (!session) throw new Error('Session not found')
  if (session.source !== 'hermes') throw new Error('Not a Hermes session')
  const [databasePath, encoded] = session.path.split(HERMES_SEPARATOR)
  if (!encoded || basename(databasePath!) !== 'state.db')
    throw new SessionDeletionBlockedError(
      'unsafe-path',
      'Hermes session is not stored in state.db',
      { source: 'hermes' },
    )
  const sessionId = decodeURIComponent(encoded)
  if (`hermes:${sessionId}` !== uuid || sessionId.startsWith('-'))
    throw new SessionDeletionBlockedError(
      'unsafe-path',
      'Hermes session id does not match the index',
      { source: 'hermes' },
    )
  let resolvedDb: string
  try {
    resolvedDb = realpathSync(databasePath!)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new SessionDeletionBlockedError('root-unavailable', 'Hermes state.db is unavailable', {
        source: 'hermes',
      })
    throw error
  }
  const homes: string[] = []
  for (const root of getSessionRoots('hermes')) {
    try {
      homes.push(realpathSync(root))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const hermesHome = dirname(resolvedDb)
  if (!homes.includes(hermesHome))
    throw new SessionDeletionBlockedError(
      'unsafe-path',
      'Hermes state.db is outside the configured Hermes home',
      { source: 'hermes' },
    )
  return { sessionId, hermesHome, databasePath: resolvedDb }
}

export interface HermesCliResult {
  code: number | null
  output: string
}

/**
 * Hermes keeps every session in one shared SQLite store, so the row can't be trashed like a file.
 * Delegate to `hermes sessions delete --yes`, which also cascades delegate children, sweeps the
 * session's snapshot files and refuses rows with an active turn lease. The store is re-read
 * afterwards so the index only changes once the row is really gone. Not recoverable.
 */
export async function deleteHermesSession(
  db: Database.Database,
  uuid: string,
  runDelete: (target: HermesSessionTarget) => Promise<HermesCliResult>,
) {
  const target = hermesSessionTarget(db, uuid)
  const entry = (id: string) => `${target.databasePath}${HERMES_SEPARATOR}${encodeURIComponent(id)}`
  const result = await runDelete(target)
  let live: Set<string>
  try {
    live = new Set(listLocalAgentSessions(target.databasePath, 'hermes'))
  } catch (error) {
    throw new Error(
      `Hermes ran, but state.db could not be re-read: ${String(error)}\n${result.output}`,
    )
  }
  if (live.has(entry(target.sessionId))) {
    if (/Cannot delete active session/i.test(result.output))
      throw new SessionDeletionBlockedError('running', result.output.trim(), {
        source: 'hermes',
        output: result.output.trim(),
      })
    throw new Error(
      `Hermes did not delete the session (exit ${result.code}).\n${result.output.trim()}`,
    )
  }
  // The CLI cascades delegate children; drop every indexed row of this store that is gone too.
  const rows = db
    .prepare(
      "SELECT s.file_path AS path, s.session_uuid AS uuid FROM sessions s JOIN sources src ON src.id = s.source_id WHERE src.name = 'hermes'",
    )
    .all() as { path: string; uuid: string }[]
  for (const row of rows) {
    const [rowDb] = row.path.split(HERMES_SEPARATOR)
    let resolved = rowDb!
    try {
      resolved = realpathSync(rowDb!)
    } catch {}
    if (
      resolved === target.databasePath &&
      !live.has(entry(decodeURIComponent(row.path.split(HERMES_SEPARATOR)[1] ?? '')))
    )
      deleteIndexedSession(db, row.uuid)
  }
  deleteIndexedSession(db, uuid)
}

/**
 * Rename a Hermes session in Hermes itself via `hermes sessions rename`, which sanitizes the title
 * and rejects duplicates. The index then takes the title Hermes actually stored and keeps following
 * Hermes (title_source stays derived), so later renames in either place agree.
 */
export async function renameHermesSession(
  db: Database.Database,
  uuid: string,
  title: string,
  runRename: (target: HermesSessionTarget, title: string) => Promise<HermesCliResult>,
): Promise<string> {
  const name = title.trim()
  if (!name || /[\r\n\u0000]/.test(name)) throw new Error('Title must be a single non-empty line')
  const target = hermesSessionTarget(db, uuid)
  const result = await runRename(target, name)
  const output = result.output.trim().replace(/^Error:\s*/, '')
  if (result.code !== 0) throw new Error(output || `Hermes rename failed (exit ${result.code})`)
  const store = openDatabase(target.databasePath, { readonly: true, fileMustExist: true })
  let stored: string | null | undefined
  try {
    stored = (
      store.prepare('SELECT title FROM sessions WHERE id = ?').get(target.sessionId) as
        | { title: string | null }
        | undefined
    )?.title
  } finally {
    store.close()
  }
  if (!stored) throw new Error(`Hermes did not store a title for this session.\n${output}`)
  renameIndexedSession(db, uuid, stored)
  db.prepare("UPDATE sessions SET title_source = 'derived' WHERE session_uuid = ?").run(uuid)
  return stored
}

/**
 * Rename a Codex thread in Codex itself (app-server `thread/name/set`, injected), then take the
 * name Codex stored so AgentHub and the Codex app show the same title. title_source stays
 * derived: later renames made in Codex flow back through the catalog watcher.
 */
export async function renameCodexSession(
  db: Database.Database,
  uuid: string,
  title: string,
  setName: (threadId: string, name: string) => Promise<void>,
): Promise<string> {
  const name = title.trim()
  if (!name || /[\r\n\u0000]/.test(name)) throw new Error('Title must be a single non-empty line')
  const row = db
    .prepare(
      'SELECT src.name AS source FROM sessions s JOIN sources src ON src.id = s.source_id WHERE s.session_uuid = ?',
    )
    .get(uuid) as { source: SessionSource } | undefined
  if (!row) throw new Error('Session not found')
  if (row.source !== 'codex') throw new Error('Not a Codex session')
  await setName(uuid, name)
  const stored = loadCodexThreadCatalog()?.get(uuid)?.name ?? name
  renameIndexedSession(db, uuid, stored)
  db.prepare("UPDATE sessions SET title_source = 'derived' WHERE session_uuid = ?").run(uuid)
  return stored
}
