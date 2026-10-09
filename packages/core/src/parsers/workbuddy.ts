import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { openDatabase } from '../db/native-binding.js'
import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

// v1: initial WorkBuddy support. WorkBuddy (Tencent's desktop agent) writes one
// JSONL per session under its own projects/ folder, much as Claude Code does:
// <root>/<cwd-slug>/<uuid>.jsonl, with subagent transcripts at
// <root>/<cwd-slug>/<uuid>/subagents/*.jsonl. Each line is one OpenAI Agents
// SDK item — "message", "reasoning", "function_call", "function_call_result" —
// plus WorkBuddy's own "ai-title", "custom-title" and "file-history-snapshot".
// Reference: magpie's internal/sessions/workbuddy.go.
export const WORKBUDDY_INDEX_VERSION = 'workbuddy-v1-agents-sdk-items'

interface WorkBuddyContentBlock {
  type?: string
  text?: string
}

interface WorkBuddyProviderData {
  model?: string
  agent?: string
}

interface WorkBuddyRecord {
  type?: string
  id?: string
  parentId?: string
  /** Milliseconds since epoch — not an ISO string like Claude Code's. */
  timestamp?: number
  role?: string
  content?: unknown
  cwd?: string
  sessionId?: string
  aiTitle?: string
  title?: string
  providerData?: WorkBuddyProviderData
}

/** Parses a WorkBuddy session log (JSONL, OpenAI Agents SDK items).
 *
 *  Only `user` and `assistant` messages are indexed. `reasoning` and
 *  `function_call_result` items carry no user-facing text of their own —
 *  the assistant message already names its tool calls — and
 *  `file-history-snapshot` is bookkeeping.
 *
 *  The session's own title comes from WorkBuddy's `ai-title` (or a user
 *  `custom-title`); when neither is present we fall back to the first user
 *  message, matching how the other sources behave. */
export function loadWorkBuddySession(filePath: string): ParseSessionResult {
  // WorkBuddy hides archived conversations; AgentHub mirrors that. Sessions of
  // every other account are kept — the list labels them instead of dropping
  // them, so a previous account's history stays readable. The archived
  // transcript stays on disk untouched either way.
  const sessionId = basename(filePath, '.jsonl')
  const store = readWorkBuddyStore(filePath)
  if (store.archived.has(sessionId)) {
    return { kind: 'filtered' }
  }

  const raw = readFileSync(filePath, 'utf8')

  let sessionUuid = ''
  let cwd = ''
  let model = ''
  let sessionTitle = ''
  let customTitle = ''
  let headerStartedAt: number | undefined
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
    const record = parsed as WorkBuddyRecord

    if (typeof record.sessionId === 'string' && record.sessionId && !sessionUuid) {
      sessionUuid = record.sessionId
    }
    if (typeof record.cwd === 'string' && record.cwd && !cwd) cwd = record.cwd
    if (headerStartedAt === undefined && typeof record.timestamp === 'number') {
      headerStartedAt = record.timestamp
    }

    if (record.type === 'ai-title') {
      if (typeof record.aiTitle === 'string' && record.aiTitle.trim())
        sessionTitle = record.aiTitle.trim()
      continue
    }

    if (record.type === 'custom-title') {
      if (typeof record.title === 'string' && record.title.trim()) customTitle = record.title.trim()
      continue
    }

    if (record.type === 'reasoning') {
      if (!model && record.providerData?.model) model = record.providerData.model
      continue
    }

    if (record.type !== 'message') continue

    const role = record.role
    if (role !== 'user' && role !== 'assistant') continue

    if (!model && record.providerData?.model) model = record.providerData.model

    const rawText = extractText(record.content)
    const contentText = role === 'user' ? cleanUserText(rawText) : rawText
    if (!contentText) continue

    messages.push({
      uuid:
        typeof record.id === 'string' && record.id
          ? record.id
          : `workbuddy-${sessionUuid || basename(filePath)}-${messages.length}`,
      parentUuid: typeof record.parentId === 'string' ? record.parentId : null,
      role,
      contentText,
      timestamp: toIso(record.timestamp) ?? new Date().toISOString(),
      isSidechain: false,
      toolNames: [],
      seq: messages.length,
    })
  }

  if (messages.length === 0) return { kind: 'skipped' }

  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.contentText.trim().length > 0,
  )
  const title =
    customTitle ||
    sessionTitle ||
    firstUserMessage?.contentText.trim().slice(0, 120) ||
    '(no title)'

  const account = store.accounts.get(sessionId)

  return {
    kind: 'parsed',
    session: {
      source: 'workbuddy',
      sessionUuid: sessionUuid || sessionUuidFromFileName(filePath),
      filePath,
      title,
      cwd,
      model,
      ...(account !== undefined ? { account } : {}),
      startedAt: toIso(headerStartedAt) ?? messages[0]!.timestamp,
      endedAt: messages[messages.length - 1]!.timestamp,
      messages,
    },
  }
}

