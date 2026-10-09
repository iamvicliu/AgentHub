import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  dshArchiveMtime,
  dshWorkspaceStorePath,
  loadDshSession,
  parseDshSession,
  readDshTranscript,
  resolveDshTranscript,
} from './dsh.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-dsh-'))
  dirs.push(dir)
  return dir
}

function lines(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n'
}

const HEADER = {
  type: 'session',
  version: 4,
  id: '4bdb70f4-cdd7-4e5c-8420-4b379f837cd5',
  createdAt: Date.UTC(2026, 8, 30, 2, 40, 0),
  cwd: '/Users/me/work',
  isSeeded: false,
  delegationDepth: 0,
}

function userEvent(text: string, kind = 'user', seq = 1): unknown {
  return {
    type: 'user/message',
    seq,
    time: HEADER.createdAt + seq,
    data: { content: [{ type: 'text', text }], id: `u${seq}`, role: 'user', source: { kind } },
  }
}

function assistantEvent(blocks: unknown[], seq = 2): unknown {
  return {
    type: 'assistant/message',
    seq,
    time: HEADER.createdAt + seq,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: blocks },
      usage: { inputTokens: 10, outputTokens: 2 },
    },
  }
}

describe('dsh parser', () => {
  it('reads the header, user prompts, assistant replies and the session title', () => {
    const dir = sessionDir()
    const filePath = join(dir, 'session.v4.jsonl')
    writeFileSync(
      filePath,
      lines(
        HEADER,
        { type: 'session/title', seq: 0, time: HEADER.createdAt, data: { title: '项目结构梳理' } },
        userEvent('帮我梳理一下项目结构'),
        assistantEvent([
          { type: 'reasoning', text: '' },
          { type: 'text', text: '我先看磁盘。' },
          { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' },
        ]),
      ),
    )

    const result = loadDshSession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    expect(result.session.source).toBe('dsh')
    expect(result.session.sessionUuid).toBe('4bdb70f4-cdd7-4e5c-8420-4b379f837cd5')
    expect(result.session.title).toBe('项目结构梳理')
    expect(result.session.cwd).toBe('/Users/me/work')
    expect(result.session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.session.messages[0]!.contentText).toBe('帮我梳理一下项目结构')
    expect(result.session.messages[1]!.contentText).toBe('我先看磁盘。')
    expect(result.session.messages[1]!.toolNames).toEqual(['bash'])
  })

  it('ignores user/message events that are not the user typing', () => {
    const dir = sessionDir()
    const filePath = join(dir, 'session.jsonl')
    writeFileSync(
      filePath,
      lines(
        HEADER,
        userEvent('runtime snapshot body', 'runtime-context', 1),
        userEvent('skill catalogue', 'skill-catalog', 2),
        userEvent('real question', 'user', 3),
        assistantEvent([{ type: 'text', text: 'ok' }], 4),
      ),
    )

    const result = loadDshSession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.messages.map((m) => m.contentText)).toEqual(['real question', 'ok'])
  })

  it('filters a subagent session instead of indexing it separately', () => {
    const dir = sessionDir()
    const filePath = join(dir, 'session.v4.jsonl')
    writeFileSync(
      filePath,
      lines(
        { ...HEADER, origin: 'subagent', parentSession: 'session-parent', delegationDepth: 1 },
        userEvent('delegated task'),
        assistantEvent([{ type: 'text', text: 'done' }]),
      ),
    )

    expect(loadDshSession(filePath)).toEqual({ kind: 'filtered' })
  })

  it('inflates every zstd frame of a concatenated transcript', () => {
    // dsh appends "a batch at a time": each flush is its own zstd frame, and
    // Node's zstdDecompressSync stops after the first one. The header is its
    // own frame here, so a single-frame reader would see no messages at all.
    const dir = sessionDir()
    const filePath = join(dir, 'session.v4.jsonl.zstd')
    const frames = [
      zstdCompressSync(Buffer.from(lines(HEADER), 'utf8')),
      zstdCompressSync(
        Buffer.from(
          lines(
            userEvent('first frame question'),
            assistantEvent([{ type: 'text', text: 'first frame answer' }]),
          ),
          'utf8',
        ),
      ),
      zstdCompressSync(
        Buffer.from(
          lines(
            userEvent('second frame question', 'user', 3),
            assistantEvent([{ type: 'text', text: 'second frame answer' }], 4),
          ),
          'utf8',
        ),
      ),
    ]
    writeFileSync(filePath, Buffer.concat(frames))

    const result = loadDshSession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.messages.map((m) => m.contentText)).toEqual([
      'first frame question',
      'first frame answer',
      'second frame question',
      'second frame answer',
    ])
  })

  it('reads the highest format version present and prefers the compressed sibling', () => {
    const dir = sessionDir()
    writeFileSync(join(dir, 'session.v4.jsonl'), lines(HEADER))
    writeFileSync(join(dir, 'session.v3.jsonl'), lines(HEADER))
    expect(resolveDshTranscript(dir)).toBe(join(dir, 'session.v4.jsonl'))

    writeFileSync(
      join(dir, 'session.v4.jsonl.zstd'),
      zstdCompressSync(Buffer.from(lines(HEADER), 'utf8')),
    )
    expect(resolveDshTranscript(dir)).toBe(join(dir, 'session.v4.jsonl.zstd'))

    // A newer version wins even when the older one has a compressed sibling.
    mkdirSync(join(dir, 'nested'), { recursive: true })
    writeFileSync(join(dir, 'session.v5.jsonl'), lines(HEADER))
    expect(resolveDshTranscript(dir)).toBe(join(dir, 'session.v5.jsonl'))
  })

  it('returns null when the folder holds no transcript, and never throws on a missing file', () => {
    const dir = sessionDir()
    writeFileSync(join(dir, 'session.lock'), '')
    expect(resolveDshTranscript(dir)).toBeNull()

    expect(parseDshSession(join(dir, 'session.v4.jsonl'))).toBeNull()
    expect(parseDshSession('/no/such/dir/session.v4.jsonl')).toBeNull()
  })

  it('reads an uncompressed transcript unchanged', () => {
    const dir = sessionDir()
    const filePath = join(dir, 'session.jsonl')
    const text = lines(HEADER, userEvent('plain'))
    writeFileSync(filePath, text)
    expect(readDshTranscript(filePath)).toBe(text)
  })
})

