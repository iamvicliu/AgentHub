import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { openDatabase } from '../db/native-binding.js'
import { getSessionRoots } from './source-paths.js'

/**
 * Codex's own thread catalog (`<codex home>/state_<n>.sqlite`, table `threads`) is what the Codex
 * app lists. Mirroring it keeps AgentHub's Codex list and titles identical to the app: only
 * unarchived interactive threads (`cli` / `vscode`, the app-server's default `thread/list`
 * sources) are visible, and `threads.name` is the title. Subagent, exec and review threads stay
 * out of the list. Read-only; a missing store or unexpected schema yields null so callers fall
 * back to file-based indexing.
 */
export interface CodexThread {
  visible: boolean
  name: string | null
}

export type CodexThreadCatalog = Map<string, CodexThread>

const INTERACTIVE_SOURCES = new Set(['cli', 'vscode'])
const STATE_DB = /^state_(\d+)\.sqlite$/

/** Every Codex home (the parent of each configured sessions root). */
export function codexHomes(): string[] {
  return [...new Set(getSessionRoots('codex').map((root) => dirname(root)))]
}

/** Newest `state_<n>.sqlite` in a Codex home, or null. */
export function codexStateDatabase(home: string): string | null {
  let best: { version: number; name: string } | null = null
  let entries: string[]
  try {
    entries = readdirSync(home)
  } catch {
    return null
  }
  for (const name of entries) {
    const match = STATE_DB.exec(name)
    if (match && (!best || Number(match[1]) > best.version))
      best = { version: Number(match[1]), name }
  }
  return best ? join(home, best.name) : null
}

/** True when a changed file name belongs to the catalog or the legacy title index. */
export function isCodexCatalogFile(name: string): boolean {
  return /^state_\d+\.sqlite(?:-wal)?$/.test(name) || name === 'session_index.jsonl'
}

function readCatalog(path: string): CodexThreadCatalog | null {
  let db
  try {
    db = openDatabase(path, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
  try {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(threads)').all() as { name: string }[]).map((c) => c.name),
    )
    if (!['id', 'source', 'archived', 'name'].every((c) => columns.has(c))) return null
    const rows = db.prepare('SELECT id, source, archived, name FROM threads').all() as {
      id: string
      source: string | null
      archived: number | null
      name: string | null
    }[]
    const catalog: CodexThreadCatalog = new Map()
    for (const row of rows)
      catalog.set(row.id, {
        visible: !row.archived && INTERACTIVE_SOURCES.has(row.source ?? ''),
        name: row.name?.trim() || null,
      })
    return catalog
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** Merge the catalogs of every Codex home; null when none could be read. */
export function loadCodexThreadCatalog(): CodexThreadCatalog | null {
  let merged: CodexThreadCatalog | null = null
  for (const home of codexHomes()) {
    const path = codexStateDatabase(home)
    const catalog = path ? readCatalog(path) : null
    if (!catalog) continue
    merged ??= new Map()
    for (const [id, thread] of catalog) merged.set(id, thread)
  }
  return merged
}
