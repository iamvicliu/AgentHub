import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { openDatabase } from '../db/native-binding.js'
import type { ParseSessionResult, ParsedMessage } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

// v1: initial Cursor support. The Cursor editor writes each agent chat as a
// JSONL transcript under ~/.cursor/projects/<workspace-slug>/agent-transcripts/:
// <id>/<id>.jsonl (older builds: <id>.jsonl directly). Each line is
// {role, message:{content:[…]}} with `text` and `tool_use` blocks, or a
// {type:'turn_ended', status} marker. The transcript carries no title, model,
// cwd or per-message time; those live in Cursor's own state store
// (globalStorage/state.vscdb, table cursorDiskKV, key composerData:<id>).
//
// Magpie (internal/sessions/cursor.go) reads the cursor-agent CLI's
// chats/<md5>/<id>/store.db instead — a different store that the editor does
// not write — so this reader is AgentHub's own.
// v2: chats with no workspace folder group under their workspace slug instead
// of the transcripts folder name.
// v3: re-index once more so sessions first indexed under v1 move to that
// project (a re-index now updates project_id).
export const CURSOR_INDEX_VERSION = 'cursor-v3-workspace-slug'

interface CursorBlock {
  type?: string
  text?: string
  name?: string
}

interface CursorLine {
  role?: string
  message?: { content?: unknown }
}

/** What Cursor's state store says about one chat. */
export interface CursorComposerMeta {
  title: string
  model: string
  cwd: string
  createdAt?: number | undefined
  updatedAt?: number | undefined
  archived: boolean
}

/** Cursor's placeholder names, shown until a chat gets a real title. */
const PLACEHOLDER_TITLES = new Set(['New Agent', 'New Chat', 'New Composer'])

export function loadCursorSession(filePath: string): ParseSessionResult {
  const sessionId = cursorSessionId(filePath)
  const meta = readCursorComposerMeta(sessionId)
  // Cursor hides archived chats; AgentHub mirrors that. The transcript stays
  // on disk untouched.
  if (meta?.archived) return { kind: 'filtered' }

  const raw = readFileSync(filePath, 'utf8')
  const fileStat = statSync(filePath)
  const startedAt = toIso(meta?.createdAt) ?? (fileStat.birthtime ?? fileStat.mtime).toISOString()
  // Cursor's lastUpdatedAt can lag the transcript (it is not bumped for every
  // line written), so the chat ends at whichever of the two is later.
  const transcriptEnd = fileStat.mtime.toISOString()
  const storeEnd = toIso(meta?.updatedAt)
  const endedAt = storeEnd && storeEnd > transcriptEnd ? storeEnd : transcriptEnd

  // Transcript lines carry no time. Cursor does stamp each user turn with a
  // <timestamp>; every message takes the most recent one seen, and messages
  // before the first stamp take the chat's start.
  let currentTime = startedAt
  const messages: ParsedMessage[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const record = parsed as CursorLine
    const role = record.role
    if (role !== 'user' && role !== 'assistant') continue

    const blocks = contentBlocks(record.message?.content)
    const text = stripSpoolSystemPrelude(
      blocks
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text!)
        .join('\n'),
    ).trim()

    if (role === 'user') {
      const stamped = parseCursorTimestamp(text)
      if (stamped) currentTime = stamped
      const contentText = cleanUserText(text)
      if (!contentText) continue
      messages.push(message(sessionId, messages.length, 'user', contentText, currentTime, []))
      continue
    }

    const toolNames = blocks
      .filter((block) => block.type === 'tool_use' && typeof block.name === 'string' && block.name)
      .map((block) => block.name!)
    if (!text && toolNames.length === 0) continue
    messages.push(message(sessionId, messages.length, 'assistant', text, currentTime, toolNames))
  }

  if (messages.length === 0) return { kind: 'skipped' }

  const firstUserMessage = messages.find(
    (entry) => entry.role === 'user' && entry.contentText.trim().length > 0,
  )
  const title = meta?.title || firstUserMessage?.contentText.trim().slice(0, 120) || '(no title)'

  return {
    kind: 'parsed',
    session: {
      source: 'cursor',
      sessionUuid: sessionId,
      filePath,
      title,
      cwd: meta?.cwd ?? '',
      model: meta?.model ?? '',
      startedAt,
      endedAt: endedAt < startedAt ? startedAt : endedAt,
      messages,
    },
  }
}

/** `<id>/<id>.jsonl` and the older `<id>.jsonl` both name the chat by file. */
export function cursorSessionId(filePath: string): string {
  return basename(filePath, '.jsonl')
}

/** Cursor's state store: `$SPOOL_CURSOR_STATE_DB`, else the editor's
 *  per-user globalStorage/state.vscdb for this platform. */
export function cursorStateDbPath(): string {
  const configured = process.env['SPOOL_CURSOR_STATE_DB']?.trim()
  if (configured) return configured
  const home = homedir()
  const userData =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Cursor')
      : process.platform === 'win32'
        ? join(process.env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'Cursor')
        : join(process.env['XDG_CONFIG_HOME'] || join(home, '.config'), 'Cursor')
  return join(userData, 'User', 'globalStorage', 'state.vscdb')
}

/** Revision marker for what Cursor keeps outside the transcript.
 *
 *  Renaming or archiving a chat only writes the state store, so the
 *  transcript's own mtime cannot tell the syncer to look again. */
