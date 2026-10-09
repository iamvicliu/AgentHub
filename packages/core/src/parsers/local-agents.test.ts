import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { openDatabase } from '../db/native-binding.js'
import { isSessionFileForSource } from '../sync/source-paths.js'
import {
  listLocalAgentSessions,
  loadLocalAgentSession,
  normalizeLocalAgentWatchPath,
} from './local-agents.js'
import { loadPiSession } from './pi.js'

function fixture(name: string, records: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), 'spool-local-agents-'))
  const path = join(root, name)
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  return path
}

describe('local agent sources', () => {
  it('reads Hermes JSONL users, assistant tool calls and model without tool output', () => {
    const path = fixture('sample.jsonl', [
      { role: 'session_meta', model: 'test-model', timestamp: '2026-10-06T00:00:00Z' },
      { role: 'user', content: 'Find the fixture', timestamp: '2026-10-06T00:00:01Z' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'read_file' } }],
        timestamp: '2026-10-06T00:00:02Z',
      },
      { role: 'tool', content: 'tool result' },
    ])
    const result = loadLocalAgentSession(path, 'hermes')
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') throw new Error('Expected transcript')
    expect(result.session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.session.messages[1]!.toolNames).toEqual(['read_file'])
    expect(result.session.model).toBe('test-model')
  })

  it('reads Hermes SQLite read-only and omits archived and inactive messages', () => {
    const root = mkdtempSync(join(tmpdir(), 'spool-hermes-db-'))
    const path = join(root, 'state.db')
    const db = openDatabase(path)
    db.exec(`CREATE TABLE sessions(id TEXT, title TEXT, cwd TEXT, model TEXT, started_at REAL, archived INTEGER);
      CREATE TABLE messages(id INTEGER, session_id TEXT, role TEXT, content TEXT, timestamp REAL, active INTEGER);
      INSERT INTO sessions VALUES('one', 'Named fixture', '/tmp/fixture', 'fixture-model', 1791244800, 0), ('hidden', 'archived', '', '', 1, 1);
      INSERT INTO messages VALUES(1, 'one', 'user', 'visible request', 1791244801, 1), (2, 'one', 'user', 'rewound request', 1791244802, 0), (3, 'one', 'assistant', 'reply', 1791244803, 1);`)
    db.close()
    const paths = listLocalAgentSessions(path, 'hermes')
    expect(paths).toHaveLength(1)
    const result = loadLocalAgentSession(paths[0]!, 'hermes')
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') throw new Error('Expected session')
    expect(result.session.title).toBe('Named fixture')
    expect(result.session.messages).toHaveLength(2)
    expect(result.session.messages[0]!.timestamp).toBe('2026-10-06T00:00:01.000Z')
    const verify = openDatabase(path, { readonly: true })
    expect(verify.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 3 })
    verify.close()
    mkdirSync(join(root, 'sessions'))
    const mirror = join(root, 'sessions', 'one.jsonl')
    writeFileSync(mirror, JSON.stringify({ role: 'user', content: 'old mirror' }) + '\n')
    expect(loadLocalAgentSession(mirror, 'hermes').kind).toBe('skipped')
  })

  it('reads OpenClaw legacy JSONL and SQLite transcript events', () => {
    const events = [
      { type: 'session', id: 'one', cwd: '/tmp/fixture', timestamp: '2026-10-06T00:00:00Z' },
      {
        type: 'message',
        id: 'u',
        timestamp: '2026-10-06T00:00:01Z',
        message: { role: 'user', content: [{ type: 'text', text: 'request' }] },
      },
      {
        type: 'message',
        id: 'a',
        timestamp: '2026-10-06T00:00:02Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
          model: 'test-model',
        },
      },
      { type: 'session_info', name: 'OpenClaw fixture' },
    ]
    const file = fixture('one.jsonl', events)
    const legacy = loadLocalAgentSession(file, 'openclaw')
    expect(legacy.kind).toBe('parsed')
    const path = join(join(file, '..'), 'openclaw-agent.sqlite')
    const db = openDatabase(path)
    db.exec(
      'CREATE TABLE session_windows(session_id TEXT, display_name TEXT, created_at INTEGER); CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT);',
    )
    db.prepare('INSERT INTO session_windows VALUES (?, ?, ?)').run(
      'one',
      'OpenClaw fixture',
      1791244800000,
    )
    for (const [seq, event] of events.entries())
      db.prepare('INSERT INTO transcript_events VALUES (?, ?, ?)').run(
        'one',
        seq,
        JSON.stringify(event),
      )
    db.exec(
      'CREATE TABLE session_transcript_active_events(session_id TEXT, active_position INTEGER, event_seq INTEGER)',
    )
    for (const seq of events.keys())
      db.prepare('INSERT INTO session_transcript_active_events VALUES (?, ?, ?)').run(
        'one',
        seq,
        seq,
      )
    db.prepare('INSERT INTO transcript_events VALUES (?, ?, ?)').run(
      'one',
      99,
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'inactive branch' } }),
    )
    db.close()
    const result = loadLocalAgentSession(listLocalAgentSessions(path, 'openclaw')[0]!, 'openclaw')
    if (result.kind !== 'parsed' || legacy.kind !== 'parsed') throw new Error('Expected sessions')
    expect(result.session.messages).toEqual(legacy.session.messages)
    expect(result.session.title).toBe('OpenClaw fixture')
    expect(normalizeLocalAgentWatchPath(`${path}-wal`)).toBe(path)
  })

  it('validates Pi roles, model changes, tool names and source layout', () => {
    const file = fixture('test_one.jsonl', [
      { type: 'session', id: 'one', cwd: '/tmp/fixture', timestamp: '2026-10-06T00:00:00Z' },
      { type: 'model_change', modelId: 'fixture-model' },
      {
        type: 'message',
        id: 'u',
        message: { role: 'user', content: 'request' },
        timestamp: '2026-10-06T00:00:01Z',
      },
      {
        type: 'message',
        id: 'a',
        message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read' }] },
        timestamp: '2026-10-06T00:00:02Z',
      },
      { type: 'message', id: 't', message: { role: 'toolResult', content: 'result' } },
      { type: 'session_info', name: 'Named Pi fixture' },
    ])
    const result = loadPiSession(file)
    if (result.kind !== 'parsed') throw new Error('Expected Pi session')
    expect(result.session.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.session.messages[1]!.toolNames).toEqual(['read'])
    expect(result.session.model).toBe('fixture-model')
    expect(result.session.title).toBe('Named Pi fixture')
    expect(isSessionFileForSource('pi', '/tmp/root/project/test_one.jsonl', '/tmp/root')).toBe(true)
    expect(
      isSessionFileForSource('pi', '/tmp/root/project/subagent/test_one.jsonl', '/tmp/root'),
    ).toBe(false)
  })
})
