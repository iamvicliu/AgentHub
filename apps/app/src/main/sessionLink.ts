import { createHash } from 'node:crypto'

import type { Message } from '@spool-lab/core'

import { parseSessionLink } from '../shared/sessionLink.js'

type LocatorMessage = Pick<Message, 'id' | 'msgUuid' | 'seq' | 'role' | 'timestamp' | 'contentText'>

export function messageFingerprint(
  message: Pick<LocatorMessage, 'role' | 'timestamp' | 'contentText'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([message.role, message.timestamp, message.contentText]))
    .digest('hex')
}

export function resolveSessionMessage(raw: string, messages: LocatorMessage[]): number | undefined {
  const link = parseSessionLink(raw)
  if (link.messageUuid === undefined && link.seq === undefined) return undefined
  const candidates = messages.filter((message) =>
    link.messageUuid !== undefined
      ? message.msgUuid === link.messageUuid
      : message.seq === link.seq,
  )
  if (candidates.length !== 1)
    throw new Error('找不到指定消息，或消息标识不唯一。请重新同步并搜索。')
  const message = candidates[0]!
  if (link.fingerprint && messageFingerprint(message) !== link.fingerprint)
    throw new Error('消息内容或位置已变化，请重新搜索。未跳转到其他消息。')
  return message.id
}
