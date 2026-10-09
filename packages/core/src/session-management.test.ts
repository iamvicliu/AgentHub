import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const dirs: string[] = []
const dbs: Array<{ close(): void }> = []
afterEach(() => {
  dbs.splice(0).forEach((db) => db.close())
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function setup(source: 'claude' | 'codex' | 'gemini' = 'codex') {
  const base = mkdtempSync(join(tmpdir(), 'spool-manage-'))
  dirs.push(base)
  const root = join(base, source)
  const project = join(root, 'project', ...(source === 'gemini' ? ['chats'] : []))
  mkdirSync(project, { recursive: true })
  for (const provider of [
    'CLAUDE',
    'CODEX',
    'GEMINI',
    'OPENCODE',
    'PI',
    'HERMES',
    'OPENCLAW',
    'WORKBUDDY',
    'DSH',
    'CURSOR',
  ]) {
    vi.stubEnv(
      `SPOOL_${provider}_DIR`,
      provider.toLowerCase() === source ? root : join(base, provider),
    )
  }
  vi.stubEnv('SPOOL_DATA_DIR', join(base, 'data'))
  vi.resetModules()
  const { getDB } = await import('./db/db.js')
  const { Syncer } = await import('./sync/syncer.js')
  const management = await import('./session-management.js')
  const db = getDB()
  dbs.push(db)
  const fixture =
    source === 'claude'
      ? 'claude-projects/test-project/test-session-001.jsonl'
      : 'codex-sessions/2026/01/17/rollout-2026-01-17T12-34-56-11111111-2222-4333-8444-555555555555.jsonl'
  const path = join(project, source === 'gemini' ? 'session-short.json' : 'session.jsonl')
  if (source === 'gemini') {
    writeFileSync(
      path,
      JSON.stringify({
        sessionId: 'gemini-management-fixture',
        startTime: '2026-10-06T00:00:00Z',
        messages: [
          {
            id: 'm1',
            type: 'user',
            content: 'Gemini test message',
            timestamp: '2026-10-06T00:00:00Z',
          },
        ],
      }),
    )
  } else cpSync(resolve(import.meta.dirname, '../../../apps/app/e2e/fixtures', fixture), path)
  const syncer = new Syncer(db)
  expect(syncer.syncFile(path, source)).toBe('added')
  const { uuid } = db.prepare('SELECT session_uuid AS uuid FROM sessions').get() as { uuid: string }
  return { ...management, db, syncer, base, path, root, project, uuid }
}

describe('session management', () => {
  it('renames both title and search document and survives a full resync', async () => {
    const { db, syncer, path, uuid, renameIndexedSession } = await setup()
    renameIndexedSession(db, uuid, '  Personal title  ')
    syncer.syncFile(path, 'codex', 'rewrite')
    expect(db.prepare('SELECT title, title_source FROM sessions').get()).toEqual({
      title: 'Personal title',
      title_source: 'user',
    })
    expect(db.prepare('SELECT title FROM session_search').get()).toEqual({
      title: 'Personal title',
    })
    expect(() => renameIndexedSession(db, uuid, '')).toThrow()
    expect(() => renameIndexedSession(db, uuid, 'a\nb')).toThrow()
    expect(() => renameIndexedSession(db, uuid, 'x'.repeat(201))).toThrow()
    expect(() => renameIndexedSession(db, 'missing', 'Name')).toThrow('Session not found')
  })

  it('keeps a Claude rename through appends, full resync and forced rewrite', async () => {
    const { db, syncer, path, uuid, renameIndexedSession } = await setup('claude')
    renameIndexedSession(db, uuid, '我的名字')
    const line = JSON.stringify({
      type: 'user',
      sessionId: uuid,
      uuid: 'msg-appended',
      timestamp: '2026-01-15T11:00:00Z',
      message: { role: 'user', content: 'APPENDED_RENAME_CANARY' },
    })
    writeFileSync(path, `${readFileSync(path, 'utf8').trimEnd()}\n${line}\n`)
    syncer.syncFile(path, 'claude')
    syncer.syncAll()
    syncer.syncFile(path, 'claude', undefined, undefined, { forceMode: 'rewrite' })
    expect(db.prepare('SELECT title, title_source FROM sessions').get()).toEqual({
      title: '我的名字',
      title_source: 'user',
    })
    expect(db.prepare('SELECT title, user_text FROM session_search').get()).toMatchObject({
      title: '我的名字',
      user_text: expect.stringContaining('APPENDED_RENAME_CANARY'),
    })
  })

  it.each(['claude', 'codex', 'gemini'] as const)(
    'deletes all %s fragments and cascades index, messages and pins',
    async (source) => {
      const {
        db,
        base,
        path,
        project,
        uuid,
        sessionDeletionFiles,
        deleteSessionWithTranscripts,
        syncer,
      } = await setup(source)
      const second = join(
        project,
        source === 'gemini' ? 'session-other-short.json' : `other-${uuid}.jsonl`,
      )
      cpSync(path, second)
      const paths = sessionDeletionFiles(db, uuid)
      expect(paths).toEqual([second, path].map((file) => realpathSync(file)).sort())
      db.prepare('INSERT INTO pins (session_uuid) VALUES (?)').run(uuid)
      const trash = join(base, 'trash')
      mkdirSync(trash)
      let index = 0
      await deleteSessionWithTranscripts(db, uuid, paths, async (file) =>
        renameSync(file, join(trash, String(index++))),
      )
      for (const table of ['sessions', 'messages', 'session_search', 'pins']) {
        expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0)
      }
      syncer.syncAll()
      expect((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0)
    },
  )

  it('trashes the Claude session folder and per-session sidecars as whole units', async () => {
    const base = mkdtempSync(join(tmpdir(), 'spool-manage-'))
    dirs.push(base)
    const config = join(base, '.claude')
    const root = join(config, 'projects')
    const project = join(root, '-Users-me-proj')
    const uuid = '11111111-2222-4333-8444-555555555555'
    mkdirSync(join(project, uuid, 'subagents'), { recursive: true })
    mkdirSync(join(project, uuid, 'tool-results'))
    const fixture = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../apps/app/e2e/fixtures/claude-projects/test-project/test-session-001.jsonl',
      ),
      'utf8',
    ).replaceAll('test-session-uuid-001', uuid)
    const main = join(project, `${uuid}.jsonl`)
    writeFileSync(main, fixture)
    writeFileSync(join(project, uuid, 'subagents', 'agent-a1.jsonl'), fixture)
    writeFileSync(join(project, uuid, 'subagents', 'agent-a1.meta.json'), '{}')
    writeFileSync(join(project, uuid, 'tool-results', 'out.txt'), 'secret')
    writeFileSync(join(project, `${uuid}.jsonl.bak`), fixture)
    for (const name of ['file-history', 'session-env']) {
      mkdirSync(join(config, name, uuid), { recursive: true })
      writeFileSync(join(config, name, uuid, 'x'), 'x')
    }
    mkdirSync(join(config, 'file-history', 'other-session'))
    for (const provider of [
      'CODEX',
      'GEMINI',
      'OPENCODE',
      'PI',
      'HERMES',
      'OPENCLAW',
      'WORKBUDDY',
      'DSH',
      'CURSOR',
    ])
      vi.stubEnv(`SPOOL_${provider}_DIR`, join(base, provider))
    vi.stubEnv('SPOOL_CLAUDE_DIR', root)
    vi.stubEnv('SPOOL_DATA_DIR', join(base, 'data'))
    vi.resetModules()
    const { getDB } = await import('./db/db.js')
    const { Syncer } = await import('./sync/syncer.js')
    const { sessionDeletionFiles, deleteSessionWithTranscripts } =
      await import('./session-management.js')
    const db = getDB()
    dbs.push(db)
    const syncer = new Syncer(db)
    syncer.syncAll()
    const real = realpathSync(config)
    expect(sessionDeletionFiles(db, uuid)).toEqual(
      [
        join(real, 'file-history', uuid),
        join(real, 'projects', '-Users-me-proj', uuid),
        join(real, 'projects', '-Users-me-proj', `${uuid}.jsonl`),
        join(real, 'session-env', uuid),
      ].sort(),
    )

    mkdirSync(join(config, 'sessions'))
    writeFileSync(
      join(config, 'sessions', '1.json'),
      JSON.stringify({ pid: 999999999, sessionId: uuid }),
    )
    expect(() => sessionDeletionFiles(db, uuid)).not.toThrow()
    writeFileSync(
      join(config, 'sessions', '2.json'),
      JSON.stringify({ pid: process.pid, sessionId: uuid }),
    )
    expect(() => sessionDeletionFiles(db, uuid)).toThrow(
      expect.objectContaining({
        reason: 'running',
        detail: { pid: process.pid, source: 'claude' },
      }),
    )
    rmSync(join(config, 'sessions'), { recursive: true })

    const trash = join(base, 'trash')
    mkdirSync(trash)
    let index = 0
    await deleteSessionWithTranscripts(db, uuid, sessionDeletionFiles(db, uuid), async (file) =>
      renameSync(file, join(trash, String(index++))),
    )
    expect(readdirSync(project)).toEqual([`${uuid}.jsonl.bak`])
    expect(readdirSync(join(config, 'file-history'))).toEqual(['other-session'])
    expect(readdirSync(join(config, 'session-env'))).toEqual([])
    syncer.syncAll()
    expect((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBe(0)
  })

  it('preserves the index and reports partial progress if trash fails', async () => {
    const { db, path, uuid, deleteSessionWithTranscripts } = await setup()
    const trash = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'))
    await expect(
      deleteSessionWithTranscripts(db, uuid, [path, 'second'], trash),
    ).rejects.toMatchObject({
      name: 'SessionDeletionPartialError',
      moved: 1,
    })
    expect(db.prepare('SELECT session_uuid FROM sessions').get()).toBeTruthy()
  })

  it('includes both migrated Gemini JSONL and its legacy JSON record', async () => {
    const { path, db, uuid, sessionDeletionFiles } = await setup('gemini')
    cpSync(path, `${path}l`)
    expect(sessionDeletionFiles(db, uuid)).toEqual(
      [realpathSync(path), realpathSync(`${path}l`)].sort(),
    )
  })

  it('allows cleaning stale indexes only when the source root is available', async () => {
    const { path, db, uuid, sessionDeletionFiles } = await setup()
    rmSync(path)
    expect(sessionDeletionFiles(db, uuid)).toEqual([])
    vi.stubEnv('SPOOL_CODEX_DIR', '/nonexistent-spool-fixture-root')
    expect(() => sessionDeletionFiles(db, uuid)).toThrow('unavailable')
  })

  it('rejects outside-root and symlink transcripts', async () => {
    const { db, base, path, uuid, sessionDeletionFiles } = await setup()
    const outside = join(base, 'outside.jsonl')
    cpSync(path, outside)
    db.prepare('UPDATE sessions SET file_path = ?').run(outside)
    expect(() => sessionDeletionFiles(db, uuid)).toThrow('outside configured')
    const link = `${path}.link`
    symlinkSync(path, link)
    db.prepare('UPDATE sessions SET file_path = ?').run(link)
    expect(() => sessionDeletionFiles(db, uuid)).toThrow('regular transcript')
  })

  it('will not delete a shared OpenCode database or clean an unavailable root', async () => {
    const { db, uuid, sessionDeletionFiles } = await setup()
    vi.stubEnv('SPOOL_CODEX_DIR', '/nonexistent-spool-fixture-root')
    expect(() => sessionDeletionFiles(db, uuid)).toThrow('outside configured')
    db.prepare(
      "UPDATE sessions SET source_id = (SELECT id FROM sources WHERE name = 'opencode')",
    ).run()
    expect(() => sessionDeletionFiles(db, uuid)).toThrow(
      expect.objectContaining({ reason: 'shared-database' }),
    )
  })
  async function setupHermes() {
    const base = mkdtempSync(join(tmpdir(), 'spool-manage-hermes-'))
    dirs.push(base)
    for (const provider of [
      'CLAUDE',
      'CODEX',
      'GEMINI',
      'OPENCODE',
      'PI',
      'OPENCLAW',
      'WORKBUDDY',
      'DSH',
      'CURSOR',
    ])
      vi.stubEnv(`SPOOL_${provider}_DIR`, join(base, provider))
    vi.stubEnv('SPOOL_HERMES_DIR', base)
    vi.stubEnv('SPOOL_DATA_DIR', join(base, 'data'))
    vi.resetModules()
    const store = new Database(join(base, 'state.db'))
    dbs.push(store)
    store.exec(`CREATE TABLE sessions(id TEXT, title TEXT, cwd TEXT, model TEXT, started_at REAL, archived INTEGER);
      CREATE TABLE messages(id INTEGER, session_id TEXT, role TEXT, content TEXT, timestamp REAL, active INTEGER);
      INSERT INTO sessions VALUES('root', 'Hermes root', '/tmp', 'm', 1791244800, 0), ('child', 'Hermes delegate', '/tmp', 'm', 1791244801, 0), ('keep', 'Hermes keep', '/tmp', 'm', 1791244802, 0);
      INSERT INTO messages VALUES(1, 'root', 'user', 'root message', 1791244800, 1), (2, 'child', 'user', 'child message', 1791244801, 1), (3, 'keep', 'user', 'keep message', 1791244802, 1);`)
    const { getDB } = await import('./db/db.js')
    const { Syncer } = await import('./sync/syncer.js')
    const management = await import('./session-management.js')
    const db = getDB()
    dbs.push(db)
    expect(new Syncer(db).syncAll()).toMatchObject({ added: 3, errors: 0 })
    return { base, store, db, Syncer, ...management }
  }

  const indexed = (db: { prepare(sql: string): { all(): unknown[] } }) =>
    (
      db.prepare('SELECT session_uuid AS uuid FROM sessions ORDER BY session_uuid').all() as {
        uuid: string
      }[]
    ).map((r) => r.uuid)

  it('deletes a Hermes session through the CLI and drops cascaded delegates from the index', async () => {
    const { base, store, db, deleteHermesSession, sessionDeletionFiles } = await setupHermes()
    expect(() => sessionDeletionFiles(db, 'hermes:root')).toThrow(
      expect.objectContaining({ reason: 'unsupported' }),
    )
    const run = vi.fn(async (target: { sessionId: string; hermesHome: string }) => {
      store.exec(`DELETE FROM sessions WHERE id IN ('${target.sessionId}', 'child')`)
      return { code: 0, output: `Deleted session '${target.sessionId}'.` }
    })
    await deleteHermesSession(db, 'hermes:root', run)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'root', hermesHome: realpathSync(base) }),
    )
    expect(indexed(db)).toEqual(['hermes:keep'])
  })

  it('keeps the Hermes index when the CLI refuses an active session or fails', async () => {
    const { db, deleteHermesSession } = await setupHermes()
    await expect(
      deleteHermesSession(db, 'hermes:root', async () => ({
        code: 1,
        output:
          "Cannot delete active session: session 'root' (or a delegate child) has an active turn lease",
      })),
    ).rejects.toMatchObject({ reason: 'running', detail: { source: 'hermes' } })
    await expect(
      deleteHermesSession(db, 'hermes:root', async () => ({
        code: 127,
        output: 'hermes: not found',
      })),
    ).rejects.toThrow('Hermes did not delete the session')
    expect(indexed(db)).toEqual(['hermes:child', 'hermes:keep', 'hermes:root'])
  })

  it('refuses a Hermes store outside the configured home and still blocks OpenClaw', async () => {
    const { db, deleteHermesSession, sessionDeletionFiles } = await setupHermes()
    vi.stubEnv('SPOOL_HERMES_DIR', '/nonexistent-spool-hermes-home')
    const run = vi.fn()
    await expect(deleteHermesSession(db, 'hermes:root', run)).rejects.toMatchObject({
      reason: 'unsafe-path',
    })
    expect(run).not.toHaveBeenCalled()
    db.prepare(
      "UPDATE sessions SET source_id = (SELECT id FROM sources WHERE name = 'openclaw') WHERE session_uuid = 'hermes:keep'",
    ).run()
    expect(() => sessionDeletionFiles(db, 'hermes:keep')).toThrow(
      expect.objectContaining({ reason: 'unsupported', detail: { source: 'openclaw' } }),
    )
    // Cursor lists chats from its own state store, so trashing the transcript
    // alone is refused too.
    db.prepare(
      "UPDATE sessions SET source_id = (SELECT id FROM sources WHERE name = 'cursor') WHERE session_uuid = 'hermes:keep'",
    ).run()
    expect(() => sessionDeletionFiles(db, 'hermes:keep')).toThrow(
      expect.objectContaining({ reason: 'unsupported', detail: { source: 'cursor' } }),
    )
  })
  it('renames a Hermes session in Hermes and keeps the index following the stored title', async () => {
    const { store, db, renameHermesSession, Syncer } = await setupHermes()
    const run = vi.fn(async (target: { sessionId: string }, title: string) => {
      store
        .prepare('UPDATE sessions SET title = ? WHERE id = ?')
        .run(title.replace(/\s+/g, ' '), target.sessionId)
      return { code: 0, output: `Session '${target.sessionId}' renamed to: ${title}` }
    })
    expect(await renameHermesSession(db, 'hermes:root', '  New   name ', run)).toBe('New name')
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'root' }), 'New   name')
    const row = () =>
      db
        .prepare(
          "SELECT title, title_source AS source FROM sessions WHERE session_uuid = 'hermes:root'",
        )
        .get()
    expect(row()).toEqual({ title: 'New name', source: 'derived' })
    store.prepare("UPDATE sessions SET title = 'Renamed in Hermes' WHERE id = 'root'").run()
    new Syncer(db).syncAll()
    expect(row()).toEqual({ title: 'Renamed in Hermes', source: 'derived' })
  })

  it('keeps the old Hermes title when the CLI rejects a rename', async () => {
    const { db, renameHermesSession } = await setupHermes()
    await expect(
      renameHermesSession(db, 'hermes:root', 'Hermes keep', async () => ({
        code: 1,
        output: "Error: Title 'Hermes keep' is already in use by session keep",
      })),
    ).rejects.toThrow("Title 'Hermes keep' is already in use")
    expect(
      db.prepare("SELECT title FROM sessions WHERE session_uuid = 'hermes:root'").get(),
    ).toEqual({ title: 'Hermes root' })
  })
  it('renames a Codex thread through Codex and indexes the name Codex stored', async () => {
    const { db, uuid, renameCodexSession } = await setup('codex')
    const setName = vi.fn(async () => {})
    expect(await renameCodexSession(db, uuid, '  Codex title ', setName)).toBe('Codex title')
    expect(setName).toHaveBeenCalledWith(uuid, 'Codex title')
    expect(
      db
        .prepare('SELECT title, title_source AS source FROM sessions WHERE session_uuid = ?')
        .get(uuid),
    ).toEqual({
      title: 'Codex title',
      source: 'derived',
    })
    await expect(
      renameCodexSession(db, uuid, 'Rejected', async () => {
        throw new Error('thread not found')
      }),
    ).rejects.toThrow('thread not found')
    expect(db.prepare('SELECT title FROM sessions WHERE session_uuid = ?').get(uuid)).toEqual({
      title: 'Codex title',
    })
  })
})
