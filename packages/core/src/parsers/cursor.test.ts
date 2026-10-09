import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { isSessionFileForSource } from '../sync/source-paths.js'
import {
  cleanUserText,
  composerMetaFromJson,
  cursorStateMtime,
  loadCursorSession,
  parseCursorTimestamp,
} from './cursor.js'

const ID = '00000000-0000-4000-8000-0000000000c1'
const dirs: string[] = []
let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'spool-cursor-'))
  dirs.push(base)
  // Never read the developer's real Cursor store.
  vi.stubEnv('SPOOL_CURSOR_STATE_DB', join(base, 'state.vscdb'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function transcript(lines: unknown[], id = ID): string {
  const dir = join(base, 'projects', 'empty-window', 'agent-transcripts', id)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${id}.jsonl`)
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return filePath
}

function user(text: string): unknown {
  return { role: 'user', message: { content: [{ type: 'text', text }] } }
}

function assistant(...content: unknown[]): unknown {
  return { role: 'assistant', message: { content } }
}

function stateStore(composers: Record<string, unknown>): void {
  const db = new Database(join(base, 'state.vscdb'))
  db.exec('CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)')
  for (const [id, data] of Object.entries(composers)) {
    insert.run(`composerData:${id}`, JSON.stringify(data))
  }
  db.close()
}

describe('Cursor parser', () => {
  it('reads user queries, assistant text and tool names', () => {
    const filePath = transcript([
      user(
        '<timestamp>Friday, Sep 11, 2026, 7:10 PM (UTC+8)</timestamp>\n<user_query>\n检查下 CLI 版本是多少\n</user_query>',
      ),
      assistant(
        { type: 'text', text: '我先看一下。' },
        { type: 'tool_use', name: 'Shell', input: { command: 'tool --version' } },
      ),
      assistant({ type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } }),
      { type: 'turn_ended', status: 'success' },
      assistant({ type: 'text', text: '版本是 1.2.3。' }),
    ])

    const result = loadCursorSession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    const { session } = result
    expect(session.source).toBe('cursor')
    expect(session.sessionUuid).toBe(ID)
    expect(session.title).toBe('检查下 CLI 版本是多少')
    expect(session.messages.map((m) => [m.role, m.contentText, m.toolNames])).toEqual([
      ['user', '检查下 CLI 版本是多少', []],
      ['assistant', '我先看一下。', ['Shell']],
      ['assistant', '', ['Read']],
      ['assistant', '版本是 1.2.3。', []],
    ])
    // Every message takes the user turn's <timestamp>: 19:10 at UTC+8.
    expect(session.messages.every((m) => m.timestamp === '2026-09-11T11:10:00.000Z')).toBe(true)
  })

  it('takes title, model, cwd and times from Cursor’s state store', () => {
    stateStore({
      [ID]: {
        name: 'Chart translation',
        createdAt: Date.UTC(2026, 8, 11, 8, 0),
        lastUpdatedAt: Date.UTC(2026, 8, 11, 9, 0),
        modelConfig: { modelName: 'grok-4.6' },
        workspaceIdentifier: { id: 'w', uri: { fsPath: '/Users/me/project' } },
      },
    })
    const filePath = transcript([user('<user_query>翻译这张图</user_query>')])
    utimesSync(
      filePath,
      new Date(Date.UTC(2026, 8, 11, 8, 30)),
      new Date(Date.UTC(2026, 8, 11, 8, 30)),
    )
    const result = loadCursorSession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.session.title).toBe('Chart translation')
    expect(result.session.model).toBe('grok-4.6')
    expect(result.session.cwd).toBe('/Users/me/project')
    expect(result.session.startedAt).toBe('2026-09-11T08:00:00.000Z')
    expect(result.session.endedAt).toBe('2026-09-11T09:00:00.000Z')
    // No <timestamp> in the turn: the message takes the chat's start.
    expect(result.session.messages[0]!.timestamp).toBe('2026-09-11T08:00:00.000Z')
  })

  it('ends a chat at the transcript’s last write when the store lags behind', () => {
    stateStore({
      [ID]: {
        name: 'Lagging',
        createdAt: Date.UTC(2026, 8, 11, 8, 0),
        lastUpdatedAt: Date.UTC(2026, 8, 11, 8, 0),
      },
    })
    const filePath = transcript([user('<user_query>hi</user_query>')])
    utimesSync(
      filePath,
      new Date(Date.UTC(2026, 8, 11, 8, 6)),
      new Date(Date.UTC(2026, 8, 11, 8, 6)),
    )
    const result = loadCursorSession(filePath)
    expect(result.kind === 'parsed' && result.session.endedAt).toBe('2026-09-11T08:06:00.000Z')
  })

  it('hides a chat Cursor has archived', () => {
    stateStore({ [ID]: { name: 'Old chat', isArchived: true } })
    expect(loadCursorSession(transcript([user('<user_query>hi</user_query>')])).kind).toBe(
      'filtered',
    )
  })

  it('keeps the chat when the state store is missing or unreadable', () => {
    const filePath = transcript([user('<user_query>hi</user_query>')])
    expect(loadCursorSession(filePath).kind).toBe('parsed')

    writeFileSync(join(base, 'state.vscdb'), 'not a database')
    const result = loadCursorSession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind === 'parsed') expect(result.session.title).toBe('hi')
  })

  it('skips a transcript with nothing to show', () => {
    expect(loadCursorSession(transcript([{ type: 'turn_ended', status: 'success' }])).kind).toBe(
      'skipped',
    )
  })

  it('changes its revision when the state store changes', () => {
    expect(cursorStateMtime()).toBe('0')
    stateStore({})
    expect(cursorStateMtime()).not.toBe('0')
  })
})

describe('Cursor user text', () => {
  it('drops the context Cursor wraps around the query and keeps an image marker', () => {
    expect(
      cleanUserText(
        '[Image]\n<image_files>\nThe following images were provided…\n1. /x.png\n</image_files>\n<timestamp>Friday, Sep 11, 2026, 4:17 PM (UTC+8)</timestamp>\n<user_query>\n翻译成中文\n</user_query>',
      ),
    ).toBe('[Image]\n翻译成中文')
    expect(
      cleanUserText('<uploaded_documents>\n- /a.xlsx\n</uploaded_documents>\n直接说的话'),
    ).toBe('直接说的话')
  })

  it('parses Cursor’s turn timestamps, including negative offsets and midnight', () => {
    expect(
      parseCursorTimestamp('<timestamp>Tuesday, Aug 4, 2026, 6:43 PM (UTC+8)</timestamp>'),
    ).toBe('2026-08-04T10:43:00.000Z')
    expect(
      parseCursorTimestamp('<timestamp>Monday, March 2, 2026, 12:05 AM (UTC-5)</timestamp>'),
    ).toBe('2026-03-02T05:05:00.000Z')
    expect(parseCursorTimestamp('no stamp here')).toBeUndefined()
  })

  it('treats placeholder titles and the "default" model as unset', () => {
    expect(
      composerMetaFromJson(
        JSON.stringify({ name: 'New Agent', modelConfig: { modelName: 'default' } }),
      ),
    ).toMatchObject({ title: '', model: '', archived: false })
    expect(composerMetaFromJson('not json')).toBeNull()
  })
})

describe('Cursor transcript paths', () => {
  it('indexes a chat’s own transcript and the older flat layout, nothing else', () => {
    const root = '/home/me/.cursor/projects'
    const at = (rel: string) => isSessionFileForSource('cursor', join(root, rel), root)
    expect(at(`slug/agent-transcripts/${ID}/${ID}.jsonl`)).toBe(true)
    expect(at(`slug/agent-transcripts/${ID}.jsonl`)).toBe(true)
    // A subagent's transcript inside the chat's folder is not a chat of its own.
    expect(at(`slug/agent-transcripts/${ID}/other.jsonl`)).toBe(false)
    expect(at(`slug/agent-tools/${ID}.jsonl`)).toBe(false)
    expect(at(`slug/agent-transcripts/${ID}/${ID}.txt`)).toBe(false)
  })
})