describe('dsh archived sessions', () => {
  /** Builds the real layout, `<base>/sessions/<slug>/<id>/`, so the archive
   *  store sits where the parser looks for it: `<base>/storages/`. */
  function layout(sessionId: string): { filePath: string; storePath: string } {
    const base = mkdtempSync(join(tmpdir(), 'spool-dsh-archive-'))
    dirs.push(base)
    const dir = join(base, 'sessions', '--work--', sessionId)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'session.v4.jsonl')
    writeFileSync(
      filePath,
      lines(
        { ...HEADER, id: sessionId },
        userEvent('question'),
        assistantEvent([{ type: 'text', text: 'answer' }]),
      ),
    )
    return { filePath, storePath: join(base, 'storages', 'workspace.json') }
  }

  function writeStore(storePath: string, archivedSessionIds: string[]): void {
    mkdirSync(dirname(storePath), { recursive: true })
    writeFileSync(
      storePath,
      JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: { archivedSessionIds } }),
    )
  }

  it('hides a session listed in the workspace store, and shows it again once unarchived', () => {
    const archived = layout('session-archived')
    writeStore(archived.storePath, ['session-archived'])
    expect(dshWorkspaceStorePath(archived.filePath)).toBe(archived.storePath)
    expect(loadDshSession(archived.filePath)).toEqual({ kind: 'filtered' })

    // A different base directory, so the store's memoised revision cannot be
    // confused with the archived case above.
    const live = layout('session-live')
    writeStore(live.storePath, [])
    const result = loadDshSession(live.filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.sessionUuid).toBe('session-live')
  })

  it('indexes normally when the store is missing, unreadable, or lists other ids', () => {
    const missing = layout('session-no-store')
    expect(loadDshSession(missing.filePath).kind).toBe('parsed')

    const malformed = layout('session-malformed-store')
    mkdirSync(dirname(malformed.storePath), { recursive: true })
    writeFileSync(malformed.storePath, '{not json')
    // An unreadable archive state must never hide sessions.
    expect(loadDshSession(malformed.filePath).kind).toBe('parsed')

    const unrelated = layout('session-unrelated')
    writeStore(unrelated.storePath, ['session-somebody-else'])
    expect(loadDshSession(unrelated.filePath).kind).toBe('parsed')
  })

  it('reports an archive revision so a sync re-checks transcripts that did not change', () => {
    const { filePath, storePath } = layout('session-revision')
    writeStore(storePath, [])
    expect(dshArchiveMtime(filePath)).toBe(String(statMtime(storePath)))
  })
})

function statMtime(filePath: string): number {
  return statSync(filePath).mtimeMs
}
