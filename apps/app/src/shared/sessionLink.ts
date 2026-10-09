export interface SessionLink {
  sessionUuid: string
  messageUuid?: string
  seq?: number
  fingerprint?: string
}

export type SessionLinkResult =
  | { ok: true; sessionUuid: string; messageId?: number }
  | { ok: false; error: string }

function identifier(value: string): string {
  if (!value || value.length > 512 || /[\x00-\x1f\x7f/\\]/u.test(value))
    throw new Error('会话链接的标识无效。')
  return value
}

/** v1 local viewer protocol. Never accepts paths, commands or database row IDs. */
export function parseSessionLink(raw: string): SessionLink {
  if (raw.length > 4096) throw new Error('会话链接过长。')
  const url = new URL(raw)
  if (
    url.protocol !== 'agenthub:' ||
    url.hostname !== 'session' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('会话链接格式无效。')
  if (!/^\/[^/]+$/u.test(url.pathname)) throw new Error('会话链接缺少会话标识。')
  const sessionUuid = identifier(decodeURIComponent(url.pathname.slice(1)))
  for (const key of url.searchParams.keys()) {
    if (
      !['message', 'seq', 'fingerprint'].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      throw new Error('会话链接参数无效。')
  }
  const message = url.searchParams.get('message')
  const seqRaw = url.searchParams.get('seq')
  const fingerprint = url.searchParams.get('fingerprint')
  if (fingerprint !== null && !/^[a-f0-9]{64}$/u.test(fingerprint))
    throw new Error('消息指纹无效。')
  if (message !== null && seqRaw !== null) throw new Error('消息定位参数冲突。')
  if (fingerprint !== null && message === null && seqRaw === null)
    throw new Error('消息指纹缺少定位参数。')
  const link: SessionLink = { sessionUuid }
  if (message !== null) link.messageUuid = identifier(message)
  if (seqRaw !== null) {
    if (!/^(0|[1-9]\d*)$/u.test(seqRaw) || !Number.isSafeInteger(Number(seqRaw)) || !fingerprint)
      throw new Error('序号定位需要有效序号和消息指纹。')
    link.seq = Number(seqRaw)
  }
  if (fingerprint !== null) link.fingerprint = fingerprint
  return link
}
