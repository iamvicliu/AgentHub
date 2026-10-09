import { describe, expect, it } from 'vite-plus/test'

import { SORTED_SESSION_SOURCES, getSessionSourceLabel } from './sessionSources.js'

describe('settings source order', () => {
  it('sorts all Agent names alphabetically, including OpenClaw before OpenCode', () => {
    expect(SORTED_SESSION_SOURCES.map(getSessionSourceLabel)).toEqual([
      'Claude Code',
      'Codex CLI',
      'Cursor',
      // DeepSeek Harness sorts under D, between Codex CLI and Gemini CLI.
      'DeepSeek Harness',
      'Gemini CLI',
      'Hermes',
      'OpenClaw',
      'OpenCode',
      'Pi',
      'WorkBuddy',
    ])
  })
})
