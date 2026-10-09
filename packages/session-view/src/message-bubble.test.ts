import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import MessageBubble from './message-bubble.js'

describe('message roles', () => {
  it.each([false, true])('uses one visual system and explicit labels (dark=%s)', (isDark) => {
    const message = {
      id: 1,
      parentUuid: null,
      role: 'user' as const,
      contentText: 'Hello',
      timestamp: '2026-10-06T10:00:00Z',
      isSidechain: false,
      toolNames: [],
    }
    const user = renderToStaticMarkup(
      createElement(MessageBubble, { message, isDark, userLabel: '我', agentLabel: 'Agent' }),
    )
    const agent = renderToStaticMarkup(
      createElement(MessageBubble, { message: { ...message, role: 'assistant' }, isDark }),
    )
    expect(user).toContain('data-message-role="user"')
    expect(user).toContain('border-l-accent')
    expect(user).toContain('我')
    expect(agent).toContain('data-message-role="assistant"')
    expect(agent).toContain('Agent')
    expect(agent).not.toContain('border-l-accent')
    expect(user).toContain('dark:bg-dark-surface')
    expect(user).not.toContain('neutral-')
  })
})
