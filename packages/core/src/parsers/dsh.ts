import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import type { ParseSessionResult, ParsedMessage, ParsedSession } from '../types.js'
import { stripSpoolSystemPrelude } from './spool-prelude.js'

// v1: initial DeepSeek Harness (dsh) support.
//
// dsh keeps each session in a folder of its own under $DSH_HOME/sessions/
// (~/.dsh), one folder per working directory: <root>/<cwd-slug>/<session-id>/.
// The transcript is a single JSONL file whose name carries its format version —
// session.v<N>.jsonl, or session.v<N>.jsonl.zstd when compressed (dsh appends
// zstd frames a batch at a time). Carrying a session to a newer format leaves
// the older file behind, so only the highest version present is read.
//
// The first line is the header: id, cwd, createdAt, and — for a subagent's
// session — parentSession and delegationDepth. Every later line is one event,
// `{type, seq, time, data}`. The types we index:
//   - "user/message"      a prompt the user typed, but only when
//                         data.source.kind === 'user'; the rest are injected
//                         instructions, runtime snapshots and subagent reports
//   - "assistant/message" the reply, with its usage under data.usage
//   - "session/title"     the session's name
// Reference: magpie's internal/sessions/dsh.go.
export const DSH_INDEX_VERSION = 'dsh-v1-session-event-stream'

// session.jsonl, session.v3.jsonl, session.v4.jsonl.zstd, …
const DSH_FILE_NAME = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/

interface DshHeader {
  type?: string
  version?: number
  id?: string
  cwd?: string
  createdAt?: number
  parentSession?: string
  delegationDepth?: number
  origin?: string
  agentPreset?: string
}

interface DshContentBlock {
  type?: string
  text?: string
  name?: string
}

interface DshEventMessage {
  role?: string
  content?: unknown
}

interface DshUsage {
  inputTokens?: number
  outputTokens?: number
}

interface DshEvent {
  type?: string
  seq?: number
  time?: number
  data?: {
    title?: string
    source?: { kind?: string }
    content?: unknown
    message?: DshEventMessage
    usage?: DshUsage
  }
}

/** Resolves the transcript file to read inside a dsh session folder, picking
 *  the highest format version and preferring the compressed sibling that dsh
 *  writes alongside it. Returns null when the folder holds no transcript. */
export function resolveDshTranscript(sessionDir: string): string | null {
  let entries: string[]
  try {
    entries = readdirNames(sessionDir)
  } catch {
    return null
  }

  let bestVersion = -1
  let best: string | null = null
  for (const name of entries) {
    const match = DSH_FILE_NAME.exec(name)
    if (!match) continue
    const version = match[1] ? Number(match[1]) : 0
    if (version > bestVersion) {
      bestVersion = version
      best = join(sessionDir, name)
    } else if (version === bestVersion && best !== null) {
      // Same version in both forms: the newest write wins.
      const candidate = join(sessionDir, name)
      if (mtimeMs(candidate) > mtimeMs(best)) best = candidate
    }
  }
  return best
}

/** zstd frame magic (RFC 8878): every frame starts with these four bytes. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Reads a dsh transcript, transparently decompressing zstd frames.
 *
 *  dsh appends its transcript "a batch at a time", so a compressed file is a
 *  *concatenation of independent zstd frames*, not one stream. Node's
 *  `zstdDecompressSync` (and the streaming API) stop after the first frame —
 *  which for a real transcript is just the header line — so we split on the
 *  frame magic and inflate each frame ourselves. */
export function readDshTranscript(filePath: string): string {
  const buffer = readFileSync(filePath)
  if (!filePath.endsWith('.zstd')) return buffer.toString('utf8')
  return decompressZstdFrames(buffer).toString('utf8')
}

/** Inflates every frame in a concatenated-zstd buffer.
 *
 *  A frame's payload may itself contain the magic bytes, so a candidate split
 *  that fails to inflate is not a boundary: we extend to the next candidate
 *  and retry. Frames are small and few, so the retry cost is negligible. */