export function parseWorkBuddySession(filePath: string): ParsedSession | null {
  try {
    const result = loadWorkBuddySession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

/** WorkBuddy's own store sits beside `projects/`:
 *  `<base>/projects/<slug>/<uuid>.jsonl` → `<base>/workbuddy.db`. */
export function workBuddyDatabasePath(filePath: string): string {
  return join(dirname(dirname(dirname(filePath))), 'workbuddy.db')
}

/** WorkBuddy records the signed-in account here:
 *  `<base>/storage/skeleton/account-snapshot.json`. */
export function workBuddyAccountSnapshotPath(filePath: string): string {
  return join(dirname(dirname(dirname(filePath))), 'storage', 'skeleton', 'account-snapshot.json')
}

/** Revision marker for everything WorkBuddy stores outside the transcript.
 *
 *  Archiving writes `sessions.status = 'archived'` and signing in as another
 *  account rewrites the account snapshot; neither touches any transcript, so a
 *  session's own mtime cannot tell the syncer to look again. Folding both
 *  stores' mtimes into the indexed mtime makes either change re-index. */
export function workBuddyArchiveMtime(filePath: string): string {
  return `${mtimeMs(workBuddyDatabasePath(filePath))}::${mtimeMs(
    workBuddyAccountSnapshotPath(filePath),
  )}`
}

interface WorkBuddyStore {
  stamp: string
  /** Sessions WorkBuddy has archived. */
  archived: Set<string>
  /** Session id → account label. Empty when the store holds a single account,
   *  because then the label carries no information. */
  accounts: Map<string, string>
}

const workBuddyStoreCache = new Map<string, WorkBuddyStore>()

/** What WorkBuddy's own store says about its sessions, memoised per revision.
 *
 *  Sessions of every account are indexed — a previous account's history stays
 *  readable here — so the account is carried as a label rather than a filter.
 *  The label is only produced when the store actually holds more than one
 *  account; with a single account there is nothing to disambiguate and the
 *  list stays uncluttered. An unreadable store yields nothing at all: it must
 *  never hide or mislabel sessions. */
function readWorkBuddyStore(filePath: string): WorkBuddyStore {
  const dbPath = workBuddyDatabasePath(filePath)
  const snapshotPath = workBuddyAccountSnapshotPath(filePath)
  const stamp = `${mtimeMs(dbPath)}::${mtimeMs(snapshotPath)}`
  const cached = workBuddyStoreCache.get(dbPath)
  if (cached && cached.stamp === stamp) return cached

  const archived = new Set<string>()
  const bySession = new Map<string, string>()
  const byAccount = new Map<string, string>()
  let accounts = new Map<string, string>()
  if (mtimeMs(dbPath) > 0) {
    const signedIn = currentWorkBuddyAccount(snapshotPath)
    try {
      const db = openDatabase(dbPath, { readonly: true, fileMustExist: true })
      try {
        db.pragma('busy_timeout = 5000')
        const rows = db.prepare(`SELECT id, user_id, status FROM sessions`).all() as Array<{
          id: string
          user_id: string | null
          status: string | null
        }>
        for (const row of rows) {
          if (!row.id) continue
          // Matched case-insensitively, which is what WorkBuddy's own
          // `isArchivedStatus` does.
          if ((row.status ?? '').toLowerCase() === 'archived') archived.add(row.id)
          if (row.user_id) {
            bySession.set(row.id, row.user_id)
            byAccount.set(row.user_id, workBuddyAccountLabel(row.user_id, signedIn))
          }
        }
      } finally {
        db.close()
      }
      if (byAccount.size > 1) {
        accounts = new Map(
          [...bySession].map(([sessionId, userId]) => [sessionId, byAccount.get(userId)!]),
        )
      }
    } catch {
      // Older or locked database: index nothing extra rather than hide sessions.
    }
  }

  const store: WorkBuddyStore = { stamp, archived, accounts }
  workBuddyStoreCache.set(dbPath, store)
  return store
}

/** How one account is labelled in the UI.
 *
 *  Only the signed-in account has a name on disk, so it shows that; every other
 *  account falls back to a short form of its id, which is still enough to tell
 *  two accounts apart. */
function workBuddyAccountLabel(
  userId: string,
  signedIn: { uid: string; label: string | null } | null,
): string {
  if (signedIn && signedIn.uid === userId && signedIn.label) return signedIn.label
  return userId.slice(0, 8)
}

interface WorkBuddyAccount {
  uid: string
  label: string | null
}

/** The signed-in WorkBuddy account, or null when it cannot be determined. */
function currentWorkBuddyAccount(snapshotPath: string): WorkBuddyAccount | null {
  if (mtimeMs(snapshotPath) === 0) return null
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      primary?: { uid?: unknown; nickname?: unknown; enterpriseName?: unknown }
    }
    const uid = parsed.primary?.uid
    if (typeof uid !== 'string' || !uid) return null
    // The enterprise name reads better than the generated nickname; both are
    // optional, so either may be missing.
    const name = [parsed.primary?.enterpriseName, parsed.primary?.nickname].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
    return { uid, label: name ?? null }
  } catch {
    return null
  }
}

function mtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

/** Content blocks are `{type:'input_text'|'output_text', text}` for messages.
 *  A bare string is accepted too: older items in the moved-over history are
 *  not always block arrays. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return stripSpoolSystemPrelude(content).trim()
  if (!Array.isArray(content)) return ''

  return stripSpoolSystemPrelude(
    content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const { type, text } = block as WorkBuddyContentBlock
        if (typeof text !== 'string') return ''
        return type === 'input_text' || type === 'output_text' || type === 'text' ? text : ''
      })
      .filter(Boolean)
      .join('\n'),
  ).trim()
}

/** WorkBuddy wraps the typed prompt in a large injected <system-reminder>…
 *  block and then the prompt itself in <user_query>. Unlike session-kit's
 *  literal stripBlocks, the reminder tag carries attributes here, so it needs
 *  an attribute-tolerant match. Prefer the query when present; otherwise drop
 *  the reminder and keep whatever the user's turn actually said. */
const WORKBUDDY_USER_QUERY = /<user_query>([\s\S]*?)<\/user_query>/g
const WORKBUDDY_SYSTEM_REMINDER = /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/g

function cleanUserText(text: string): string {
  const queries = Array.from(text.matchAll(WORKBUDDY_USER_QUERY))
    .map((match) => match[1]!.trim())
    .filter(Boolean)
  if (queries.length > 0) return queries.join('\n\n')
  return text.replace(WORKBUDDY_SYSTEM_REMINDER, '').trim()
}

/** WorkBuddy stamps milliseconds; guard against a seconds value sneaking in. */
function toIso(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  // WorkBuddy stamps milliseconds; guard against a seconds value sneaking in.
  const ms = value < 1e12 ? value * 1000 : value
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Session files are named `<uuid>.jsonl`; recover the id when the record
 *  stream lost its `sessionId` (e.g. a truncated file). */
function sessionUuidFromFileName(filePath: string): string {
  return basename(filePath, '.jsonl')
}
