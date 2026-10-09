import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { OPENCODE_DB_NAME, isOpenCodeDatabaseFile } from '../parsers/opencode.js'
import type { SessionSource } from '../types.js'

const SOURCE_DIR_NAMES: Record<'claude' | 'codex', string> = {
  claude: 'projects',
  codex: 'sessions',
}

const SOURCE_ENV_VARS: Record<SessionSource, string> = {
  claude: 'SPOOL_CLAUDE_DIR',
  codex: 'SPOOL_CODEX_DIR',
  gemini: 'SPOOL_GEMINI_DIR',
  opencode: 'SPOOL_OPENCODE_DIR',
  pi: 'SPOOL_PI_DIR',
  hermes: 'SPOOL_HERMES_DIR',
  openclaw: 'SPOOL_OPENCLAW_DIR',
  workbuddy: 'SPOOL_WORKBUDDY_DIR',
  dsh: 'SPOOL_DSH_DIR',
  cursor: 'SPOOL_CURSOR_DIR',
}

/** dsh transcript names: session.v4.jsonl.zstd, session.jsonl, … */
const DSH_TRANSCRIPT_NAME = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/

const SOURCE_DEFAULT_BASES: Record<'claude' | 'codex', string> = {
  claude: '.claude',
  codex: '.codex',
}

const SOURCE_PROFILE_BASES: Record<'claude' | 'codex', string> = {
  claude: '.claude-profiles',
  codex: '.codex-profiles',
}

export function getSessionRoots(source: SessionSource): string[] {
  const configured = process.env[SOURCE_ENV_VARS[source]]
  if (configured) {
    return dedupePaths(
      splitConfiguredPaths(configured).map((path) => normalizeSourceRoot(source, path)),
    )
  }

  if (source === 'gemini') {
    return dedupePaths([normalizeSourceRoot('gemini', join(getGeminiBaseDir(), 'tmp'))])
  }

  if (source === 'opencode') {
    return dedupePaths([normalizeSourceRoot('opencode', getOpenCodeBaseDir())])
  }

  if (source === 'pi') {
    return dedupePaths([normalizeSourceRoot('pi', join(homedir(), '.pi', 'agent', 'sessions'))])
  }
  // WorkBuddy keeps its sessions in its own folder's projects/, one JSONL per
  // session under a per-cwd slug — the same shape as Claude Code's.
  if (source === 'workbuddy') {
    return dedupePaths([normalizeSourceRoot('workbuddy', getWorkBuddyBaseDir())])
  }
  // dsh keeps one folder per session under $DSH_HOME/sessions/<cwd-slug>/.
  if (source === 'dsh') {
    return dedupePaths([normalizeSourceRoot('dsh', getDshBaseDir())])
  }
  // The Cursor editor writes agent transcripts under its data folder's
  // projects/<workspace-slug>/agent-transcripts/.
  if (source === 'cursor') {
    return dedupePaths([normalizeSourceRoot('cursor', getCursorBaseDir())])
  }
  if (source === 'hermes')
    return [resolve(expandHome(process.env['HERMES_HOME'] || join(homedir(), '.hermes')))]
  if (source === 'openclaw')
    return [
      join(
        resolve(expandHome(process.env['OPENCLAW_STATE_DIR'] || join(homedir(), '.openclaw'))),
        'agents',
      ),
    ]

  const home = homedir()
  const childDir = SOURCE_DIR_NAMES[source]
  const roots = [join(home, SOURCE_DEFAULT_BASES[source], childDir)]
  const profilesBase = join(home, SOURCE_PROFILE_BASES[source])

  let entries: import('node:fs').Dirent<string>[] = []
  try {
    entries = readdirSync(profilesBase, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return roots
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    roots.push(join(profilesBase, entry.name, childDir))
  }

  return dedupePaths(roots)
}

export function detectSessionSource(
  filePath: string,
  sourceRoots: Partial<Record<SessionSource, string[]>> = {
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
  },
): SessionSource | undefined {
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
    if (sourceRoots[source]?.some((root) => isSessionFileForSource(source, filePath, root))) {
      return source
    }
  }
  return undefined
}

