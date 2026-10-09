import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const dirs: string[] = []
const dbs: Array<{ close(): void }> = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('deleted session reconciliation', () => {
  it.each(['claude', 'codex'] as const)(
    'removes missing %s files but preserves sessions when the root is unavailable',
    async (source) => {
      const base = mkdtempSync(join(tmpdir(), 'spool-deleted-'))
      dirs.push(base)
      const root = join(base, source, source === 'claude' ? 'projects' : 'sessions')
      const project = join(root, 'test-project')
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
      const fixture =
        source === 'claude'
          ? 'claude-projects/test-project/test-session-001.jsonl'
          : 'codex-sessions/2026/01/17/rollout-2026-01-17T12-34-56-11111111-2222-4333-8444-555555555555.jsonl'
      const path = join(project, 'session.jsonl')
      cpSync(resolve(import.meta.dirname, '../../../../apps/app/e2e/fixtures', fixture), path)
      vi.resetModules()
      const { getDB } = await import('../db/db.js')
      const { Syncer } = await import('./syncer.js')
      const db = getDB()
      dbs.push(db)
      const syncer = new Syncer(db)
      expect(syncer.syncFile(path, source)).toBe('added')
      syncer.syncAll()
      const count = () =>
        (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n
      expect(count()).toBe(1)
      db.prepare('INSERT INTO pins (session_uuid) SELECT session_uuid FROM sessions').run()
      rmSync(path)
      vi.stubEnv(`SPOOL_${source.toUpperCase()}_DIR`, join(base, 'unavailable'))
      syncer.syncAll()
      expect(count()).toBe(1)
      vi.stubEnv(`SPOOL_${source.toUpperCase()}_DIR`, root)
      syncer.syncAll()
      expect(count()).toBe(0)
      expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(0)
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM session_search').get() as { n: number }).n,
      ).toBe(0)
      expect((db.prepare('SELECT COUNT(*) AS n FROM pins').get() as { n: number }).n).toBe(0)
    },
  )
})