export function cursorStateMtime(): string {
  return String(mtimeMs(cursorStateDbPath()))
}

const composerCache = new Map<string, { stamp: number; meta: CursorComposerMeta | null }>()

/** One chat's entry in Cursor's state store, or null when it cannot be read.
 *  An unreadable store must never hide a chat: it only costs the title. */
export function readCursorComposerMeta(sessionId: string): CursorComposerMeta | null {
  const dbPath = cursorStateDbPath()
  const stamp = mtimeMs(dbPath)
  if (stamp === 0) return null
  const cacheKey = `${dbPath}\u0000${sessionId}`
  const cached = composerCache.get(cacheKey)
  if (cached && cached.stamp === stamp) return cached.meta

  let meta: CursorComposerMeta | null = null
  try {
    // Opened read-only: Cursor's store uses a rollback journal, so this writes
    // nothing beside it.
    const db = openDatabase(dbPath, { readonly: true, fileMustExist: true })
    try {
      db.pragma('busy_timeout = 2000')
      const row = db
        .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
        .get(`composerData:${sessionId}`) as { value: string | Buffer | null } | undefined
      if (row?.value != null) meta = composerMetaFromJson(String(row.value))
    } finally {
      db.close()
    }
  } catch {
    meta = null
  }
  composerCache.set(cacheKey, { stamp, meta })
  return meta
}

export function composerMetaFromJson(json: string): CursorComposerMeta | null {
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    data = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const name = typeof data['name'] === 'string' ? data['name'].trim() : ''
  const modelConfig = data['modelConfig'] as { modelName?: unknown } | undefined
  const model = typeof modelConfig?.modelName === 'string' ? modelConfig.modelName : ''
  const workspace = data['workspaceIdentifier'] as
    | { uri?: { fsPath?: unknown; path?: unknown } }
    | undefined
  const fsPath = workspace?.uri?.fsPath ?? workspace?.uri?.path
  return {
    title: PLACEHOLDER_TITLES.has(name) ? '' : name,
    // "default" is Cursor choosing for the user, not a model name.
    model: model === 'default' ? '' : model,
    cwd: typeof fsPath === 'string' ? fsPath : '',
    createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : undefined,
    updatedAt: typeof data['lastUpdatedAt'] === 'number' ? data['lastUpdatedAt'] : undefined,
    archived: data['isArchived'] === true,
  }
}

function contentBlocks(content: unknown): CursorBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter((block): block is CursorBlock => !!block && typeof block === 'object')
}

const USER_QUERY = /<user_query>([\s\S]*?)<\/user_query>/g
/** Context Cursor puts in a user turn beside what was typed. */
const CURSOR_CONTEXT =
  /<(timestamp|image_files|uploaded_documents|attached_files|user_info|project_layout|rules|always_applied_workspace_rules|agent_requestable_workspace_rules|user_rules|agent_skills|available_skills|open_and_recently_viewed_files|system_reminder|system-reminder|git_status|agent_transcripts|cursor_rules_context|system_notification|task_notification|agent_notification|mcp_instructions)\b[^>]*>[\s\S]*?<\/\1>/g

/** What the user typed: their <user_query> when there is one, else the turn
 *  without the context Cursor wrapped around it. An attached image keeps an
 *  `[Image]` marker so the turn does not read as if nothing was sent. */
export function cleanUserText(text: string): string {
  const image = /^\[Image\]/.test(text) ? '[Image]\n' : ''
  const queries = Array.from(text.matchAll(USER_QUERY))
    .map((match) => match[1]!.trim())
    .filter(Boolean)
  if (queries.length > 0) return `${image}${queries.join('\n\n')}`.trim()
  return text.replace(CURSOR_CONTEXT, '').trim()
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const CURSOR_TIMESTAMP =
  /<timestamp>\s*\w+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC([+-]\d{1,2})(?::?(\d{2}))?\)\s*<\/timestamp>/i

/** Cursor stamps a user turn as
 *  `<timestamp>Tuesday, Aug 4, 2026, 6:43 PM (UTC+8)</timestamp>`. */
export function parseCursorTimestamp(text: string): string | undefined {
  const match = CURSOR_TIMESTAMP.exec(text)
  if (!match) return undefined
  const [, monthName, day, year, hour, minute, half, offsetHours, offsetMinutes] = match
  const month = MONTHS.indexOf(monthName!.slice(0, 3).toLowerCase())
  if (month < 0) return undefined
  let hours = Number(hour) % 12
  if (half!.toUpperCase() === 'PM') hours += 12
  const sign = offsetHours!.startsWith('-') ? -1 : 1
  const offset = Number(offsetHours) * 60 + sign * Number(offsetMinutes ?? 0)
  const utc = Date.UTC(Number(year), month, Number(day), hours, Number(minute)) - offset * 60_000
  const date = new Date(utc)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function message(
  sessionId: string,
  seq: number,
  role: 'user' | 'assistant',
  contentText: string,
  timestamp: string,
  toolNames: string[],
): ParsedMessage {
  return {
    uuid: `cursor-${sessionId}-${seq}`,
    parentUuid: seq > 0 ? `cursor-${sessionId}-${seq - 1}` : null,
    role,
    contentText,
    timestamp,
    isSidechain: false,
    toolNames,
    seq,
  }
}

function toIso(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  const date = new Date(value < 1e12 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function mtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}
