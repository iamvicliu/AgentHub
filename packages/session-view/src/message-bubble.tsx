import { UserRound, Bot } from 'lucide-react'
import { memo } from 'react'

import type { Range as FindRange } from './find-highlight-plugin.js'
import MarkdownContent from './markdown-content.js'
import type { ConversationMessage } from './types.js'

export type { FindRange }

interface Props {
  message: ConversationMessage
  isDark: boolean
  showAvatar?: boolean
  userLabel?: string | undefined
  agentLabel?: string | undefined
  findRanges?: ReadonlyArray<FindRange>
  matchIndexOffset?: number
  activeMatchIndex?: number
  onActiveMatchRef?: ((node: HTMLElement | null) => void) | undefined
}

function MessageBubble({
  message,
  isDark,
  showAvatar = true,
  userLabel = 'You',
  agentLabel = 'Agent',
  findRanges = [],
  matchIndexOffset = 0,
  activeMatchIndex = -1,
  onActiveMatchRef,
}: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isToolUseOnly = message.toolNames.length > 0 && !message.contentText
  const contentText = message.contentText || (isSystem ? '(summary)' : '')

  const markdownProps = {
    text: contentText,
    isDark,
    findRanges,
    matchIndexOffset,
    activeMatchIndex,
    ...(onActiveMatchRef ? { onActiveMatchRef } : {}),
  }

  if (isSystem) {
    return (
      <div className="px-6 py-2">
        <div className="bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted rounded-md px-4 py-3 text-xs italic">
          <MarkdownContent {...markdownProps} />
        </div>
      </div>
    )
  }

  if (isToolUseOnly) {
    return (
      <div
        data-message-role={message.role}
        className="text-warm-muted dark:text-dark-muted flex items-center gap-2 px-10 py-2"
      >
        {showAvatar ? (
          <span className="inline-flex flex-none items-center gap-2 text-xs font-semibold">
            <Bot size={16} aria-hidden />
            {agentLabel}
          </span>
        ) : (
          <div className="h-5 w-5 flex-none" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px]">
          {message.toolNames.map((name) => (
            <span
              key={name}
              className="bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted rounded px-2 py-1 font-mono"
            >
              {name}
            </span>
          ))}
          <span className="font-mono">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-3" data-message-role={message.role}>
      <div
        className={`rounded-lg px-4 py-3 ${isUser ? 'border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface border-l-accent dark:border-l-accent-dark border border-l-[3px]' : ''}`}
      >
        <div
          className={`mb-2 flex items-center gap-2 text-xs font-semibold ${isUser ? 'text-accent dark:text-accent-dark' : 'text-warm-muted dark:text-dark-muted'}`}
        >
          {isUser ? <UserRound size={16} aria-hidden /> : <Bot size={16} aria-hidden />}
          <span>{isUser ? userLabel : agentLabel}</span>
          <time
            className="text-warm-faint dark:text-dark-muted ml-auto font-mono text-[10px] font-normal"
            dateTime={message.timestamp}
          >
            {formatTime(message.timestamp)}
          </time>
        </div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {message.toolNames.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {message.toolNames.map((name) => (
                  <span
                    key={name}
                    className="bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted rounded px-2 py-1 font-mono text-[10px]"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <MarkdownContent {...markdownProps} />
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    // Respect the host page's UI language (set on <html lang>) instead of
    // inheriting the OS region setting — otherwise an English OS produces
    // "10:35:02 PM" even when the surrounding UI is in Chinese.
    const locale =
      typeof document !== 'undefined' && document.documentElement.lang
        ? document.documentElement.lang
        : undefined
    return new Date(iso).toLocaleTimeString(locale)
  } catch {
    return ''
  }
}

export default memo(MessageBubble)
