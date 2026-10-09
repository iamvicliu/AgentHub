import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { DB_FILE_NAME, DEFAULT_DATA_DIR } from './data-dir.js'

describe('AgentHub data location', () => {
  it('keeps its index in ~/.agenthub/agenthub.db, separate from Spool', () => {
    expect(DEFAULT_DATA_DIR).toBe(join(homedir(), '.agenthub'))
    expect(DB_FILE_NAME).toBe('agenthub.db')
  })
})