export function getSessionWatchPatterns(
  source: SessionSource,
  roots = getSessionRoots(source),
): string[] {
  if (source === 'hermes' || source === 'openclaw') {
    const dbName = source === 'hermes' ? 'state.db' : 'openclaw-agent.sqlite'
    return roots.flatMap((root) => [
      join(root, '**', '*.jsonl'),
      join(root, '**', dbName),
      join(root, '**', `${dbName}-wal`),
    ])
  }
  if (source === 'gemini') {
    return roots.flatMap((root) => [
      join(root, '**', 'session-*.json'),
      join(root, '**', 'session-*.jsonl'),
    ])
  }
  if (source === 'dsh') {
    // One transcript per session folder, compressed or not.
    return roots.flatMap((root) => [
      join(root, '**', 'session*.jsonl'),
      join(root, '**', 'session*.jsonl.zstd'),
    ])
  }
  if (source === 'codex') {
    // Older rollouts are packed into .jsonl.zst by Codex itself.
    return roots.flatMap((root) => [join(root, '**', '*.jsonl'), join(root, '**', '*.jsonl.zst')])
  }
  const pattern = source === 'opencode' ? OPENCODE_DB_NAME : '*.jsonl'
  return roots.map((root) => join(root, '**', pattern))
}

function splitConfiguredPaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .flatMap((part) => part.split(delimiter))
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeSourceRoot(source: SessionSource, filePath: string): string {
  const resolvedPath = resolve(expandHome(filePath))
  if (source === 'hermes')
    return basename(resolvedPath) === 'state.db' ? dirname(resolvedPath) : resolvedPath
  if (source === 'openclaw') {
    if (basename(resolvedPath) === 'openclaw-agent.sqlite') return dirname(resolvedPath)
    if (basename(resolvedPath) === '.openclaw' || existsSync(join(resolvedPath, 'agents')))
      return join(resolvedPath, 'agents')
    return resolvedPath
  }
  if (source === 'gemini') {
    if (basename(resolvedPath) === 'tmp') {
      return resolvedPath
    }
    if (basename(resolvedPath) === '.gemini' || existsSync(join(resolvedPath, 'tmp'))) {
      return join(resolvedPath, 'tmp')
    }
    if (existsSync(join(resolvedPath, '.gemini', 'tmp'))) {
      return join(resolvedPath, '.gemini', 'tmp')
    }
    return resolvedPath
  }

  if (source === 'opencode') {
    if (basename(resolvedPath) === OPENCODE_DB_NAME) return dirname(resolvedPath)
    if (existsSync(join(resolvedPath, OPENCODE_DB_NAME))) return resolvedPath
    if (existsSync(join(resolvedPath, '.local', 'share', 'opencode', OPENCODE_DB_NAME))) {
      return join(resolvedPath, '.local', 'share', 'opencode')
    }
    return resolvedPath
  }

  if (source === 'pi') {
    if (basename(resolvedPath) === 'sessions') return resolvedPath
    if (existsSync(join(resolvedPath, 'agent', 'sessions')))
      return join(resolvedPath, 'agent', 'sessions')
    if (existsSync(join(resolvedPath, 'sessions'))) return join(resolvedPath, 'sessions')
    return resolvedPath
  }

  if (source === 'workbuddy') {
    if (basename(resolvedPath) === 'projects') return resolvedPath
    if (existsSync(join(resolvedPath, 'projects'))) return join(resolvedPath, 'projects')
    return resolvedPath
  }

  if (source === 'dsh') {
    if (basename(resolvedPath) === 'sessions') return resolvedPath
    if (existsSync(join(resolvedPath, 'sessions'))) return join(resolvedPath, 'sessions')
    return resolvedPath
  }

  if (source === 'cursor') {
    if (basename(resolvedPath) === 'projects') return resolvedPath
    if (existsSync(join(resolvedPath, 'projects'))) return join(resolvedPath, 'projects')
    return resolvedPath
  }

  const childDir = SOURCE_DIR_NAMES[source]
  if (basename(resolvedPath) === childDir) return resolvedPath

  const nestedPath = join(resolvedPath, childDir)
  return existsSync(nestedPath) ? nestedPath : resolvedPath
}

function expandHome(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  return filePath
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => resolve(expandHome(path)))))
}

function getGeminiBaseDir(): string {
  const geminiCliHome = process.env['GEMINI_CLI_HOME']?.trim()
  return geminiCliHome
    ? join(resolve(expandHome(geminiCliHome)), '.gemini')
    : join(homedir(), '.gemini')
}

function getOpenCodeBaseDir(): string {
  const configuredHome = process.env['OPENCODE_DATA_DIR']?.trim()
  if (configuredHome) return resolve(expandHome(configuredHome))

  const xdgDataHome = process.env['XDG_DATA_HOME']?.trim()
  if (xdgDataHome) return join(resolve(expandHome(xdgDataHome)), 'opencode')

  return join(homedir(), '.local', 'share', 'opencode')
}

/** WorkBuddy's own folder: $WORKBUDDY_CONFIG_DIR, else ~/.workbuddy. Its
 *  sessions live under projects/ inside it. */
