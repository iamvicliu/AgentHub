import { describe, expect, it } from 'vite-plus/test'

import { projectReadingMessages, userMessageDirectory } from './sessionReading.js'

const messages = [
  { id: 1, role: 'system' as const, isSidechain: false, contentText: 'instructions' },
  {
    id: 2,
    role: 'user' as const,
    isSidechain: false,
    contentText: 'Discuss system prompts\n please',
  },
  { id: 3, role: 'assistant' as const, isSidechain: false, contentText: 'Tool results' },
  { id: 4, role: 'user' as const, isSidechain: true, contentText: 'Subagent task' },
  { id: 5, role: 'assistant' as const, isSidechain: true, contentText: 'Subagent result' },
]

describe('session reading projection', () => {
  it('hides only explicitly marked internal records, not normal text or tool results', () => {
    expect(projectReadingMessages(messages, false, false).map((m) => m.id)).toEqual([2, 3])
    expect(messages).toHaveLength(5)
  })
  it('combines user-only and internal filters without losing source records', () => {
    expect(projectReadingMessages(messages, true, false).map((m) => m.id)).toEqual([2])
    expect(projectReadingMessages(messages, true, true).map((m) => m.id)).toEqual([1, 2, 4, 5])
    expect(projectReadingMessages(messages, false, true)).toEqual(messages)
  })
  it('does not present subagent instructions as my messages in the directory', () => {
    expect(userMessageDirectory(messages).map((entry) => entry.id)).toEqual([2])
  })
  it('builds numbered user anchors with normalized bounded previews', () => {
    expect(userMessageDirectory(projectReadingMessages(messages, false, false))).toEqual([
      { id: 2, number: 1, preview: 'Discuss system prompts please' },
    ])
    expect(userMessageDirectory([])).toEqual([])
    expect(
      userMessageDirectory([{ ...messages[1]!, contentText: 'a'.repeat(300) }])[0]?.preview,
    ).toHaveLength(160)
  })
})
