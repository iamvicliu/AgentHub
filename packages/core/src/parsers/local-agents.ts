import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type Database from 'better-sqlite3'

import { openDatabase } from '../db/native-binding.js'
import type { ParseSessionResult, ParsedMessage, SessionSource } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

type LocalSource = Extract<SessionSource, 'hermes' | 'openclaw'>
type RecordValue = Record<string, unknown>
const SEPARATOR = '#local-session='
export const LOCAL_AGENT_INDEX_VERSION = 'local-agents-v1'

export function localAgentDatabasePath(filePath: string): string {
  return filePath.split(SEPARATOR)[0]!
}

export function isLocalAgentDatabase(filePath: string): boolean {
  return ['state.db', 'openclaw-agent.sqlite'].includes(basename(localAgentDatabasePath(filePath)))
}

export function localAgentMtime(filePath: string): string {
  const path = localAgentDatabasePath(filePath)
  return [path, `${path}-wal`]
    .map((p) => (existsSync(p) ? `${statSync(p).mtimeMs}:${statSync(p).size}` : '-'))
    .join('|')
}

export function normalizeLocalAgentWatchPath(path: string): string {
  const base = path.replace(/-(?:wal|shm|journal)$/, '')
  return isLocalAgentDatabase(base) ? base : path
}

function openReadOnly(path: string): Database.Database {
  return openDatabase(path, { readonly: true, fileMustExist: true })
}

export function listLocalAgentSessions(path: string, source: LocalSource): string[] {
  const db = openReadOnly(path)
  try {
    const hiddenFilter =
      source === 'hermes' &&
      db
        .prepare('PRAGMA table_info(sessions)')
        .all()
        .some((column) => (column as { name: string }).name === 'hidden')
        ? ' AND COALESCE(hidden, 0) = 0'
        : ''
    const rows =
      source === 'hermes'
        ? (db
            .prepare(`SELECT id FROM sessions WHERE COALESCE(archived, 0) = 0${hiddenFilter}`)
            .all() as { id: string }[])
        : (db.prepare('SELECT session_id AS id FROM session_windows').all() as { id: string }[])
    return rows.map(({ id }) => `${path}${SEPARATOR}${encodeURIComponent(id)}`)
  } finally {
    db.close()
  }
}