export function decompressZstdFrames(buffer: Buffer): Buffer {
  const starts: number[] = []
  for (let at = buffer.indexOf(ZSTD_MAGIC, 0); at !== -1; at = buffer.indexOf(ZSTD_MAGIC, at + 1)) {
    starts.push(at)
  }
  if (starts.length === 0) return zstdDecompressSync(buffer)
  if (starts[0] !== 0) starts.unshift(0)

  const parts: Buffer[] = []
  let index = 0
  while (index < starts.length) {
    let inflated: Buffer | undefined
    let next = index + 1
    for (; next <= starts.length; next++) {
      const end = next < starts.length ? starts[next]! : buffer.length
      try {
        inflated = zstdDecompressSync(buffer.subarray(starts[index]!, end))
        break
      } catch {
        // Either a truncated frame or a false magic inside a payload.
      }
    }
    if (!inflated) return zstdDecompressSync(buffer)
    parts.push(inflated)
    index = next
  }
  return Buffer.concat(parts)
}

/** Parses a dsh session transcript (JSONL: one header line, then events).
 *
 *  Subagent sessions (`origin: 'subagent'`, carrying `parentSession`) are
 *  skipped: dsh keeps each in its own folder rather than nesting it under the
 *  parent the way Claude Code does, so indexing them here would surface the
 *  same conversation twice with no content of the parent around them. */
export function loadDshSession(filePath: string): ParseSessionResult {
  // Archiving is recorded in dsh's workspace store, not in the transcript: the
  // session folder keeps its events. The folder name is the session id, so the
  // check is cheap and happens before the transcript is read or inflated.
  if (archivedDshSessionIds(filePath).has(basename(dirname(filePath)))) {
    return { kind: 'filtered' }
  }

  const raw = readDshTranscript(filePath)

  let sessionUuid = ''
  let cwd = ''
  let headerStartedAt = ''
  let sessionTitle = ''
  let isSubagent = false
  const messages: ParsedMessage[] = []

  let headerSeen = false
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue

    if (!headerSeen) {
      headerSeen = true
      const header = parsed as DshHeader
      if (header.type !== 'session') continue
      if (typeof header.id === 'string') sessionUuid = header.id
      if (typeof header.cwd === 'string') cwd = header.cwd
      headerStartedAt = toIso(header.createdAt) ?? ''
      if (
        header.origin === 'subagent' ||
        (typeof header.parentSession === 'string' && header.parentSession.length > 0)
      ) {
        isSubagent = true
      }
      continue
    }

    const event = parsed as DshEvent
    if (event.type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title.trim()) sessionTitle = title.trim()
      continue
    }

    if (event.type === 'user/message') {
      // Only a prompt the user actually typed; dsh also emits injected
      // instructions and runtime snapshots through the same event type.
      if (event.data?.source?.kind !== 'user') continue
      const contentText = extractText(event.data?.content)
      if (!contentText) continue
      messages.push(
        makeMessage({
          uuid: `dsh-user-${event.seq ?? messages.length}`,
          role: 'user',
          contentText,
          timestamp: toIso(event.time) ?? headerStartedAt,
          toolNames: [],
          seq: messages.length,
        }),
      )
      continue
    }

    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const contentText = extractText(content)
      const toolNames = extractToolNames(content)
      if (!contentText && toolNames.length === 0) continue
      messages.push(
        makeMessage({
          uuid: `dsh-assistant-${event.seq ?? messages.length}`,
          role: 'assistant',
          contentText,
          timestamp: toIso(event.time) ?? headerStartedAt,
          toolNames,
          seq: messages.length,
        }),
      )
      continue
    }
  }

  if (isSubagent) return { kind: 'filtered' }
  if (messages.length === 0) return { kind: 'skipped' }

  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.contentText.trim().length > 0,
  )
  const title = sessionTitle || firstUserMessage?.contentText.trim().slice(0, 120) || '(no title)'

  return {
    kind: 'parsed',
    session: {
      source: 'dsh',
      sessionUuid: sessionUuid || sessionUuidFromDir(filePath),
      filePath,
      title,
      cwd,
      model: '',
      startedAt: headerStartedAt || messages[0]!.timestamp,
      endedAt: messages[messages.length - 1]!.timestamp,
      messages,
    },
  }
}