function getWorkBuddyBaseDir(): string {
  const configured = process.env['WORKBUDDY_CONFIG_DIR']?.trim()
  return configured ? resolve(expandHome(configured)) : join(homedir(), '.workbuddy')
}

/** DeepSeek Harness's own folder: $DSH_HOME, else ~/.dsh. Its sessions live
 *  under sessions/ inside it. */
function getDshBaseDir(): string {
  const configured = process.env['DSH_HOME']?.trim()
  return configured ? resolve(expandHome(configured)) : join(homedir(), '.dsh')
}

/** The Cursor editor's data folder: $CURSOR_DATA_DIR, else ~/.cursor. Its
 *  agent transcripts live under projects/ inside it. */
function getCursorBaseDir(): string {
  const configured = process.env['CURSOR_DATA_DIR']?.trim()
  return configured ? resolve(expandHome(configured)) : join(homedir(), '.cursor')
}

export function isSessionFileForSource(
  source: SessionSource,
  filePath: string,
  root: string,
): boolean {
  if (!isWithinRoot(filePath, root)) return false
  if (source === 'hermes' || source === 'openclaw') {
    const path = filePath.split('#local-session=')[0]!
    if (source === 'hermes')
      return (
        basename(path) === 'state.db' ||
        (dirname(path).endsWith('/sessions') && path.endsWith('.jsonl'))
      )
    return (
      basename(path) === 'openclaw-agent.sqlite' ||
      (dirname(path).endsWith('/sessions') && path.endsWith('.jsonl'))
    )
  }
  if (source === 'gemini') {
    if (!filePath.endsWith('.json') && !filePath.endsWith('.jsonl')) return false
    if (!basename(filePath).startsWith('session-')) return false
    if (!/(?:^|\/)chats\//.test(filePath)) return false
    // Resuming a legacy session in gemini-cli ≥0.39 migrates it to a sibling
    // .jsonl with the same basename and sessionId, leaving the stale .json in
    // place. Index only the live .jsonl — syncing both makes the two files
    // clobber each other's session row via UNIQUE(session_uuid) on every scan.
    if (filePath.endsWith('.json') && existsSync(`${filePath}l`)) return false
    return true
  }
  if (source === 'opencode') {
    return isOpenCodeDatabaseFile(filePath)
  }
  if (source === 'dsh') {
    return DSH_TRANSCRIPT_NAME.test(basename(filePath))
  }
  if (source === 'cursor') return isCursorTranscript(filePath, root)
  if (source === 'codex' && filePath.endsWith('.jsonl.zst')) {
    // Codex packs older rollouts into .jsonl.zst and removes the .jsonl. Should
    // both exist for a moment, index only the plain one: they share a session
    // id and would overwrite each other's row.
    return !existsSync(filePath.slice(0, -'.zst'.length))
  }
  if (source === 'workbuddy') {
    // <root>/<cwd-slug>/<uuid>.jsonl — exactly two segments, like Claude's.
    // A subagent's transcript sits deeper (<uuid>/subagents/*.jsonl) and shares
    // the parent's sessionId; indexing it standalone would duplicate the parent.
    if (!filePath.endsWith('.jsonl')) return false
    const rel = relative(root, filePath)
    return rel.length > 0 && rel.split(sep).length === 2
  }
  if (!filePath.endsWith('.jsonl')) return false
  if (source === 'claude' || source === 'pi') {
    // Claude sessions live at <root>/<slug>/<uuid>.jsonl — exactly two segments
    // relative to root. Nested files (e.g. <slug>/<uuid>/subagents/agent-*.jsonl)
    // are subagent scratchpads that share the parent's sessionId; indexing them
    // clobbers the parent row via UNIQUE(session_uuid) and zeros message_count.
    // Pi uses the same <root>/<cwd-slug>/<timestamp>_<uuid>.jsonl layout.
    const rel = relative(root, filePath)
    return rel.length > 0 && rel.split(sep).length === 2
  }
  return true
}

function isWithinRoot(filePath: string, root: string): boolean {
  const resolvedFile = resolve(filePath)
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolvedFile)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** <root>/<slug>/agent-transcripts/<id>/<id>.jsonl, or the older
 *  <root>/<slug>/agent-transcripts/<id>.jsonl. Anything else in a chat's
 *  folder (a subagent's transcript, attachments) is not a chat of its own. */
function isCursorTranscript(filePath: string, root: string): boolean {
  if (!filePath.endsWith('.jsonl')) return false
  const parts = relative(root, filePath).split(sep)
  if (parts.length === 3) return parts[1] === 'agent-transcripts'
  return parts.length === 4 && parts[1] === 'agent-transcripts' && parts[3] === `${parts[2]}.jsonl`
}