function timestamp(value: unknown, fallback = '1970-01-01T00:00:00.000Z'): string {
  const date =
    typeof value === 'number'
      ? new Date(value < 1e12 ? value * 1000 : value)
      : typeof value === 'string'
        ? new Date(value)
        : null
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return stripSpoolSystemPrelude(content).trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block: RecordValue) => {
      if (!block || typeof block !== 'object') return ''
      if (typeof block.text === 'string') return block.text
      return block.type === 'image' || block.type === 'image_url' ? '[Image]' : ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function parseRecords(
  records: RecordValue[],
  filePath: string,
  source: LocalSource,
  metadata: RecordValue = {},
): ParseSessionResult {
  let id = String(metadata.id ?? basename(filePath, '.jsonl'))
  let cwd = typeof metadata.cwd === 'string' ? metadata.cwd : ''
  let model = typeof metadata.model === 'string' ? metadata.model : ''
  let title = typeof metadata.title === 'string' ? metadata.title : ''
  let startedAt = timestamp(metadata.started_at)
  const messages: ParsedMessage[] = []
  for (const record of records) {
    if (record.type === 'session' || record.role === 'session_meta') {
      if (typeof record.id === 'string') id = record.id
      if (typeof record.cwd === 'string') cwd = record.cwd
      if (typeof record.model === 'string') model = record.model
      startedAt = timestamp(record.timestamp, startedAt)
      continue
    }
    if (record.type === 'model_change' && typeof record.modelId === 'string') model = record.modelId
    if (record.type === 'session_info' && typeof record.name === 'string') title = record.name
    const msg =
      record.message && typeof record.message === 'object'
        ? (record.message as RecordValue)
        : record
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    if (msg.active === 0) continue
    if (typeof msg.model === 'string') model = msg.model
    const text = contentText(msg.content)
    let calls = msg.tool_calls
    if (typeof calls === 'string') calls = JSON.parse(calls)
    const toolNames = [
      ...new Set(
        [
          ...(Array.isArray(msg.content)
            ? msg.content.filter((b) => b?.type === 'toolCall').map((b) => b.name)
            : []),
          ...(Array.isArray(calls) ? calls.map((c) => c.function?.name ?? c.name) : []),
        ].filter((name): name is string => typeof name === 'string'),
      ),
    ]
    if (!text && !toolNames.length) continue
    messages.push({
      uuid: `${source}:${id}:${record.id ?? msg.id ?? messages.length}`,
      parentUuid: null,
      role: msg.role,
      contentText: text,
      timestamp: timestamp(record.timestamp ?? msg.timestamp, startedAt),
      isSidechain: false,
      toolNames,
      seq: messages.length,
    })
  }
  if (!messages.length) return { kind: 'skipped' }
  return {
    kind: 'parsed',
    session: {
      source,
      sessionUuid: `${source}:${id}`,
      filePath,
      title:
        title ||
        messages.find((m) => m.role === 'user' && m.contentText)?.contentText.slice(0, 120) ||
        '(no title)',
      cwd,
      model,
      startedAt: startedAt === '1970-01-01T00:00:00.000Z' ? messages[0]!.timestamp : startedAt,
      endedAt: messages.at(-1)!.timestamp,
      messages,
    },
  }
}

export function loadLocalAgentSession(filePath: string, source: LocalSource): ParseSessionResult {
  const path = localAgentDatabasePath(filePath)
  if (isLocalAgentDatabase(path)) {
    const encoded = filePath.split(SEPARATOR)[1]
    if (!encoded) throw new Error('A database session identity is required')
    const id = decodeURIComponent(encoded)
    const db = openReadOnly(path)
    try {
      if (source === 'hermes') {
        const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
          | RecordValue
          | undefined
        if (!session || session.archived === 1 || session.hidden === 1) return { kind: 'skipped' }
        const records = db
          .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp, id')
          .all(id) as RecordValue[]
        return parseRecords(records, filePath, source, session)
      }
      const session = db.prepare('SELECT * FROM session_windows WHERE session_id = ?').get(id) as
        | RecordValue
        | undefined
      if (!session) return { kind: 'skipped' }
      const activeProjection = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_transcript_active_events'",
        )
        .get()
      const events = db
        .prepare(
          activeProjection
            ? 'SELECT e.event_json FROM transcript_events e JOIN session_transcript_active_events a ON a.session_id = e.session_id AND a.event_seq = e.seq WHERE e.session_id = ? ORDER BY a.active_position'
            : 'SELECT event_json FROM transcript_events WHERE session_id = ? ORDER BY seq',
        )
        .all(id) as { event_json: string }[]
      return parseRecords(
        events.map((row) => JSON.parse(row.event_json)),
        filePath,
        source,
        {
          ...session,
          id,
          title: session.display_name,
          started_at: session.started_at ?? session.created_at,
        },
      )
    } finally {
      db.close()
    }
  }
  const records = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line, index, lines) => {
      try {
        return [JSON.parse(line) as RecordValue]
      } catch (error) {
        // An actively written final record may be incomplete; corruption elsewhere is an error.
        if (index === lines.length - 1) return []
        throw error
      }
    })
  if (source === 'hermes') {
    const dbPath = join(dirname(dirname(path)), 'state.db')
    if (existsSync(dbPath)) {
      const db = openReadOnly(dbPath)
      try {
        const existing = db
          .prepare('SELECT id FROM sessions WHERE id = ?')
          .get(basename(path, '.jsonl'))
        if (existing) return { kind: 'skipped' }
      } finally {
        db.close()
      }
    }
  }
  return parseRecords(records, filePath, source)
}
