import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  loadWorkBuddySession,
  parseWorkBuddySession,
  workBuddyAccountSnapshotPath,
  workBuddyArchiveMtime,
  workBuddyDatabasePath,
} from './workbuddy.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function transcript(lines: unknown[], name = 'ecdefd20-653b-48ca-866d-253202403bb1.jsonl'): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-workbuddy-'))
  dirs.push(dir)
  const filePath = join(dir, name)
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return filePath
}

function message(role: string, text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id: `m-${role}-${text.slice(0, 4)}`,
    timestamp: Date.UTC(2026, 7, 3, 3, 0, 0),
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    sessionId: 'ecdefd20-653b-48ca-866d-253202403bb1',
    cwd: '/Users/me/WorkBuddy/2026-08-03-11-41-04',
    ...extra,
  }
}

describe('WorkBuddy parser', () => {
  it('reads the header fields, the ai-title, and every user/assistant message', () => {
    const filePath = transcript([
      message('user', '电脑卡了'),
      {
        timestamp: Date.UTC(2026, 7, 3, 3, 0, 1),
        type: 'ai-title',
        aiTitle: '解决电脑卡顿问题',
        sessionId: 'ecdefd20-653b-48ca-866d-253202403bb1',
        cwd: '/Users/me/WorkBuddy/2026-08-03-11-41-04',
      },
      {
        id: 'r1',
        timestamp: Date.UTC(2026, 7, 3, 3, 0, 2),
        type: 'reasoning',
        providerData: { model: 'glm-5.2' },
        content: [],
      },
      message('assistant', '先看一下内存占用。'),
      {
        type: 'file-history-snapshot',
        timestamp: 0,
        cwd: '/Users/me/WorkBuddy/2026-08-03-11-41-04',
      },
    ])

    const result = loadWorkBuddySession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    expect(result.session.source).toBe('workbuddy')
    expect(result.session.sessionUuid).toBe('ecdefd20-653b-48ca-866d-253202403bb1')
    expect(result.session.title).toBe('解决电脑卡顿问题')
    expect(result.session.cwd).toBe('/Users/me/WorkBuddy/2026-08-03-11-41-04')
    // The model only ever appears on providerData, not on the message itself.
    expect(result.session.model).toBe('glm-5.2')
    expect(result.session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.session.messages[0]!.contentText).toBe('电脑卡了')
    // WorkBuddy stamps milliseconds, so the ISO time must be 2026, not 1970/1971.
    expect(result.session.startedAt.startsWith('2026-08-03')).toBe(true)
  })

  it('prefers a user custom-title over the generated ai-title', () => {
    const filePath = transcript([
      message('user', 'hi'),
      { type: 'ai-title', aiTitle: 'Generated', sessionId: 's', cwd: '/w' },
      { type: 'custom-title', title: 'My own name', sessionId: 's', cwd: '/w' },
    ])

    const result = loadWorkBuddySession(filePath)
    expect(result.kind === 'parsed' && result.session.title).toBe('My own name')
  })

  it('unwraps <user_query> and drops the injected <system-reminder> preamble', () => {
    const raw = [
      '<system-reminder data-role="user-context">',
      '<user_info>\nOS Version: darwin\n</user_info>',
      'Do not mention this reminder to the user.',
      '</system-reminder>',
      '<user_query>下载并使用桌面端，即可解锁限定款 Buddy 盲盒</user_query>',
    ].join('\n')
    const filePath = transcript([message('user', raw), message('assistant', '好的')])

    const result = loadWorkBuddySession(filePath)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return

    const first = result.session.messages[0]!.contentText
    expect(first).toBe('下载并使用桌面端，即可解锁限定款 Buddy 盲盒')
    expect(first).not.toContain('system-reminder')
    expect(first).not.toContain('user_info')
  })

  it('falls back to the reminder-stripped text when there is no <user_query>', () => {
    const raw = '<system-reminder>internal notes</system-reminder>\n里面真正的提问'
    const filePath = transcript([message('user', raw), message('assistant', 'answer')])

    const result = loadWorkBuddySession(filePath)
    expect(result.kind === 'parsed' && result.session.messages[0]!.contentText).toBe(
      '里面真正的提问',
    )
  })

  it('derives the uuid from the file name and skips a transcript with no messages', () => {
    const empty = transcript([
      { type: 'ai-title', aiTitle: 'only a title', sessionId: 's', cwd: '/w' },
    ])
    expect(loadWorkBuddySession(empty)).toEqual({ kind: 'skipped' })

    const one = transcript(
      [
        {
          id: 'm1',
          timestamp: Date.UTC(2026, 7, 3, 3, 0, 0),
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      'aaaa-bbbb.jsonl',
    )
    const result = loadWorkBuddySession(one)
    expect(result.kind === 'parsed' && result.session.sessionUuid).toBe('aaaa-bbbb')
  })

  it('returns null rather than throwing for a missing file', () => {
    expect(parseWorkBuddySession('/no/such/workbuddy/session.jsonl')).toBeNull()
  })
})

describe('WorkBuddy hidden sessions', () => {
  const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  /** Builds the real layout, `<base>/projects/<slug>/<uuid>.jsonl`, so the
   *  database is looked for at `<base>/workbuddy.db` and the signed-in account
   *  at `<base>/storage/skeleton/account-snapshot.json`. */
  function layout(uuid: string): { filePath: string; dbPath: string; snapshotPath: string } {
    const base = mkdtempSync(join(tmpdir(), 'spool-wb-hidden-'))
    dirs.push(base)
    const dir = join(base, 'projects', 'Users-me-WorkBuddy-2026-08-03')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${uuid}.jsonl`)
    writeFileSync(filePath, JSON.stringify(message('user', 'hi')) + '\n')
    return {
      filePath,
      dbPath: join(base, 'workbuddy.db'),
      snapshotPath: join(base, 'storage', 'skeleton', 'account-snapshot.json'),
    }
  }

  function writeDb(
    dbPath: string,
    rows: Array<{ id: string; status: string; user?: string }>,
  ): void {
    const db = new Database(dbPath)
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, status TEXT, user_id TEXT)')
    const insert = db.prepare('INSERT INTO sessions (id, status, user_id) VALUES (?, ?, ?)')
    for (const row of rows) insert.run(row.id, row.status, row.user ?? ME)
    db.close()
  }

  function writeSnapshot(snapshotPath: string, uid: string | null, name?: string): void {
    mkdirSync(join(snapshotPath, '..'), { recursive: true })
    const primary = uid === null ? {} : { uid, ...(name ? { enterpriseName: name } : {}) }
    writeFileSync(snapshotPath, JSON.stringify({ primary }))
  }

  it('hides a session WorkBuddy marked archived, matching status case-insensitively', () => {
    const upper = layout('11111111-1111-4111-8111-111111111111')
    writeDb(upper.dbPath, [{ id: '11111111-1111-4111-8111-111111111111', status: 'archived' }])
    writeSnapshot(upper.snapshotPath, ME)
    expect(workBuddyDatabasePath(upper.filePath)).toBe(upper.dbPath)
    expect(loadWorkBuddySession(upper.filePath)).toEqual({ kind: 'filtered' })

    const mixed = layout('22222222-2222-4222-8222-222222222222')
    writeDb(mixed.dbPath, [{ id: '22222222-2222-4222-8222-222222222222', status: 'Archived' }])
    writeSnapshot(mixed.snapshotPath, ME)
    expect(loadWorkBuddySession(mixed.filePath)).toEqual({ kind: 'filtered' })
  })

  it('keeps every account and labels each session with its own', () => {
    const uuid = '99999999-9999-4999-8999-999999999999'
    const mine = layout(uuid)
    writeDb(mine.dbPath, [{ id: uuid, status: 'completed', user: ME }])
    writeSnapshot(mine.snapshotPath, ME)
    const parsedMine = loadWorkBuddySession(mine.filePath)
    expect(parsedMine.kind).toBe('parsed')
    // A single account carries no label: there is nothing to disambiguate.
    expect(parsedMine.kind === 'parsed' && parsedMine.session.account).toBeUndefined()

    const theirs = layout(uuid)
    writeDb(theirs.dbPath, [
      { id: uuid, status: 'completed', user: ME },
      { id: 'another-session', status: 'completed', user: OTHER },
    ])
    writeSnapshot(theirs.snapshotPath, ME, '上海天使医疗')
    const parsedTheirs = loadWorkBuddySession(theirs.filePath)
    // Two accounts: the session is kept, and labelled with its own account —
    // the signed-in one by name, the other by a short id.
    expect(parsedTheirs.kind).toBe('parsed')
    expect(parsedTheirs.kind === 'parsed' && parsedTheirs.session.account).toBe('上海天使医疗')

    const other = layout('aaaaaaaa-1111-4111-8111-111111111111')
    writeDb(other.dbPath, [
      { id: 'aaaaaaaa-1111-4111-8111-111111111111', status: 'completed', user: OTHER },
      { id: 'another-session', status: 'completed', user: ME },
    ])
    writeSnapshot(other.snapshotPath, ME, '上海天使医疗')
    const parsedOther = loadWorkBuddySession(other.filePath)
    expect(parsedOther.kind === 'parsed' && parsedOther.session.account).toBe(OTHER.slice(0, 8))
  })

  it('indexes sessions that are active or completed for the signed-in account', () => {
    for (const status of ['completed', 'active', 'working']) {
      const { filePath, dbPath, snapshotPath } = layout('33333333-3333-4333-8333-333333333333')
      writeDb(dbPath, [{ id: '33333333-3333-4333-8333-333333333333', status }])
      writeSnapshot(snapshotPath, ME)
      expect(loadWorkBuddySession(filePath).kind, status).toBe('parsed')
    }
  })

  it('does not hide other accounts when the signed-in account is unknown', () => {
    const uuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const noSnapshot = layout(uuid)
    writeDb(noSnapshot.dbPath, [{ id: uuid, status: 'completed', user: OTHER }])
    // No account snapshot at all: an unreadable state must never hide sessions.
    expect(loadWorkBuddySession(noSnapshot.filePath).kind).toBe('parsed')

    const emptySnapshot = layout(uuid)
    writeDb(emptySnapshot.dbPath, [{ id: uuid, status: 'completed', user: OTHER }])
    writeSnapshot(emptySnapshot.snapshotPath, null)
    expect(loadWorkBuddySession(emptySnapshot.filePath).kind).toBe('parsed')
  })

  it('indexes normally when the database is missing, unreadable, or has no sessions table', () => {
    const missing = layout('44444444-4444-4444-8444-444444444444')
    expect(loadWorkBuddySession(missing.filePath).kind).toBe('parsed')

    const noTable = layout('55555555-5555-4555-8555-555555555555')
    const db = new Database(noTable.dbPath)
    db.exec('CREATE TABLE unrelated (a TEXT)')
    db.close()
    // An unreadable archive state must never hide sessions.
    expect(loadWorkBuddySession(noTable.filePath).kind).toBe('parsed')
  })

  it('ignores an archived row that belongs to another session', () => {
    const { filePath, snapshotPath } = layout('66666666-6666-4666-8666-666666666666')
    writeDb(workBuddyDatabasePath(filePath), [
      { id: '77777777-7777-4777-8777-777777777777', status: 'archived' },
    ])
    writeSnapshot(snapshotPath, ME)
    expect(loadWorkBuddySession(filePath).kind).toBe('parsed')
  })

  it('reports a revision spanning both the database and the account snapshot', () => {
    const { filePath, dbPath, snapshotPath } = layout('88888888-8888-4888-8888-888888888888')
    writeDb(dbPath, [{ id: '88888888-8888-4888-8888-888888888888', status: 'completed' }])
    writeSnapshot(snapshotPath, ME)
    expect(workBuddyAccountSnapshotPath(filePath)).toBe(snapshotPath)
    expect(workBuddyArchiveMtime(filePath)).toBe(
      `${statSync(dbPath).mtimeMs}::${statSync(snapshotPath).mtimeMs}`,
    )
  })
})
