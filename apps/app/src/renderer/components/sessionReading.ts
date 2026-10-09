import type { Message } from '@spool-lab/core'

type ReadingMessage = Pick<Message, 'id' | 'role' | 'isSidechain' | 'contentText'>

export function isInternalMessage(message: ReadingMessage): boolean {
  return message.role === 'system' || message.isSidechain
}

export function projectReadingMessages<T extends ReadingMessage>(
  messages: T[],
  onlyUser: boolean,
  showInternal: boolean,
): T[] {
  return messages.filter((message) =>
    isInternalMessage(message) ? showInternal : !onlyUser || message.role === 'user',
  )
}

export function userMessageDirectory(messages: ReadingMessage[]) {
  return messages
    .filter((message) => message.role === 'user' && !isInternalMessage(message))
    .map((message, index) => ({
      id: message.id,
      number: index + 1,
      preview: message.contentText.replace(/\s+/g, ' ').trim().slice(0, 160),
    }))
}