export function parseDshSession(filePath: string): ParsedSession | null {
  try {
    const result = loadDshSession(filePath)
    return result.kind === 'parsed' ? result.session : null
  } catch {
    return null
  }
}

/** dsh's workspace store: `<base>/sessions/<slug>/<id>/session.vN.jsonl`, so
 *  the store is four levels up at `<base>/storages/workspace.json`. */
export function dshWorkspaceStorePath(filePath: string): string {
  return join(dirname(dirname(dirname(dirname(filePath)))), 'storages', 'workspace.json')
}

/** Revision marker for the archive state.
 *
 *  Archiving only updates the workspace store and leaves every transcript
 *  untouched, so a session's own mtime cannot tell the syncer to look again.
 *  Folding the store's mtime into the indexed mtime makes any archive or
 *  unarchive re-index the source. */
export function dshArchiveMtime(filePath: string): string {
  return String(mtimeMs(dshWorkspaceStorePath(filePath)))
}

interface DshArchiveCache {
  stamp: number
  ids: Set<string>
}

const dshArchiveCache = new Map<string, DshArchiveCache>()

/** Session ids dsh has archived, memoised per store revision.
 *
 *  `global.archivedSessionIds` in the workspace store is the authoritative
 *  list. A missing or unreadable store yields an empty set: an unreadable
 *  archive state must never hide sessions. */
function archivedDshSessionIds(filePath: string): Set<string> {
  const storePath = dshWorkspaceStorePath(filePath)
  const stamp = mtimeMs(storePath)
  const cached = dshArchiveCache.get(storePath)
  if (cached && cached.stamp === stamp) return cached.ids

  const ids = new Set<string>()
  if (stamp > 0) {
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as {
        global?: { archivedSessionIds?: unknown }
      }
      const listed = parsed.global?.archivedSessionIds
      if (Array.isArray(listed)) {
        for (const id of listed) if (typeof id === 'string' && id) ids.add(id)
      }
    } catch {
      // Unreadable store: index nothing extra rather than hide sessions.
    }
  }

  dshArchiveCache.set(storePath, { stamp, ids })
  return ids
}

function makeMessage(input: {
  uuid: string
  role: 'user' | 'assistant'
  contentText: string
  timestamp: string
  toolNames: string[]
  seq: number
}): ParsedMessage {
  return {
    uuid: input.uuid,
    parentUuid: null,
    role: input.role,
    contentText: input.contentText,
    timestamp: input.timestamp || new Date().toISOString(),
    isSidechain: false,
    toolNames: input.toolNames,
    seq: input.seq,
  }
}

/** Text blocks are `{type:'text', text}` in both user and assistant payloads;
 *  assistant messages also carry `reasoning` and `tool-call` blocks, which are
 *  not user-facing text. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return stripSpoolSystemPrelude(content).trim()
  if (!Array.isArray(content)) return ''

  return stripSpoolSystemPrelude(
    content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const { type, text } = block as DshContentBlock
        return type === 'text' && typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n'),
  ).trim()
}

function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return []

  return Array.from(
    new Set(
      content
        .map((block) => {
          if (!block || typeof block !== 'object') return undefined
          const { type, name } = block as DshContentBlock
          return type === 'tool-call' && typeof name === 'string' && name.trim().length > 0
            ? name
            : undefined
        })
        .filter((name): name is string => typeof name === 'string'),
    ),
  )
}

function toIso(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const ms = value < 1e12 ? value * 1000 : value
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function mtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir)
}

/** Transcripts live at <root>/<cwd-slug>/<session-id>/session.vN.jsonl[.zstd],
 *  so the session id is the folder name when the header lost it. */
function sessionUuidFromDir(filePath: string): string {
  return basename(dirname(filePath)) || basename(filePath)
}
